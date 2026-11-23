// Knockable trees and street furniture: trees from the cell's baked records (render/trees.js), furniture (lamps, bollards, signs, traffic
// lights, benches, bins, tables, fountains) from data/cells/<map>/props.json (scripts/bake_cells.mjs). The player's car hits one: below KNOCK
// m/s it stops the car like a wall; faster, it falls over its base (sim/physics.js fallStep) and the car loses some speed. The standing copy
// is hidden in its merged cell mesh (a tree: its vertex range in the cell's tree mesh; furniture: its triangles in the LOD0 world mesh,
// collapsed in the index buffer) and a loose copy falls (one draw call each, at most MAXLOOSE, gone REST s after it lies still).
// Damage lives on the cell (sim/physics.js damageOf): stream/cells.js evict drops it, so a reloaded cell stands everything up again.
import * as THREE from 'three';
import { buildTrees, trisOf, SP, SPW } from './trees.js';
import { fallStep, damageOf } from '../sim/physics.js';
import { inBox } from '../traffic/park_math.js';

const KNOCK = 5, MAXLOOSE = 12, REST = 20, B = 8;   // m/s; loose meshes; s; bucket (m)
const RAD = [0.3, 0.2, 0.25, 0.3, 0.95, 0.35, 1.05, 0.3], SLOW = [0.9, 0.95, 0.95, 0.9, 0.85, 0.95, 0.85, 0.9];   // per props.json type: radius (m), car speed kept

