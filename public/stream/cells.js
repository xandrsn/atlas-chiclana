// Cell streaming: decides which baked cells are wanted (draw distance + LOD distance from data/quality.json), loads them in a worker,
// turns at most `applyPerFrame` results per frame into meshes (no geometry work here: the arrays arrive ready), and evicts the
// least-recently-wanted cells (LRU, geometry.dispose()) once more than `maxCells` are resident.
import * as THREE from 'three';

export class Cells {
  constructor(scene, index, base, Q, mats) {
    this.scene = scene; this.base = base; this.Q = Q; this.mats = mats; this.sun = index.sun || [-0.45, 0.8, -0.4];
    this.S = index.cell; this.step = index.groundStep; this.all = index.cells.map(c => ({ ...c, st: 'none', lod: -1, seen: 0, d: 1e9 }));
    this.byKey = new Map(this.all.map(c => [c.i + ',' + c.j, c])); this.byFile = new Map(this.all.map(c => [c.file, c]));
    this.workers = [0, 1].map(() => { const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); w.onmessage = e => this.onLoaded(e.data); return w; });
    this.inflight = 0; this.ready = []; this.frame = 0; this.lastX = 1e9; this.lastZ = 1e9; this.wid = 0;
    this.stats = { resident: 0, lod0: 0, lod1: 0, trees: 0, inflight: 0, queued: 0, loaded: 0, evicted: 0, applyMax: 0, applyLast: 0, bytes: 0, errors: 0 };
  }
  dist(c, x, z) { const x0 = c.i * this.S, z0 = c.j * this.S, dx = Math.max(x0 - x, 0, x - x0 - this.S), dz = Math.max(z0 - z, 0, z - z0 - this.S); return Math.hypot(dx, dz); }
  update(x, z) {
    const Q = this.Q, s = this.stats; this.frame++;
    if (Math.hypot(x - this.lastX, z - this.lastZ) > 8 || this.frame % 15 === 0) {   // re-plan only when moved or every 15 frames
      this.lastX = x; this.lastZ = z;
      const want = [];
      for (const c of this.all) {
        c.d = this.dist(c, x, z); const w = c.d < Q.drawDist;
        if (w) { c.seen = this.frame; c.want = c.d < Q.lodDist ? 0 : 1; if (c.st === 'none') want.push(c); } else c.want = -1;
        if (c.st === 'live') this.show(c);
      }
      want.sort((a, b) => a.d - b.d);
      for (const c of want) { if (this.inflight >= 4) break; c.st = 'loading'; this.inflight++; this.workers[this.wid++ % 2].postMessage({ id: c.file, url: this.base + c.file, cell: c.file, S: this.S }); }
      this.evict(); this.count();
    }
    // apply loaded cells: bounded count + time budget per frame (the jank guard)
    const t0 = performance.now();
    for (let k = 0; k < Q.applyPerFrame && this.ready.length; k++) { if (k && performance.now() - t0 > Q.applyBudgetMs) break; this.apply(this.ready.shift()); }
    const dt = performance.now() - t0; if (dt > 0.01) { s.applyLast = dt; s.applyMax = Math.max(s.applyMax, dt); }
    s.inflight = this.inflight; s.queued = this.ready.length;
  }
  onLoaded(m) {
    if (m.treeMesh) return this.onTrees(m);
    this.inflight--; const c = this.byFile.get(m.id);
    if (!m.ok) { console.error('cell', m.err); this.stats.errors++; if (c) c.st = 'none'; return; }
    c.data = m; c.st = 'ready'; this.ready.push(c); this.stats.loaded++; this.stats.bytes += m.bytes;
  }
  apply(c) {
    if (c.st !== 'ready') return;
    const S = this.S, d = c.data, r = Math.hypot(S / 2, S / 2, (d.y1 - d.y0) / 2 + 30) * Math.max(d.qxz, d.qy);   // int16 positions: local units are 1/q m
    c.meshes = d.lod.map(L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos, 3)); g.setAttribute('dcol', new THREE.BufferAttribute(L.col, 4, true)); g.setAttribute('ncol', new THREE.BufferAttribute(L.ncol, 4, true)); g.setIndex(new THREE.BufferAttribute(L.idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(S / 2 * d.qxz, ((d.y0 + d.y1) / 2 - d.yOff) * d.qy, S / 2 * d.qxz), r);   // known from the bake: no computeBoundingSphere() pass
      const m = new THREE.Mesh(g, this.mats.world); m.position.set(c.i * S, d.yOff, c.j * S); m.scale.set(1 / d.qxz, 1 / d.qy, 1 / d.qxz); m.matrixAutoUpdate = false; m.updateMatrix(); m.visible = false; this.scene.add(m); return m;
    });
    c.hm = d.hm; c.N = d.N; c.decks = d.decks; c.walls = d.walls; c.st = 'live'; this.show(c); this.count();
  }
  show(c) {
    const on = c.want >= 0; c.meshes[0].visible = on && c.want === 0; c.meshes[1].visible = on && c.want === 1;
    const tOn = on && c.d < this.Q.treeDist, d = c.data;
    if (tOn && !c.tmesh && !c.treeReq && d?.nT) { c.treeReq = true; this.workers[this.wid++ % 2].postMessage({ id: c.file, trees: d.trees.slice(), opt: { yOff: d.yOff, qxz: d.qxz, qy: d.qy, sun: this.sun } }); }
    else if (c.tmesh && c.d > this.Q.treeDist + this.S) this.dropTrees(c);   // one cell of hysteresis: tree meshes only live near the player
    if (c.tmesh) c.tmesh.visible = tOn;
  }
  /** merged tree mesh of a cell (built in the worker from the baked records, render/trees.js): one draw call, the tree material */
  onTrees(m) {
    const c = this.byFile.get(m.id); if (!c) return; c.treeReq = false; if (c.st !== 'live' || c.tmesh) return;
    const d = c.data, S = this.S, g = new THREE.BufferGeometry(), t = m.treeMesh;
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(t.col, 4, true));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(S / 2 * d.qxz, ((t.y0 + t.y1) / 2 - d.yOff) * d.qy, S / 2 * d.qxz), Math.hypot(S / 2 + 8, S / 2 + 8, (t.y1 - t.y0) / 2) * Math.max(d.qxz, d.qy));
    const mesh = new THREE.Mesh(g, this.mats.tree); mesh.position.set(c.i * S, d.yOff, c.j * S); mesh.scale.set(1 / d.qxz, 1 / d.qy, 1 / d.qxz); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh); c.tmesh = mesh; this.onTreeMesh?.(c); this.show(c); this.count();
  }
  dropTrees(c) { this.scene.remove(c.tmesh); c.tmesh.geometry.dispose(); c.tmesh = null; }
  evict() {
    const live = this.all.filter(c => c.st === 'live'); if (live.length <= this.Q.maxCells) return;
    live.filter(c => c.want < 0).sort((a, b) => a.seen - b.seen).slice(0, live.length - this.Q.maxCells).forEach(c => {
      for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
      if (c.tmesh) this.dropTrees(c);
      this.onEvict?.(c); c.dmg = c.knock = null;   // damage is per resident cell: a reloaded cell stands up again (render/debris.js)
      c.meshes = null; c.data = null; c.hm = null; c.walls = null; c.st = 'none'; this.stats.evicted++;
    });
    this.count();
  }
  count() { const s = this.stats; s.resident = s.lod0 = s.lod1 = s.trees = 0; for (const c of this.all) if (c.st === 'live') { s.resident++; if (c.meshes[0].visible) s.lod0++; if (c.meshes[1].visible) s.lod1++; if (c.tmesh?.visible) s.trees++; } }
  /** surface height from the resident cell's baked height grid (0 where nothing is loaded). With yRef (the height the mover is at now), a bridge deck
   *  within 2.2 m of yRef wins over the ground, so cars drive over bridges and still pass under them. */
  heightAt(x, z, yRef) {
    const c = this.byKey.get(Math.floor(x / this.S) + ',' + Math.floor(z / this.S)); if (!c || !c.hm) return 0;
    const st = this.S / (c.N - 1), lx = x - c.i * this.S, lz = z - c.j * this.S, u = lx / st, v = lz / st, N = c.N, iu = Math.min(N - 2, u | 0), iv = Math.min(N - 2, v | 0), fu = u - iu, fv = v - iv, h = c.hm, o = iv * N + iu;
    let y = Math.max(0.2, (h[o] * (1 - fu) + h[o + 1] * fu) * (1 - fv) + (h[o + N] * (1 - fu) + h[o + N + 1] * fu) * fv);
    const D = c.decks; if (yRef == null || !D || !D.length) return y;
    let best = 2.2;
    for (let k = 0; k < D.length; k += 7) {
      const ax = D[k], az = D[k + 1], dx = D[k + 2] - ax, dz = D[k + 3] - az, t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(ax + dx * t - lx, az + dz * t - lz) > D[k + 4]) continue;
      const yd = D[k + 5] + (D[k + 6] - D[k + 5]) * t + 0.22, e = Math.abs(yd - yRef); if (e < best) { best = e; y = yd; }   // + the baked road lift
    }
    return y;
  }
  /** true when every cell within `r` metres is resident and meshed */
  /** fraction (0..1) of the cells within r of (x, z) that are live; 1 = ready to play there */
  near(x, z, r) { let n = 0, live = 0; for (const c of this.all) if (this.dist(c, x, z) < r) { n++; if (c.st === 'live') live++; } return n ? live / n : 1; }
}