export class Debris {
  constructor({ scene, cells, mats }) {
    this.scene = scene; this.cells = cells; this.mats = mats; this.props = null; this.loose = []; this.stats = { knocked: 0, loose: 0 };
    cells.onTreeMesh = c => { for (const t of c.dmg?.trees || []) this.hideTree(c, t); };   // a rebuilt tree mesh keeps its fallen trees hidden
    cells.onEvict = c => this.forget(c);
  }
  setProps(p) { this.props = p; for (const c of this.cells.all) c.knock = null; }
  /** standing trees (tree mesh resident) and furniture of a live cell, bucketed: Map(key -> [[kind, id, x, z, y, r, h], ...]) */
  index(c) {
    if (c.knock) return c.knock;
    const S = this.cells.S, M = new Map(), put = it => { const k = Math.floor(it[2] / B) + ',' + Math.floor(it[3] / B); let a = M.get(k); if (!a) M.set(k, a = []); a.push(it); };
    const T = c.data.trees;
    for (let t = 0; t < T.length / 4; t++) { const sp = Math.min(SP.EUCALYPT, Math.floor(T[t * 4 + 3] / SPW)); if (sp !== SP.BUSH) put(['tree', t, c.i * S + T[t * 4], c.j * S + T[t * 4 + 2], T[t * 4 + 1], 0.35, 6]); }
    const P = this.props?.c[c.i + ',' + c.j], H = this.props?.h;
    if (P) for (let k = 0; k < P.length; k += 4) put(['prop', k / 4, P[k], P[k + 1], P[k + 2], RAD[P[k + 3]] ?? 0.3, H[P[k + 3]] ?? 2, P[k + 3]]);
    return (c.knock = M);
  }
  /** the car body (x, z, heading h, half width hw, half length hl, feet y) moving at v against standing trees / furniture.
   *  -> 0 blocked (too slow to knock it over), 1 nothing, else the share of speed kept after knocking one down */
  hit(x, z, h, hw, hl, v, y, crush = false) {   // crush (the bulldozer): anything knockable goes over at any speed and barely slows it
    const S = this.cells.S, r = hl + 1.2;
    for (let i = Math.floor((x - r) / S); i <= Math.floor((x + r) / S); i++) for (let j = Math.floor((z - r) / S); j <= Math.floor((z + r) / S); j++) {
      const c = this.cells.byKey.get(i + ',' + j); if (!c || c.st !== 'live' || !c.data) continue;
      const M = this.index(c), D = c.dmg;
      for (let a = Math.floor((x - r) / B); a <= Math.floor((x + r) / B); a++) for (let b = Math.floor((z - r) / B); b <= Math.floor((z + r) / B); b++) for (const it of M.get(a + ',' + b) || []) {
        const [kind, id, px, pz, py, rad] = it;
        if (it.gone || Math.abs(py - y) > 2.5 || (kind === 'tree' ? !c.tmesh || D?.trees.has(id) : D?.props.has(id)) || !inBox(px, pz, x, z, h, hl, hw, rad)) continue;
        if (Math.abs(v) < (crush ? 0.2 : KNOCK)) return 0;
        const s = Math.sign(v) || 1, f = this.knock(c, it, -Math.sin(h) * s, -Math.cos(h) * s, crush ? Math.max(6, Math.abs(v) * 2) : Math.abs(v));
        if (f) return crush ? 0.97 : f;
      }
    }
    return 1;
  }
  /** fell item it of cell c along (dx, dz) at speed v -> share of speed kept (0: nothing to fell, e.g. props.json older than the mesh) */
  knock(c, it, dx, dz, v) {
    const [kind, id, x, z, y, , hgt, type] = it, d = c.data, S = this.cells.S;
    let geo, mat, L;
    if (kind === 'tree') {
      const g = buildTrees(d.trees.subarray(id * 4, id * 4 + 4), { yOff: d.yOff, qxz: d.qxz, qy: d.qy, sun: this.cells.sun });
      geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(g.col, 4, true));
      mat = this.mats.tree; L = Math.max(1, g.y1 - y); this.hideTree(c, id);
    } else {
      geo = this.cut(c, x, y, z, it[5], hgt); if (!geo) { it.gone = true; return 0; }
      mat = this.mats.world; L = hgt;
    }
    damageOf(c)[kind === 'tree' ? 'trees' : 'props'].add(id); this.stats.knocked++;
    const grp = new THREE.Group(), m = new THREE.Mesh(geo, mat); m.frustumCulled = false;
    m.position.set(c.i * S - x, d.yOff - y, c.j * S - z); m.scale.set(1 / d.qxz, 1 / d.qy, 1 / d.qxz); grp.position.set(x, y, z); grp.add(m); this.scene.add(grp);
    this.loose.push({ grp, c, axis: new THREE.Vector3(dz, 0, -dx), s: { a: 0.05, w: Math.min(3, v * 0.4 / L), L }, t: 0 });   // axis = up x (dx, dz): the top falls along the push
    while (this.loose.length > MAXLOOSE) this.drop(this.loose[0]);
    return kind === 'tree' ? 0.75 : SLOW[type] ?? 0.9;
  }
  /** tree t of cell c out of the cell's merged tree mesh (its vertices collapsed onto one point) */
  hideTree(c, t) {
    if (!c.tmesh) return; const T = c.data.trees; let o = 0;
    for (let u = 0; u < t; u++) o += trisOf(T[u * 4 + 3]) * 3;
    const n = trisOf(T[t * 4 + 3]) * 3, A = c.tmesh.geometry.attributes.position, P = A.array;
    for (let k = 1; k < n; k++) P.copyWithin((o + k) * 3, o * 3, o * 3 + 3);
    A.needsUpdate = true;
  }
  /** the triangles of the furniture at (x, y, z) (inside radius r, height hgt; ground-level faces kept) out of the LOD0 world mesh -> their geometry, or null */
  cut(c, x, y, z, r, hgt) {
    const d = c.data, Lo = d.lod[0], P = Lo.pos, I = Lo.idx, S = this.cells.S, q = d.qxz, cx = (x - c.i * S) * q, cz = (z - c.j * S) * q, R2 = ((r + 0.1) * q) ** 2;
    const y0 = (y - 0.45 - d.yOff) * d.qy, y1 = (y + hgt + 0.5 - d.yOff) * d.qy, yG = (y + 0.08 - d.yOff) * d.qy;
    const inV = v => { const dx = P[v * 3] - cx, dz = P[v * 3 + 2] - cz, yy = P[v * 3 + 1]; return dx * dx + dz * dz <= R2 && yy >= y0 && yy <= y1; };
    const tris = [];
    for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], e = I[t + 2]; if (a !== b && inV(a) && inV(b) && inV(e) && Math.max(P[a * 3 + 1], P[b * 3 + 1], P[e * 3 + 1]) > yG) tris.push(t); }
    if (!tris.length) return null;
    const n = tris.length * 3, pos = new Int16Array(n * 3), dc = new Uint8Array(n * 4), nc = new Uint8Array(n * 4);
    tris.forEach((t, k) => { for (let j = 0; j < 3; j++) { const v = I[t + j], o = k * 3 + j; pos.set(P.subarray(v * 3, v * 3 + 3), o * 3); dc.set(Lo.col.subarray(v * 4, v * 4 + 4), o * 4); nc.set(Lo.ncol.subarray(v * 4, v * 4 + 4), o * 4); } I[t + 1] = I[t + 2] = I[t]; });
    c.meshes[0].geometry.index.needsUpdate = true;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('dcol', new THREE.BufferAttribute(dc, 4, true)); g.setAttribute('ncol', new THREE.BufferAttribute(nc, 4, true));
    return g;
  }
  /** the bulldozer (x, z, heading h, half sizes, feet y) is stopped by a wall: boundary walls and fences (wall pieces under 2.6 m tall whose baked triangles are not building facades: vertex kind wall / plinth, bake_cells KIND) are torn down:
   *  their solid pieces stop blocking and the LOD0 triangles lying on them collapse (stays down until the cell reloads: the baked arrays are rebuilt).
   *  -> number of pieces torn (0: it is a building: nothing changes, play.js sheds rubble). shortcut: a shed under 3.3 m is baked as wallPlain like a fence, so it can still go; a 10 m wall goes in one go */
  tearWalls(solid, x, z, h, hw, hl, y) {
    const S = this.cells.S, sn = Math.sin(h), cs = Math.cos(h), todo = new Map(); let n = 0;
    const inside = (px, pz, m) => { const dx = px - x, dz = pz - z, a = cs * dx - sn * dz, b = -sn * dx - cs * dz; return Math.abs(a) <= hw + m && Math.abs(b) <= hl + m; };
    solid.near(x, z, Math.hypot(hw, hl) + 1, (g, k, ox, oz) => {
      if (g[k + 5] > 1e8 || g[k + 5] - g[k + 4] > 2.6 || g[k + 5] <= y + 0.2 || g[k + 4] >= y + 1.6) return false;
      if (!(inside(g[k] + ox, g[k + 1] + oz, 0.35) || inside(g[k + 2] + ox, g[k + 3] + oz, 0.35))) return false;
      const key = Math.round(ox / S) + ',' + Math.round(oz / S); (todo.get(key) || todo.set(key, []).get(key)).push([g, k, ox, oz]); return false;
    });
    for (const [key, list] of todo) {
      const c = this.cells.byKey.get(key); if (!c?.data) continue; const d = c.data, Lo = d.lod[0], P = Lo.pos, I = Lo.idx, q = d.qxz, ky = 1 / d.qy;
      const piece = ([g, k]) => g[k + 5] < 1e8;
      for (const pc of list) {   // the mesh triangles on this piece: footprint segment within 15 cm of the piece's ends, height span no taller than a wall
        const [g, k, ox, oz] = pc; if (!piece(pc)) continue; // g pieces are cell-local metres like the mesh
        const x0 = g[k], z0 = g[k + 1], x1 = g[k + 2], z1 = g[k + 3], lo = g[k + 4], hi = g[k + 5];
        const near = (px, pz, a, b, c2, dd) => { const vx = c2 - a, vz = dd - b, L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((px - a) * vx + (pz - b) * vz) / L2)); return Math.hypot(px - a - vx * u, pz - b - vz * u); };
        let hit = false;
        for (let t0 = 0; t0 < I.length; t0 += 3) {
          const a = I[t0], b = I[t0 + 1], c3 = I[t0 + 2]; if (a === b) continue;
          const kd = Lo.col ? Lo.col[a * 4 + 3] >> 4 : 11; if (kd === 10 || kd === 12) continue;   // building facade / plinth: never torn
          const v = [a, b, c3].map(i => [P[i * 3] / q, P[i * 3 + 1] * ky + (d.yOff || 0), P[i * 3 + 2] / q]), ys = v.map(p => p[1]), ya = Math.min(...ys), yb = Math.max(...ys);
          if (yb - ya > 2.8 || ya > hi + 0.3 || yb < lo - 0.3 || Math.abs(ya - lo) > 0.6) continue;
          // triangle footprint: its longest edge; the piece's ends must lie on that edge
          let best = [0, 1]; let bl = 0; for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) { const L = Math.hypot(v[i][0] - v[j][0], v[i][2] - v[j][2]); if (L > bl) { bl = L; best = [i, j]; } }
          if (bl < 0.5 || bl > 12) continue; const [i, j] = best;
          if (near(x0, z0, v[i][0], v[i][2], v[j][0], v[j][2]) > 0.15 || near(x1, z1, v[i][0], v[i][2], v[j][0], v[j][2]) > 0.15) continue;
          I[t0 + 1] = I[t0 + 2] = I[t0]; hit = true;
          // every piece lying on that footprint goes too (no invisible wall left behind)
          solid.near((v[i][0] + v[j][0]) / 2 + c.i * S, (v[i][2] + v[j][2]) / 2 + c.j * S, bl / 2 + 1, (g2, k2, ox2, oz2) => {
            if (g2[k2 + 5] > 1e8 || g2[k2 + 5] - g2[k2 + 4] > 2.8) return false;
            if (near(g2[k2], g2[k2 + 1], v[i][0], v[i][2], v[j][0], v[j][2]) < 0.15 && near(g2[k2 + 2], g2[k2 + 3], v[i][0], v[i][2], v[j][0], v[j][2]) < 0.15) { g2[k2 + 4] = g2[k2 + 5] = 1e9; n++; }
            return false;
          });
        }
        if (hit) { if (g[k + 5] < 1e8) { g[k + 4] = g[k + 5] = 1e9; n++; } c.meshes[0].geometry.index.needsUpdate = true; }   // no fence triangle under it: a building wall, it stays
      }
    }
    return n;
  }
  drop(o) { this.scene.remove(o.grp); o.grp.children[0].geometry.dispose(); this.loose = this.loose.filter(l => l !== o); }
  /** a cell leaves memory: its loose pieces go (its damage goes with the cell: stream/cells.js evict) */
  forget(c) { for (const o of this.loose.filter(l => l.c === c)) this.drop(o); c.knock = null; }
  update(dt) {
    for (const o of [...this.loose]) {
      if (fallStep(o.s, dt)) o.grp.quaternion.setFromAxisAngle(o.axis, o.s.a);
      else if ((o.t += dt) > REST) this.drop(o);   // shortcut: a fallen piece vanishes after REST s (draw-call budget); the standing one stays hidden until the cell reloads
    }
    this.stats.loose = this.loose.length;
  }
}
