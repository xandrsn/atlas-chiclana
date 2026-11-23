import * as THREE from 'three';
import { toLocal } from './geo.js';
import { props } from './props.js';

// Data-driven places engine. Every place is a JSON under data/places/ (schema: data/places/README.md), packed by scripts/places_pack.mjs into
// data/places_all.json which is polled every 20 s. Places with status implemented|verified|needs_fix are built lazily when the camera is close.
// design.areas/paths/walls -> ground + low structures; design.buildings -> recolour / re-height the real Catastro footprint + facade features;
// design.elements -> procedural props (statues, fountains, benches, lamps, trees, terraces, playgrounds...). Everything solid goes through props.js.
const LOADABLE = new Set(['implemented', 'verified', 'needs_fix']);
const R_BUILD = 450, DISPOSE = 1800;
const rad = d => d * Math.PI / 180;
const rotY = b => Math.PI - rad(b || 0);                       // compass bearing (0 = N, clockwise) -> Three rotation.y for a local +z "front"
const hash = i => (Math.imul((i | 0) + 1, 2654435761) >>> 0) / 4294967296;
const HEX = h => { const c = new THREE.Color(h); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };

const mats = new Map();
const M = (c, o = {}) => { const k = c + JSON.stringify(o); let m = mats.get(k); if (!m) mats.set(k, m = new THREE.MeshLambertMaterial({ color: c, ...o })); return m; };
const texCache = new Map();
function tex(key, w, h, draw, repeat = true) {
  let t = texCache.get(key); if (t) return t;
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? '0,0,0' : '255,255,255'},${a})`; g.fillRect(hash(i * 3 + 1) * w, hash(i * 5 + 2) * h, 2 + hash(i * 7) * 6, 2 + hash(i * 11) * 6); } };
const GROUND = {   // kind -> [default colour, tile size m, painter]
  paving: ['#b9b4a8', 6, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 0.94 + ((i * 7 + j * 13) % 5) * 0.025; g.globalAlpha = 0.18; g.fillStyle = v > 0.98 ? '#fff' : '#000'; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); g.globalAlpha = 1; } g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 4; i++) { g.fillRect(i * 64, 0, 2, h); g.fillRect(0, i * 64, w, 2); } }],
  brick: ['#a5553a', 4, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.35)'; for (let r = 0; r < 8; r++) { g.fillRect(0, r * 32, w, 2); for (let b = 0; b < 4; b++) g.fillRect(((b * 64 + (r % 2) * 32) % 256), r * 32, 2, 32); } }],
  cobble: ['#8d877c', 3, (g, w, h, c) => { g.fillStyle = '#5c584f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) { g.fillStyle = hash(i * 10 + j) < 0.5 ? c : '#9a9488'; g.fillRect(i * 25.6 + 2 + (j % 2) * 8, j * 25.6 + 2, 21, 21); } }],
  albero: ['#d4b36a', 8, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 500, 0.05); }],
  gravel: ['#b7ae9c', 8, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 900, 0.09); }],
  sand: ['#e6d6a8', 10, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 500, 0.04); }],
  grass: ['#5c8f3c', 8, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 900, 0.06);
    for (let i = 0; i < 2500; i++) { const x = hash(i * 7 + 3) * w, y = hash(i * 11 + 5) * h, l = 3 + hash(i) * 5; g.strokeStyle = `rgba(${hash(i + 9) < 0.5 ? '40,90,20' : '150,190,80'},0.32)`; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hash(i + 4) - 0.5) * 3, y - l); g.stroke(); }
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)'; g.fillRect(0, k * h / 8, w, h / 8); } }],
  flowerbed: ['#4a7a35', 4, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { g.fillStyle = ['#d94a3a', '#f2d34a', '#e58bc0', '#fff'][i % 4]; g.fillRect(hash(i) * w, hash(i * 3) * h, 6, 6); } }],
  rubber: ['#a23b34', 4, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 300, 0.07); }],
  asphalt: ['#4b4b4d', 8, (g, w, h, c) => { g.fillStyle = c; g.fillRect(0, 0, w, h); noise(g, w, h, 700, 0.06); }],
};
const groundMat = (kind, color, order = 6) => {
  const [dc, tile, paint] = GROUND[kind] || GROUND.paving, c = color || dc, t = tex(`g|${kind}|${c}`, 256, 256, (g, w, h) => paint(g, w, h, c)).clone();
  t.needsUpdate = true; t.repeat.set(1 / tile, 1 / tile);
  return new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
};
function signTex(text, bg = '#f3e9d2', fg = '#3a2a1e', font = 'bold {s}px Georgia, serif') {
  return tex(`s|${text}|${bg}|${fg}`, 512, 96, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = 54; g.font = font.replace('{s}', s); while (g.measureText(text).width > w - 40 && s > 18) { s -= 2; g.font = font.replace('{s}', s); } g.fillText(text, w / 2, h / 2 + 3); }, false);
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);   // y = bottom
const cyl = (r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 10) => mesh(new THREE.CylinderGeometry(r1, r0, h, seg), mat, x, y + h / 2, z);
const sph = (r, mat, x, y, z, sy = 1) => { const m = mesh(new THREE.SphereGeometry(r, 10, 8), mat, x, y, z); m.scale.y = sy; return m; };
const cone = (r, h, mat, x, y, z, seg = 8) => mesh(new THREE.ConeGeometry(r, h, seg), mat, x, y + h / 2, z);

function pointInPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
function distSeg(x, z, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - t * dx, z - az - t * dz); }
function distPoly(P, x, z) { let m = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) m = Math.min(m, distSeg(x, z, P[j][0], P[j][1], P[i][0], P[i][1])); return m; }
const ll = p => toLocal(p[0], p[1]);
const bearingVec = b => [Math.sin(rad(b)), -Math.cos(rad(b))];   // outward normal (x,z) of a compass bearing

/** hard / water areas of the loaded places (paving, asphalt, ponds...; lawns excluded): world.js keeps scattered vegetation off them.
 *  shortcut: filled when places_all.json arrives; a street cell meshed before that keeps its trees until it is rebuilt. */
export const PA = { rings: [], on(x, z) { for (const r of this.rings) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && pointInPoly(r.P, x, z)) return true; return false; } };

export class Places {
  constructor(scene, hf, B, osm) {
    this.scene = scene; this.hf = hf; this.B = B; this.osm = osm; this.items = new Map(); this.sig = ''; this.t = 0;
    this.stats = { loaded: 0, built: 0, errors: 0 };
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 20000);
  }
  gy(x, z) { return this.hf.height(x, z); }
  /** summary for travel menus: [{slug,name,category,status,x,z}] of every known place (all statuses) */
  list() { return [...this.items.values()].map(it => ({ slug: it.p.slug, name: it.p.name, category: it.p.category, status: it.p.status, x: it.x, z: it.z, lon: it.p.lon, lat: it.p.lat })); }

  async refresh() {
    let all; try { const r = await fetch('/data/places_all.json', { cache: 'no-cache' }); if (!r.ok) return; all = await r.json(); } catch { return; }
    const force = new URLSearchParams(location.search).get('places') === 'all';
    for (const p of all.places || []) {
      const ok = force || LOADABLE.has(p.status), sig = p.status + '|' + (p.log?.length || 0) + '|' + JSON.stringify(p.design || '').length;
      let it = this.items.get(p.slug);
      if (it && it.sig === sig) continue;
      if (it) this.dispose(it);
      const [x, z] = Number.isFinite(p.lon) ? toLocal(p.lon, p.lat) : [0, 0];
      it = { p, sig, x, z, group: null, loaded: ok, applied: false };
      this.items.set(p.slug, it);
      if (ok) { try { this.applyBuildings(it); } catch (e) { this.stats.errors++; console.error('place overrides', p.slug, e); } }
    }
    this.stats.loaded = [...this.items.values()].filter(i => i.loaded).length;
    PA.rings = []; for (const it of this.items.values()) if (it.loaded) for (const a of it.p.design?.areas || []) { if (a.kind === 'grass' || (a.poly || []).length < 3) continue; const P = a.poly.map(ll); PA.rings.push({ P, x0: Math.min(...P.map(p => p[0])), x1: Math.max(...P.map(p => p[0])), z0: Math.min(...P.map(p => p[1])), z1: Math.max(...P.map(p => p[1])) }); }
  }
  dispose(it) {
    if (!it.group) return;
    this.scene.remove(it.group);
    it.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    it.group = null;
  }

  // -------------------------------------------------------------- Catastro footprints
  partRing(i) { const { P, off } = this.B, r = []; for (let k = off[i]; k < off[i + 1]; k++) r.push([P[k * 2], P[k * 2 + 1]]); return r; }
  partAt(x, z, maxD = 14) {
    const B = this.B; let best = -1, bd = maxD;
    for (let i = 0; i < B.n; i++) {
      if (x < B.bb[i * 4] - maxD || x > B.bb[i * 4 + 1] + maxD || z < B.bb[i * 4 + 2] - maxD || z > B.bb[i * 4 + 3] + maxD) continue;
      const ring = this.partRing(i); if (pointInPoly(ring, x, z)) return i;
      const d = distPoly(ring, x, z); if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  applyBuildings(it) {
    it.parts = [];
    for (const b of it.p.design?.buildings || []) {
      const [x, z] = ll(b.at), i = this.partAt(x, z); if (i < 0) { b._part = -1; continue; }
      b._part = i; b._xz = [x, z];
      const idx = new Set([i]);
      if (b.cluster > 0) for (let k = 0; k < this.B.n; k++) { const cx = (this.B.bb[k * 4] + this.B.bb[k * 4 + 1]) / 2, cz = (this.B.bb[k * 4 + 2] + this.B.bb[k * 4 + 3]) / 2; if (Math.hypot(cx - x, cz - z) < b.cluster) idx.add(k); }
      const o = {}; if (b.hide) { o.skip = true; o.top = -5; }   // fake footprint (e.g. a tennis court recorded as a building): no mesh, no collision
      if (b.facade) o.rgb = HEX(b.facade); if (b.roofColor) o.roof = HEX(b.roofColor); if (b.plinth) o.plinth = { none: 0, stone: 1, almagre: 2, dark: 3 }[b.plinth] ?? 1;
      for (const k of idx) { const oo = { ...o }; if (b.heightM && k === i) oo.top = b.heightM; if (oo.rgb || oo.roof || oo.top != null) this.B.override(k, oo); }
      it.parts.push(...idx);
    }
  }

  // -------------------------------------------------------------- build (lazy)
  build(it) {
    const g = it.group = new THREE.Group(); g.name = 'place:' + it.p.slug; const d = it.p.design || {};
    const run = (label, arr, fn) => { for (const a of arr || []) { try { fn(g, a, it); } catch (e) { this.stats.errors++; console.error('place', it.p.slug, label, e); } } };
    run('areas', d.areas, (g, a) => this.area(g, a)); run('paths', d.paths, (g, a) => this.path(g, a)); run('walls', d.walls, (g, a) => this.wall(g, a));
    run('buildings', d.buildings, (g, b) => this.buildingFeatures(g, b)); run('elements', d.elements, (g, e) => this.element(g, e));
    this.scene.add(g); this.stats.built++;
  }
  update(cam) {
    const k = Math.max(0.5, Math.min(1.5, window.__lodK ?? 1));
    for (const it of this.items.values()) {
      if (!it.loaded) continue;
      const dist = Math.hypot(it.x - cam.x, it.z - cam.z), rb = (R_BUILD + (it.p.radius || 90)) * k;
      if (!it.group && dist < rb) { try { this.build(it); } catch (e) { this.stats.errors++; console.error('place build', it.p.slug, e); it.group = new THREE.Group(); } }
      else if (it.group && dist > DISPOSE + (it.p.radius || 90)) this.dispose(it);
      if (it.group) it.group.visible = dist < rb * 1.25;
    }
  }

  // -------------------------------------------------------------- ground areas / paths / walls
  area(g, a) {
    const ring = (a.poly || []).map(ll); if (ring.length < 3) return;
    if (a.kind === 'water') return this.pond(g, ring, a);
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, A = 0;
    for (const [x, z] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) A += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]) / 2; A = Math.abs(A);
    const S = Math.max(1, Math.min(4, Math.sqrt(A) / 40)), off = a.y ?? 0.08, pos = [], uvs = [], idx = [], ang = rad(a.angle || 0), ca = Math.cos(ang), sa = Math.sin(ang);
    for (let x = Math.floor(minx / S) * S; x < maxx; x += S) for (let z = Math.floor(minz / S) * S; z < maxz; z += S) {
      const cx = x + S / 2, cz = z + S / 2; if (!pointInPoly(ring, cx, cz) && distPoly(ring, cx, cz) > S * 0.35) continue;
      const k = pos.length / 3; for (const [dx, dz] of [[0, 0], [S, 0], [S, S], [0, S]]) { const X = x + dx, Z = z + dz; pos.push(X, this.gy(X, Z) + off, Z); uvs.push(X * ca + Z * sa, -X * sa + Z * ca); }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, groundMat(a.kind, a.color, 6)));
    if (a.kerb !== false && (a.kind === 'paving' || a.kind === 'flowerbed' || a.kind === 'grass')) this.ribbon(g, ring.concat([ring[0]]), 0.35, M(a.kerbColor || 0x8e8b84, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), 0.12);
  }
  pond(g, ring, a) {
    let sy = 0; for (const [x, z] of ring) sy += this.gy(x, z); sy /= ring.length;
    const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []), pos = []; for (const [x, z] of ring) pos.push(x, sy + 0.18, z);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(tri.flat()); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, M(a.color || 0x6fb7c4, { transparent: true, opacity: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 })));
    for (let i = 0; i < ring.length; i++) { const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], l = Math.hypot(bx - ax, bz - az); if (l < 0.2) continue;   // coping + solid rim
      const r = box(l, 0.45, 0.35, M(0xc9c3b4), 0, 0, 0); r.position.set((ax + bx) / 2, sy + 0.2, (az + bz) / 2); r.rotation.y = -Math.atan2(bz - az, bx - ax); g.add(r);
      props.box((ax + bx) / 2, (az + bz) / 2, l / 2, 0.2, r.rotation.y, sy + 0.5); }
  }
  /** flat ribbon of half-width w draped on the terrain along pts (local coords) */
  ribbon(g, pts, w, mat, off = 0.09, tile = 6) {
    const pos = [], uvs = [], idx = []; let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.05) continue; const nx = -(bz - az) / l * w, nz = (bx - ax) / l * w, k = pos.length / 3;
      for (const [x, z, u, v] of [[ax - nx, az - nz, s, 0], [bx - nx, bz - nz, s + l, 0], [bx + nx, bz + nz, s + l, w * 2], [ax + nx, az + nz, s, w * 2]]) { pos.push(x, this.gy(x, z) + off, z); uvs.push(u, v); }
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2); s += l;
    }
    if (!idx.length) return; void tile;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, mat));
  }
  path(g, a) {
    const pts = (a.pts || []).map(ll); if (pts.length < 2) return;
    this.ribbon(g, pts, (a.width || 3) / 2, groundMat(a.kind || 'gravel', a.color, 7), 0.1);
  }
  wall(g, a) {
    let pts = (a.pts || []).map(ll); if (pts.length < 2) return; if (a.closed) pts = pts.concat([pts[0]]);
    const h = a.h ?? 1, t = a.thick ?? 0.3, kind = a.kind || 'wall';
    const mat = kind === 'hedge' ? M(a.color || 0x3f6b34) : kind === 'wall' ? M(a.color || 0xe8e2d2) : M(a.color || 0x1f2420);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 0.1) continue; const mx = (ax + bx) / 2, mz = (az + bz) / 2, y = Math.min(this.gy(ax, az), this.gy(bx, bz)) - 0.05, rot = -Math.atan2(bz - az, bx - ax);
      if (kind === 'railing' || kind === 'fence') {
        const n = Math.max(1, Math.round(l / 0.5)); for (let k = 0; k <= n; k++) { const t2 = k / n, x = ax + (bx - ax) * t2, z = az + (bz - az) * t2; g.add(box(0.04, h, 0.04, mat, x, this.gy(x, z), z)); }
        const r1 = box(l, 0.05, 0.05, mat, 0, 0, 0); r1.position.set(mx, y + h * 0.9, mz); r1.rotation.y = rot; g.add(r1); const r2 = r1.clone(); r2.position.y = y + h * 0.25; g.add(r2);
      } else { const w = box(l, h + 0.05, t, mat, 0, 0, 0); w.position.set(mx, y + (h + 0.05) / 2, mz); w.rotation.y = rot; g.add(w); if (kind === 'wall') { const cap = box(l, 0.08, t + 0.1, M(0xcfc8b8), 0, 0, 0); cap.position.set(mx, y + h + 0.09, mz); cap.rotation.y = rot; g.add(cap); } }
      props.box(mx, mz, l / 2, Math.max(t, 0.25) / 2, rot, y + h + 0.1);
    }
  }

  // -------------------------------------------------------------- building facade features (local frame: +z = outward, x along the wall, y up from the part's base)
  edgeFor(b) {
    const i = b._part; if (i == null || i < 0) return null;
    const ring = this.partRing(i), [px, pz] = b._xz; let best = null, bs = -1e9;
    for (const f of b.features || []) f._edge = null;
    const pick = facing => {
      let e = null, sc = -1e9;
      for (let a = 0; a < ring.length; a++) {
        const [ax, az] = ring[a], [bx, bz] = ring[(a + 1) % ring.length], l = Math.hypot(bx - ax, bz - az); if (l < 1.2) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2; let nx = (bz - az) / l, nz = -(bx - ax) / l; if (pointInPoly(ring, mx + nx * 0.4, mz + nz * 0.4)) { nx = -nx; nz = -nz; }
        const s = facing == null ? -distSeg(px, pz, ax, az, bx, bz) : nx * bearingVec(facing)[0] + nz * bearingVec(facing)[1] + Math.min(l, 20) * 0.01;
        if (s > sc) { sc = s; e = { ax, az, bx, bz, l, mx, mz, nx, nz }; }
      }
      return e;
    };
    void best; void bs; return pick;
  }
  buildingFeatures(g, b) {
    if (b._part == null || b._part < 0) return;
    const B = this.B, i = b._part, base = B.base[i], H = B.top[i] - base, pick = this.edgeFor(b), floors = b.floors || Math.max(1, B.floors[i] || Math.round(H / 3.2)), fh = Math.min(3.6, H / floors);
    const groups = new Map();
    for (const f of b.features || []) {
      const e = pick(f.facing); if (!e) continue; const key = `${e.ax},${e.az}`; let fr = groups.get(key);
      if (!fr) { fr = new THREE.Group(); fr.position.set(e.mx, base, e.mz); fr.rotation.y = Math.atan2(e.nx, e.nz); fr.userData.e = e; groups.set(key, fr); g.add(fr); }
      const e2 = fr.userData.e; try { this.feature(fr, f, e2, H, fh, floors, base); } catch (er) { this.stats.errors++; console.error('feature', f.type, er); }
    }
    for (const r of b.roof || []) { try { const [x, z] = r.at ? ll(r.at) : [(B.bb[i * 4] + B.bb[i * 4 + 1]) / 2, (B.bb[i * 4 + 2] + B.bb[i * 4 + 3]) / 2]; this.roofItem(g, r, x, z, r.grounded ? base : base + H); } catch (er) { this.stats.errors++; console.error('roof', er); } }
    if (b.name && !b.features?.some(f => f.type === 'sign' || f.type === 'shopfront')) { const e = pick(b.facing); if (e) { const fr = new THREE.Group(); fr.position.set(e.mx, base, e.mz); fr.rotation.y = Math.atan2(e.nx, e.nz); this.feature(fr, { type: 'sign', text: b.name, w: Math.min(e.l - 1, 5) }, e, H, fh, floors, base); g.add(fr); }
    }
  }
  feature(fr, f, e, H, fh, floors, base) {
    void base; const u = f.u || 0, w = f.w || 3, c = f.color, dark = M(0x2b2b2b), trim = M(f.trim || 0xf2eee6), o = 0.05;
    switch (f.type) {
      case 'shopfront': {
        const W = Math.min(w, e.l - 0.6), h = f.h || 2.6;
        fr.add(box(W + 0.3, 0.25, 0.2, dark, u, h + 0.35, o + 0.1), box(W, h, 0.1, M(f.glass || 0x1f2d38), u, 0.25, o + 0.05), box(1.1, h - 0.2, 0.14, M(c || 0x3a2a1e), u + (f.door === 'right' ? W / 2 - 0.9 : -W / 2 + 0.9), 0.1, o + 0.08));
        if (f.text) { const s = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.7, 0.16), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: signTex(f.text, f.bg || '#3a2a1e', f.fg || '#f3e9d2') }), dark]); s.position.set(u, h + 0.95, o + 0.1); fr.add(s); }
        if (f.awning) { const aw = box(W, 0.07, 1.2, M(f.awning), u, h + 0.2, o + 0.7); aw.rotation.x = 0.26; fr.add(aw); }
        break; }
      case 'sign': { const W = Math.min(w, e.l - 0.4), s = new THREE.Mesh(new THREE.BoxGeometry(W, f.h || 0.7, 0.14), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: signTex(f.text || '', f.bg || '#f3e9d2', f.fg || '#3a2a1e') }), dark]); s.position.set(u, f.y ?? 3.3, o + 0.08); fr.add(s); break; }
      case 'plaque': { const s = mesh(new THREE.PlaneGeometry(w || 0.9, f.h || 0.35), new THREE.MeshBasicMaterial({ map: signTex(f.text || '', f.bg || '#f4f4f0', f.fg || '#1f3a5f') }), u, f.y ?? 2.2, o + 0.03); fr.add(s); break; }
      case 'door': { const h = f.h || 2.8; fr.add(box(w + 0.4, h + 0.3, 0.12, trim, u, 0, o + 0.02), box(w, h, 0.18, M(c || 0x3a2a1e), u, 0, o + 0.06)); if (f.arched) { const a = cyl(w / 2, w / 2, 0.18, M(c || 0x3a2a1e), u, h, o + 0.06, 14); a.rotation.x = Math.PI / 2; a.position.y = h; fr.add(a); } break; }
      case 'windows': {
        const n = f.count || Math.max(1, Math.floor((e.l - 1.2) / 2.4)), ww = f.w || 1.1, wh = f.h || 1.5, sp = Math.min(f.spacing || 2.4, (e.l - 1) / n);
        for (let fl = (f.from ?? 1); fl <= (f.to ?? floors - 1); fl++) for (let k = 0; k < n; k++) {
          const x = u + (k - (n - 1) / 2) * sp, y = fl * fh + 0.9;
          fr.add(box(ww + 0.2, wh + 0.2, 0.08, trim, x, y - 0.1, o + 0.01), box(ww, wh, 0.12, M(f.glass || 0x2a3a46), x, y, o + 0.04));
          if (f.shutters) { fr.add(box(ww / 2, wh, 0.06, M(f.shutters), x - ww * 0.75, y, o + 0.06), box(ww / 2, wh, 0.06, M(f.shutters), x + ww * 0.75, y, o + 0.06)); }
          if (f.balcony) { fr.add(box(ww + 0.8, 0.12, 0.7, dark, x, y - 0.2, o + 0.35), box(ww + 0.8, 0.9, 0.04, dark, x, y - 0.1, o + 0.68)); }
        } break; }
      case 'balcony': { const y = (f.floor || 1) * fh + 0.3; fr.add(box(w, 0.14, 1.0, M(c || 0x2b2b2b), u, y, o + 0.5), box(w, 0.9, 0.05, M(c || 0x17191a), u, y + 0.1, o + 0.98)); break; }
      case 'awning': { const aw = box(w, 0.07, f.d || 1.3, M(c || 0x9a2f2f), u, f.y ?? 3.1, o + 0.7); aw.rotation.x = 0.26; fr.add(aw); break; }
      case 'band': fr.add(box((f.w || e.l) + 0.1, f.h || 0.6, 0.22, M(c || 0xe2a91e), u, f.y ?? H - 0.6, o + 0.06)); break;
      case 'columns': { const n = f.count || 4, ph = f.pedestal || 1.2, ch = f.h || 4.5, sp = f.spacing || 1.3, cm = M(c || 0xe9e2d0); for (let k = 0; k < n; k++) { const x = u + (k - (n - 1) / 2) * sp; fr.add(box(0.7, ph, 0.7, cm, x, 0, o + 0.45), cyl(0.28, 0.28, ch, cm, x, ph, o + 0.45, 10), box(0.6, 0.25, 0.6, cm, x, ph + ch, o + 0.45)); } fr.add(box(n * sp + 0.4, 0.4, 0.8, cm, u, ph + ch + 0.25, o + 0.4)); break; }
      case 'cornice': fr.add(box(e.l + 0.2, 0.5, 0.5, M(c || 0xf2eee6), 0, H - 0.4, o + 0.15)); break;
      case 'pilasters': { const n = f.count || 4; for (let k = 0; k < n; k++) fr.add(box(0.6, H - 0.4, 0.3, trim, (k / (n - 1) - 0.5) * (e.l - 1.2), 0, o + 0.1)); break; }
      case 'pediment': { const sh = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, f.h || 2.5)]); if (f.edge) { const sh2 = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.35, -0.05), new THREE.Vector2(w / 2 + 0.35, -0.05), new THREE.Vector2(0, (f.h || 2.5) + 0.5)]); fr.add(mesh(new THREE.ExtrudeGeometry(sh2, { depth: 0.4, bevelEnabled: false }), M(f.edge), u, H, o - 0.05)); }
        fr.add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false }), M(c || 0xf2eee6), u, H, o)); if (f.oculus) { const oc = cyl(0.6, 0.6, 0.1, M(0x222222), u, H + (f.h || 2.5) * 0.4, o + 0.55, 16); oc.rotation.x = Math.PI / 2; fr.add(oc); } break; }
      case 'arcade': {
        const n = f.count || 5, aw = (f.w || (e.l - 1)) / n, h = f.h || 3.4, d = f.depth || 2.4, col = M(c || 0xe9e2d0);
        for (let k = 0; k <= n; k++) { const x = u + (k - n / 2) * aw; fr.add(cyl(0.3, 0.3, h, col, x, 0, o + d, 10)); props.circle(...this.toWorld(fr, x, o + d), 0.32, this.gy(...this.toWorld(fr, x, o + d)) + h); }
        fr.add(box(n * aw + 0.6, 0.5, 0.5, col, u, h, o + d)); fr.add(box(n * aw, 0.12, d, M(0xcfc5ad), u, h + 0.4, o + d / 2)); break; }
      case 'flagpoles': { const n = f.count || 3; for (let k = 0; k < n; k++) { const x = u + (k - (n - 1) / 2) * (f.spacing || 1.6); fr.add(cyl(0.05, 0.05, 5, M(0xdddddd), x, H, o + 0.6, 6), box(0.04, 0.9, 1.4, M((f.colors || [0xc60b1e, 0xf1bf00, 0x2b4a9a])[k % 3]), x, H + 3.9, o + 1.3)); } break; }
      default: break;
    }
  }
  toWorld(fr, x, z) { fr.updateMatrixWorld(true); const v = new THREE.Vector3(x, 0, z).applyMatrix4(fr.matrixWorld); return [v.x, v.z]; }
  roofItem(g, r, x, z, y) {
    y += r.lift || 0; const col = M(r.color || 0xb5573b), R = r.r || 3, h = r.h || 3; if (r.grounded) y = Math.min(y, this.gy(x, z));
    switch (r.kind) {
      case 'dome': g.add(cyl(R, R * 1.05, h * 0.5, M(r.base || 0xe6dcc6), x, y, z, 12), mesh(new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), col, x, y + h * 0.5, z)); break;
      case 'spire': g.add(cone(R * 0.6, h, col, x, y, z, 4)); break;
      case 'lantern': g.add(cyl(R * 0.6, R * 0.6, h, M(0xf3e9d2), x, y, z, 8), cone(R * 0.75, h * 0.5, col, x, y + h, z, 8)); break;
      case 'belfry': if (r.open) { const w = R * 1.4, bm = M(r.base || 0xf1eee6), ym = M(r.band || 0xe2a91e), dk = M(0x222222); g.add(box(w, h, w, bm, x, y, z)); for (const yy of [0.3, h * 0.45, h - 0.2]) g.add(box(w + 0.25, 0.4, w + 0.25, ym, x, y + yy, z)); for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1]]) for (const k of [-0.28, 0.28]) { const a = box(0.5, 1.5, 0.12, dk, 0, 0, 0); a.position.set(x + dx * (w / 2 + 0.03) + (ry ? 0 : k * w), y + h * 0.45 + 1.1, z + dz * (w / 2 + 0.03) + (ry ? k * w : 0)); a.rotation.y = ry ? Math.PI / 2 : 0; g.add(a); } g.add(box(w + 0.3, 0.5, w + 0.3, ym, x, y + h, z)); break; } g.add(box(R * 1.4, h, R * 1.4, M(r.base || 0xf1eee6), x, y, z), box(R * 1.6, 0.4, R * 1.6, M(0xcfc8b6), x, y + h, z), cone(R * 1.2, h * 0.7, col, x, y + h + 0.4, z, 4)); break;
      case 'chimney': g.add(box(0.7, h, 0.7, M(0xb5573b), x, y, z)); break;
      case 'cross': g.add(box(0.12, h, 0.12, M(0x2b2b2b), x, y, z), box(h * 0.4, 0.12, 0.12, M(0x2b2b2b), x, y + h * 0.65, z)); break;
      default: break;
    }
  }

  // -------------------------------------------------------------- elements
  element(g, e) {
    if (e.line && e.line.length > 1) {
      const pts = e.line.map(ll), sp = e.spacing || 10; let carry = 0, n = 0;
      for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
        for (let t = carry; t <= l; t += sp) { const x = ax + (bx - ax) * t / l, z = az + (bz - az) * t / l; this.place1(g, e, x, z, e.alignLine ? 90 - Math.atan2(-(bz - az), bx - ax) * 180 / Math.PI + (e.rot || 0) : e.rot, n++); carry = t + sp - l; } carry = Math.max(0, carry); }
      return;
    }
    if (!e.at) return; const [x, z] = ll(e.at); this.place1(g, e, x, z, e.rot, 0);
  }
  place1(g, e, x, z, rot, n) {
    const o = this.makeElement(e, n); if (!o) return; const gy = this.gy(x, z) + (e.y ?? 0);
    o.group.position.set(x, gy + 0.04, z); o.group.rotation.y = rotY(rot); g.add(o.group); o.group.updateMatrixWorld(true);
    for (const s of o.solids || []) {
      if (s.r != null) { const v = new THREE.Vector3(s.x || 0, 0, s.z || 0).applyMatrix4(o.group.matrixWorld); props.circle(v.x, v.z, s.r, gy + s.top); }
      else { const v = new THREE.Vector3(s.x || 0, 0, s.z || 0).applyMatrix4(o.group.matrixWorld); props.box(v.x, v.z, s.hw, s.hd, o.group.rotation.y, gy + s.top, s.walk); }
    }
  }
  makeElement(e, n) {
    const G = new THREE.Group(), sz = e.size || [], c = e.color, v = e.variant, S = [], r1 = hash(n * 13 + 5);
    const stone = M(c || 0xe0cfa8), iron = M(0x1f2420), grey = M(0x9c9a94), bronze = M(c || 0x3e3a35);
    switch (e.kind) {
      case 'bench': { const wood = v === 'wood', st = M(c || (wood ? 0x7a5a3a : v === 'iron' ? 0x1f2420 : 0xe0cfa8)); G.add(box(2.0, 0.12, 0.6, st, 0, 0.45, 0), box(2.0, 0.5, 0.1, st, 0, 0.5, -0.28), box(0.14, 0.45, 0.55, wood ? iron : st, -0.85), box(0.14, 0.45, 0.55, wood ? iron : st, 0.85)); S.push({ hw: 1.0, hd: 0.32, top: 0.9 }); break; }
      case 'lamp': { const gl = v === 'globe'; G.add(cyl(0.16, 0.09, 4.2, iron, 0, 0, 0, 8)); if (v === 'modern') G.add(box(0.9, 0.12, 0.3, iron, 0.3, 4.1)); else if (gl) G.add(sph(0.35, M(0xfff1c0), 0, 4.45, 0)); else { G.add(box(1.2, 0.08, 0.08, iron, 0, 4.0), sph(0.2, M(0xf3e9b8), -0.55, 4.25, 0), sph(0.2, M(0xf3e9b8), 0.55, 4.25, 0), sph(0.2, M(0xf3e9b8), 0, 4.6, 0)); } S.push({ r: 0.2, top: 4.2 }); break; }
      case 'tree': { const k = v || 'round', trunk = M(0x6b5a45), h = sz[1] || 6;
        if (k === 'pine') G.add(cyl(0.2, 0.3, h * 0.5, trunk, 0, 0, 0, 6), cone(2.4, h, M(0x2f5a2c), 0, h * 0.35, 0, 8));
        else if (k === 'cypress') G.add(cyl(0.15, 0.2, 1.5, trunk, 0, 0, 0, 6), mesh(new THREE.ConeGeometry(1.0, h, 7), M(0x2c4a2a), 0, 1.2 + h / 2, 0));
        else if (k === 'palm') { G.add(cyl(0.22, 0.32, h, M(0x7a6548), 0, 0, 0, 7)); for (let q = 0; q < 9; q++) { const f = box(0.2, 0.05, 2.8, M(0x4f7a38)); f.geometry.translate(0, 0, 1.4); f.position.set(0, h - 0.1, 0); f.rotation.set(-0.35 + (q % 3) * 0.08, q * 0.7, 0, 'YXZ'); G.add(f); } }
        else if (k === 'orange') G.add(cyl(0.12, 0.16, 1.6, trunk, 0, 0, 0, 6), sph(1.5, M(0x3f7a30), 0, 2.7, 0, 0.85), sph(0.12, M(0xe8892b), 0.9, 2.5, 0.5), sph(0.12, M(0xe8892b), -0.7, 2.9, 0.8));
        else if (k === 'olive') G.add(cyl(0.2, 0.28, 1.4, trunk, 0, 0, 0, 6), sph(2.0, M(0x7f8f5a), 0, 2.6, 0, 0.7));
        else if (k === 'jacaranda') G.add(cyl(0.15, 0.2, 3, trunk, 0, 0, 0, 6), sph(2.4, M(0x9b7fc8), 0, 4.3, 0, 0.8));
        else G.add(cyl(0.14, 0.2, 2.6, trunk, 0, 0, 0, 6), sph(1.9, M(c || 0x3f6b34), 0, 4.0, 0, 0.85));
        S.push({ r: 0.35, top: 3 }); break; }
      case 'palm': return this.makeElement({ ...e, kind: 'tree', variant: 'palm', size: [0, sz[1] || 7.5] }, n);
      case 'block': { const w = sz[0] || 3, h = sz[1] || 3, d = sz[2] || 3; G.add(box(w, h, d, M(c || 0xf4efe4)));   // generic cuboid (villa, pillar, car, mailbox); roof = flat cap colour, pitched = pyramid roof height
        if (e.roof && !e.pitched) G.add(box(w + 0.3, 0.2, d + 0.3, M(e.roof), 0, h)); if (e.pitched) { const P = new THREE.Group(); P.scale.set(w * 0.78, e.pitched, d * 0.78); const k = mesh(new THREE.ConeGeometry(1, 1, 4), M(e.roof || 0xb5573b), 0, 0.5, 0); k.rotation.y = Math.PI / 4; P.add(k); P.position.y = h; G.add(P); }
        if (!e.noSolid) S.push({ hw: w / 2, hd: d / 2, top: h + 0.2 }); break; }
      case 'planter': G.add(box(1.2, 0.8, 1.2, M(c || 0x4a4d4f)), box(1.0, 0.12, 1.0, M(0xc0302a), 0, 0.8)); S.push({ hw: 0.6, hd: 0.6, top: 0.9 }); break;
      case 'flowerbed': G.add(box(sz[0] || 2, 0.25, sz[2] || 1, M(0x8e8b84)), box((sz[0] || 2) - 0.2, 0.1, (sz[2] || 1) - 0.2, M(c || 0xd94a7a), 0, 0.25)); S.push({ hw: (sz[0] || 2) / 2, hd: (sz[2] || 1) / 2, top: 0.3 }); break;
      case 'bollard': G.add(cyl(0.12, 0.12, 0.9, M(c || 0x2b2b2b), 0, 0, 0, 8)); S.push({ r: 0.14, top: 0.9 }); break;
      case 'obelisk': { const H = sz[1] || 7; G.add(box(2.6, 0.4, 2.6, grey), box(1.8, 0.8, 1.8, stone, 0, 0.4)); const o = mesh(new THREE.CylinderGeometry(0.25, 0.5, H, 4), stone, 0, 1.2 + H / 2, 0); o.rotation.y = Math.PI / 4; G.add(o, cone(0.36, 0.7, stone, 0, 1.2 + H, 0, 4)); S.push({ hw: 1.3, hd: 1.3, top: 1.2 + H }); break; }
      case 'cross': G.add(box(1.8, 0.35, 1.8, grey), box(1.1, 0.4, 1.1, stone, 0, 0.35), box(0.4, 3.0, 0.4, stone, 0, 0.75), box(1.4, 0.38, 0.38, stone, 0, 2.4)); S.push({ hw: 0.9, hd: 0.9, top: 3.8 }); break;
      case 'column': { const H = sz[1] || 6; G.add(box(1.2, 0.5, 1.2, grey), cyl(0.4, 0.35, H, stone, 0, 0.5, 0, 12), box(0.9, 0.3, 0.9, grey, 0, 0.5 + H)); S.push({ r: 0.6, top: H + 0.8 }); break; }
      case 'statue': {
        const ph = sz[1] ?? 1.8, figH = e.figH || 1.9, st = M(e.pedestalColor || 0xcfc8b6); G.add(box(2.4, 0.4, 2.4, grey), box(1.6, ph, 1.6, st, 0, 0.4)); const y = 0.4 + ph, k = v || 'standing';
        if (k === 'seated') G.add(box(0.7, 0.5, 0.8, bronze, 0, y, 0), box(0.6, 0.8, 0.35, bronze, 0, y + 0.5, -0.2), sph(0.25, bronze, 0, y + 1.5, -0.1));
        else if (k === 'bust') G.add(sph(0.35, bronze, 0, y + 0.45, 0, 1.15), box(0.7, 0.4, 0.4, bronze, 0, y));
        else if (k === 'equestrian') G.add(box(0.5, 0.8, 1.8, bronze, 0, y + 0.8, 0), cyl(0.1, 0.1, 0.8, bronze, 0.2, y, 0.6, 6), cyl(0.1, 0.1, 0.8, bronze, -0.2, y, 0.6, 6), cyl(0.1, 0.1, 0.8, bronze, 0.2, y, -0.6, 6), cyl(0.1, 0.1, 0.8, bronze, -0.2, y, -0.6, 6), cyl(0.3, 0.25, 0.9, bronze, 0, y + 1.6, 0, 8), sph(0.22, bronze, 0, y + 2.4, 0));
        else G.add(cyl(0.34, 0.28, figH * 0.5, bronze, 0, y, 0, 8), cyl(0.28, 0.2, figH * 0.35, bronze, 0, y + figH * 0.5, 0, 8), sph(0.22, bronze, 0, y + figH * 0.95, 0), cyl(0.07, 0.07, 0.8, bronze, 0.4, y + figH * 0.55, 0, 6));
        if (e.text) { const pl = mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ map: signTex(e.text, '#3e3a35', '#d9c89a') }), 0, 0.4 + ph * 0.5, 0.83); G.add(pl); }
        S.push({ hw: 1.2, hd: 1.2, top: y + figH + 0.5 }); break; }
      case 'fountain': {
        const R = sz[0] || 2, sq = v === 'square', basin = sq ? box(R * 2, 0.6, R * 2, grey) : cyl(R, R, 0.6, grey, 0, 0, 0, 20), wat = sq ? box(R * 2 - 0.4, 0.05, R * 2 - 0.4, M(0x7fd0e8, { transparent: true, opacity: 0.8 }), 0, 0.58) : cyl(R - 0.25, R - 0.25, 0.05, M(0x7fd0e8, { transparent: true, opacity: 0.8 }), 0, 0.58, 0, 20);
        G.add(basin, wat, cyl(0.22, 0.3, 1.5, stone, 0, 0.3, 0, 10), cyl(0.8, 0.5, 0.2, stone, 0, 1.6, 0, 14)); if (v === 'tiered') G.add(cyl(R * 0.5, R * 0.5, 0.25, stone, 0, 0.6, 0, 16), cone(0.14, 1.1, M(0x7fd0e8, { transparent: true, opacity: 0.8 }), 0, 1.8, 0, 8));
        S.push(sq ? { hw: R, hd: R, top: 0.7 } : { r: R, top: 0.7 }); break; }
      case 'kiosk': { const w = sz[0] || 3, h = sz[1] || 2.6, d = sz[2] || 3; G.add(box(w, h, d, M(c || 0x3f6b5a)), box(w + 0.6, 0.15, d + 0.6, M(0x2b2b2b), 0, h), cone(Math.max(w, d) * 0.8, 1.2, M(0xb5573b), 0, h + 0.15, 0, 4)); if (e.text) G.add(mesh(new THREE.PlaneGeometry(w * 0.9, 0.4), new THREE.MeshBasicMaterial({ map: signTex(e.text, '#f3e9d2', '#3a2a1e') }), 0, h - 0.5, d / 2 + 0.02)); S.push({ hw: w / 2, hd: d / 2, top: h + 1 }); break; }
      case 'gazebo': case 'pergola': { const R = sz[0] || 3, h = sz[1] || 3; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; G.add(cyl(0.1, 0.1, h, M(c || 0xe9e2d0), Math.cos(a) * R, 0, Math.sin(a) * R, 6)); S.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, r: 0.15, top: h }); } G.add(cone(R * 1.25, 1.4, M(0xb5573b), 0, h, 0, 6)); break; }
      case 'terrace': { const w = sz[0] || 6, d = sz[2] || 3, nT = Math.max(1, Math.round(w * d / 6)); const cols = Math.max(1, Math.round(w / 2)), rows = Math.max(1, Math.round(d / 2));
        let t = 0; for (let i = 0; i < cols && t < nT; i++) for (let j = 0; j < rows && t < nT; j++, t++) { const x = (i - (cols - 1) / 2) * 2, z = (j - (rows - 1) / 2) * 2; G.add(cyl(0.4, 0.4, 0.05, M(0x2b2b2b), x, 0.72, z, 12), cyl(0.04, 0.04, 0.72, iron, x, 0, z, 6));
          for (const [dx, dz] of [[0.65, 0], [-0.65, 0], [0, 0.65], [0, -0.65]]) G.add(box(0.4, 0.05, 0.4, M(c || 0x8a5a2b), x + dx, 0.45, z + dz), box(0.4, 0.4, 0.05, M(c || 0x8a5a2b), x + dx, 0.5, z + dz + (dz ? 0.18 * Math.sign(dz) : 0)));
          if (v !== 'noparasol') G.add(cyl(0.03, 0.03, 2.2, iron, x, 0, z, 5), mesh(new THREE.ConeGeometry(1.2, 0.4, 8), M(e.parasol || 0xefe3c5), x, 2.4, z)); S.push({ x, z, r: 0.9, top: 0.8 }); } break; }
      case 'parasol': G.add(cyl(0.04, 0.04, 2.3, iron, 0, 0, 0, 5), mesh(new THREE.ConeGeometry(1.4, 0.45, 8), M(c || 0xefe3c5), 0, 2.3, 0)); S.push({ r: 0.1, top: 2.3 }); break;
      case 'playground': { const w = sz[0] || 8, d = sz[2] || 6; G.add(box(w, 0.05, d, M(0xa23b34), 0, 0, 0));
        for (const sx of [-1, 1]) G.add(cyl(0.05, 0.05, 2.6, M(0x3b6fc4), sx * w * 0.2, 0, -d * 0.2, 6)); G.add(box(w * 0.4 + 0.1, 0.06, 0.06, M(0x3b6fc4), -w * 0.0 - w * 0.0, 2.6, -d * 0.2)); G.add(box(0.5, 0.06, 0.6, M(0xf2b134), 0, 0.6, -d * 0.2));
        const sl = box(0.7, 0.06, 2.4, M(0xf2b134), w * 0.3, 0.9, d * 0.1); sl.rotation.x = 0.55; G.add(sl, box(1.2, 1.5, 1.2, M(0xd94a3a), w * 0.3, 0, -d * 0.2));
        S.push({ hw: w * 0.15, hd: 0.7, top: 2.6, x: 0, z: -d * 0.2 }, { hw: 0.7, hd: 0.7, top: 1.5, x: w * 0.3, z: -d * 0.2 }); break; }
      case 'goal': G.add(box(0.1, 2.4, 0.1, M(0xf4f4f0), -3.6, 0, 0), box(0.1, 2.4, 0.1, M(0xf4f4f0), 3.6, 0, 0), box(7.3, 0.1, 0.1, M(0xf4f4f0), 0, 2.4, 0)); S.push({ r: 0.15, top: 2.4, x: -3.6 }, { r: 0.15, top: 2.4, x: 3.6 }); break;
      case 'hoop': G.add(cyl(0.07, 0.07, 3.05, M(0x3a3a3a), 0, 0, 0, 6), box(1.2, 0.9, 0.05, M(0xf4f4f0), 0, 3.0, 0.4), (() => { const t = mesh(new THREE.TorusGeometry(0.23, 0.02, 4, 12), M(0xe8622a), 0, 3.05, 0.65); t.rotation.x = Math.PI / 2; return t; })()); S.push({ r: 0.1, top: 3.5 }); break;
      case 'signpost': G.add(cyl(0.05, 0.05, 2.6, iron, 0, 0, 0, 6), mesh(new THREE.PlaneGeometry(1.3, 0.5), new THREE.MeshBasicMaterial({ map: signTex(e.text || '', c || '#1f3a5f', '#f3e9d2'), side: THREE.DoubleSide }), 0, 2.3, 0.06)); S.push({ r: 0.1, top: 2.6 }); break;
      case 'steps': { const w = sz[0] || 6, k = sz[2] || 3; for (let q = 0; q < k; q++) G.add(box(w, 0.15 * (q + 1), 0.4 * (k - q), grey, 0, 0, 0.2 * (k - q))); for (let q = 0; q < k; q++) S.push({ hw: w / 2, hd: 0.2 * (k - q), top: 0.15 * (q + 1), z: 0.2 * (k - q), walk: true }); break; }   // each tread is a walkable box (climb towards -z)
      case 'monument': { const w = sz[0] || 3, h = sz[1] || 3, d = sz[2] || 0.8; G.add(box(w + 0.6, 0.3, d + 0.6, grey), box(w, h, d, M(c || 0xc9b48a), 0, 0.3)); if (e.text) G.add(mesh(new THREE.PlaneGeometry(w * 0.8, 0.4), new THREE.MeshBasicMaterial({ map: signTex(e.text, '#3e3a35', '#d9c89a') }), 0, 0.3 + h * 0.5, d / 2 + 0.02)); S.push({ hw: w / 2 + 0.3, hd: d / 2 + 0.3, top: h + 0.4 }); break; }
      case 'arch': { const w = sz[0] || 4, h = sz[1] || 4, d = sz[2] || 2, m = M(c || 0xe0cfa8); G.add(box(1, h, d, m, -w / 2 - 0.5), box(1, h, d, m, w / 2 + 0.5), box(w + 2, 1.2, d, m, 0, h), (() => { const a = cyl(w / 2, w / 2, d, m, 0, h - 0.6, 0, 16); a.rotation.x = Math.PI / 2; return a; })()); S.push({ hw: 0.5, hd: d / 2, top: h + 1.2, x: -w / 2 - 0.5 }, { hw: 0.5, hd: d / 2, top: h + 1.2, x: w / 2 + 0.5 }); break; }
      case 'stage': { const w = sz[0] || 8, d = sz[2] || 5; G.add(box(w, 1, d, M(c || 0x7a5a3a)), box(w, 0.2, 0.3, M(0x2b2b2b), 0, 4.2, -d / 2)); S.push({ hw: w / 2, hd: d / 2, top: 1.1 }); break; }
      // ---- fairground (feria) kit: striped caseta, monumental lit gate (portada), ferris wheel, strings of farolillos
      case 'caseta': { const w = sz[0] || 10, h = sz[1] || 3.6, d = sz[2] || 12, c1 = c || '#c8322b', wh = M(0xf4efe4);
        let st = mats.get('caseta|' + c1); if (!st) mats.set('caseta|' + c1, st = new THREE.MeshLambertMaterial({ map: tex('stripe|' + c1, 256, 8, (g, W, H) => { g.fillStyle = '#f4efe4'; g.fillRect(0, 0, W, H); g.fillStyle = c1; for (let q = 0; q < 8; q++) g.fillRect(q * 32, 0, 16, H); }, false) }));
        G.add(box(w, h, d, st)); const roof = cone(0.7072, 1.9, M(c1), 0, h, 0, 4); roof.rotation.y = Math.PI / 4; roof.scale.set(w + 0.8, 1, d + 0.8); G.add(roof);
        G.add(box(w + 0.4, 1.5, 0.3, wh, 0, h - 0.2, d / 2 + 0.1), cone(w * 0.36, 1.3, wh, 0, h + 1.3, d / 2 + 0.1, 3), box(w * 0.45, h * 0.72, 0.12, M(0x2a2420), 0, 0, d / 2 + 0.02));
        if (e.text) G.add(mesh(new THREE.PlaneGeometry(w * 0.9, 0.9), new THREE.MeshBasicMaterial({ map: signTex(e.text, '#f4efe4', c1) }), 0, h + 0.55, d / 2 + 0.27));
        S.push({ hw: w / 2, hd: d / 2, top: h + 1.5 }); break; }
      case 'portada': { const W = sz[0] || 34, H = sz[1] || 20, D = sz[2] || 2.6, wh = M(0xf7f3ea), ac = M(c || 0xc8322b), bulb = M(0xffe08a, { emissive: 0xa87a18 }), xs = [-W / 2 + 1.6, -11, -4.6, 4.6, 11, W / 2 - 1.6];
        for (const x of xs) { const tw = Math.abs(x) > 12, pw = tw ? 3.2 : 2; G.add(box(pw, tw ? H : H * 0.55, tw ? 3.2 : D, wh, x)); S.push({ x, hw: pw / 2, hd: (tw ? 3.2 : D) / 2, top: H }); if (tw) { G.add(box(3.8, 0.5, 3.8, ac, x, H), cone(2.5, 5, ac, x, H + 0.5, 0, 4), sph(0.5, bulb, x, H + 5.9, 0)); for (let y = 1; y < H; y += 1.1) G.add(sph(0.16, bulb, x, y, 1.7)); } }
        G.add(box(W - 3, 2.4, D, wh, 0, H * 0.55), box(W - 3, 0.5, D + 0.5, ac, 0, H * 0.55 + 2.4), box(13, H * 0.2, D, wh, 0, H * 0.55 + 2.9), box(14, 0.5, D + 0.5, ac, 0, H * 0.75 + 2.9), cone(7.6, H * 0.2, ac, 0, H * 0.75 + 3.4, 0, 4), sph(0.6, bulb, 0, H * 0.95 + 3.9, 0));
        for (const [a, b2] of [[-11, -4.6], [-4.6, 4.6], [4.6, 11]]) { const r = (b2 - a) / 2 - 1, cy = H * 0.55 - r - 0.1; G.add(mesh(new THREE.TorusGeometry(r, 0.3, 6, 16, Math.PI), ac, (a + b2) / 2, cy, 0)); for (let q = 0; q <= 10; q++) { const t = q / 10 * Math.PI; G.add(sph(0.15, bulb, (a + b2) / 2 + Math.cos(t) * r, cy + Math.sin(t) * r, D / 2 + 0.25)); } }
        for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 1.1) G.add(sph(0.15, bulb, x, H * 0.55 + 2.75, D / 2 + 0.3), sph(0.15, bulb, x, H * 0.55 + 2.75, -D / 2 - 0.3));
        if (e.text) for (const sg of [1, -1]) { const pl = mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshBasicMaterial({ map: signTex(e.text, '#f7f3ea', '#a3211c') }), 0, H * 0.65 + 2.9, sg * (D / 2 + 0.06)); if (sg < 0) pl.rotation.y = Math.PI; G.add(pl); }
        break; }
      case 'ferris': { const R = sz[0] || 14, hub = R + 3, st = M(0xf1f1ee), ac = M(c || 0x1f6fb5), cols = [0xc8322b, 0xf2c84b, 0x2e8b57, 0x1f6fb5, 0xe67e22, 0x8e44ad];
        for (const sg of [1, -1]) { for (const lean of [1, -1]) { const leg = cyl(0.28, 0.2, Math.hypot(hub, R * 0.45), st, 0, 0, 0, 6); leg.position.set(lean * R * 0.225, hub / 2, sg * 1.6); leg.rotation.z = lean * Math.atan2(R * 0.45, hub); G.add(leg); }
          G.add(mesh(new THREE.TorusGeometry(R, 0.16, 5, 40), ac, 0, hub, sg * 0.9), mesh(new THREE.TorusGeometry(R * 0.55, 0.1, 5, 30), st, 0, hub, sg * 0.9)); }
        const ax = cyl(0.5, 0.5, 3.6, st, 0, 0, 0, 10); ax.rotation.x = Math.PI / 2; ax.position.set(0, hub, 0); G.add(ax);
        for (let q = 0; q < 16; q++) { const a = q / 16 * Math.PI * 2, sp = cyl(0.07, 0.07, R, st, 0, 0, 0, 5); sp.position.set(Math.cos(a) * R / 2, hub + Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2; G.add(sp);
          G.add(box(1.5, 1.3, 1.5, M(cols[q % cols.length]), Math.cos(a) * R, hub + Math.sin(a) * R - 1.6, 0), box(1.7, 0.12, 1.7, st, Math.cos(a) * R, hub + Math.sin(a) * R - 0.3, 0)); }
        G.add(box(R * 1.3, 0.5, 5, M(0x8a8f96))); S.push({ hw: R * 0.65, hd: 2.5, top: 2.2 }); break; }
      case 'carousel': { const R = sz[0] || 6, st = M(0xf1f1ee), ac = M(c || 0xc8322b), cols = [0xf2c84b, 0x1f6fb5, 0x2e8b57, 0xe67e22];   // tiovivo
        G.add(cyl(R, R, 0.5, M(0x8a8f96), 0, 0, 0, 20), cyl(0.5, 0.5, 5.5, st, 0, 0.5, 0, 8), cone(R * 1.15, 2.6, ac, 0, 5.2, 0, 20), cyl(R * 1.15, R * 1.15, 0.5, M(0xf2c84b), 0, 4.8, 0, 20));
        for (let q = 0; q < 8; q++) { const a = q / 8 * Math.PI * 2, x = Math.cos(a) * R * 0.72, z = Math.sin(a) * R * 0.72; G.add(cyl(0.05, 0.05, 4.3, st, x, 0.5, z, 4), box(0.5, 0.8, 1.2, M(cols[q % 4]), x, 1.3, z)); }
        S.push({ r: R, top: 7.8 }); break; }
      case 'dropTower': { const H = sz[0] || 32, st = M(0xf1f1ee), ac = M(c || 0xc8322b); G.add(box(5, 0.6, 5, M(0x8a8f96)), box(1.6, H, 1.6, st, 0, 0.6), box(4.6, 1.2, 4.6, ac, 0, H * 0.45), box(1.8, 1.8, 1.8, M(0xf2c84b), 0, H + 0.6)); S.push({ hw: 2.5, hd: 2.5, top: H + 2 }); break; }
      case 'tower': { const R = sz[0] || 3, H = sz[1] || 10, tm = M(c || 0xc8ae82), dk = M(0x2b2b2b);   // coastal watchtower: tapered stone drum, cornice, merlons, door
        G.add(cyl(R * 1.12, R * 0.92, H, tm, 0, 0, 0, 14), cyl(R * 1.18, R * 1.18, 0.5, M(0xd9c7a0), 0, H, 0, 14), box(1.3, 2.2, 0.3, dk, 0, 2.2, R * 1.0));
        for (let q = 0; q < 8; q++) { const a = q / 8 * Math.PI * 2; G.add(box(1.0, 0.9, 0.9, tm, Math.cos(a) * R * 1.05, H + 0.5, Math.sin(a) * R * 1.05)); }
        S.push({ r: R * 1.15, top: H + 1.4 }); break; }
      case 'garland': { const L = sz[0] || 18, H = sz[1] || 5.2, cols = [0xd8322b, 0xf4efe4, 0x2e8b57, 0xf2c84b, 0x1f6fb5, 0xe67e22], n = Math.max(6, Math.round(L / 0.85)), wire = M(0x2b2b2b);
        for (const sg of [1, -1]) { G.add(cyl(0.09, 0.07, H, M(0xf4efe4), sg * L / 2, 0, 0, 6)); S.push({ x: sg * L / 2, r: 0.12, top: H }); }
        const w = box(L, 0.03, 0.03, wire, 0, H - 0.35); G.add(w);
        for (let q = 0; q <= n; q++) { const t = q / n, x = (t - 0.5) * L, y = H - 0.25 - Math.sin(t * Math.PI) * 0.55; G.add(sph(0.2, M(cols[(q + n) % cols.length]), x, y - 0.25, 0, 1.25)); }
        break; }
      case 'fuel': {   // petrol station: canopy on columns with brand fascia, pump islands, price totem. size [L,_,W]; color = brand colour, accent = 2nd colour, text = brand
        const L = sz[0] || 18, W = sz[2] || 9, H = 5.2, mm = M(c || '#d9372b'), wh = M(0xf4f4f0), ac = e.accent || '#ffffff', txt = e.text || '', fh = 0.9;
        G.add(box(L, 0.3, W, wh, 0, H - 0.3), box(L + 0.2, fh, 0.15, mm, 0, H - fh, W / 2), box(L + 0.2, fh, 0.15, mm, 0, H - fh, -W / 2), box(0.15, fh, W, mm, L / 2, H - fh, 0), box(0.15, fh, W, mm, -L / 2, H - fh, 0));
        if (txt) for (const sg of [1, -1]) { const t = mesh(new THREE.PlaneGeometry(Math.min(L * 0.55, 9), fh * 0.8), new THREE.MeshBasicMaterial({ map: signTex(txt, c || '#d9372b', ac, 'bold {s}px Arial, sans-serif') }), 0, H - fh / 2, sg * (W / 2 + 0.09)); if (sg < 0) t.rotation.y = Math.PI; G.add(t); }
        for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) { const x = sx * (L / 2 - 1.6), z = sz2 * (W / 2 - 1.1); G.add(cyl(0.28, 0.28, H - fh, wh, x, 0, z, 8)); S.push({ x, z, r: 0.3, top: H - fh }); }
        const isl = M(0x8a8a86), np = Math.max(2, Math.round((L - 5) / 6));
        for (const sg of [-1, 1]) { const z = sg * W * 0.2; G.add(box(L - 4, 0.22, 1.2, isl, 0, 0, z));
          for (let q = 0; q < np; q++) { const x = (np === 1 ? 0 : (q / (np - 1) - 0.5) * (L - 7)); G.add(box(0.7, 1.55, 0.5, wh, x, 0.22, z), box(0.72, 0.35, 0.52, mm, x, 1.4, z), box(0.4, 0.3, 0.02, M(0x222222), x, 0.9, z + 0.26)); S.push({ x, z, hw: 0.4, hd: 0.3, top: 1.8 }); } }
        if (e.totem) { const [tx, tz] = e.totem; G.add(cyl(0.18, 0.18, 6, M(0x55575a), tx, 0, tz, 8), box(1.9, 2.6, 0.3, mm, tx, 4.4, tz), box(1.7, 0.9, 0.34, M(0x1b1b1b), tx, 3.0, tz));
          for (const sg of [1, -1]) { const t = mesh(new THREE.PlaneGeometry(1.7, 0.7), new THREE.MeshBasicMaterial({ map: signTex(txt, c || '#d9372b', ac, 'bold {s}px Arial, sans-serif') }), tx, 6.2, tz + sg * 0.18); if (sg < 0) t.rotation.y = Math.PI; G.add(t); }
          S.push({ x: tx, z: tz, r: 0.3, top: 7 }); }
        break; }
      case 'parts': {   // free composition in local metres (x right, y up from ground, z front); rows built by scripts/madrid/place_monuments.mjs. Colour may be [hex, opacity].
        const pm = c => Array.isArray(c) ? M(c[0], { transparent: true, opacity: c[1], side: THREE.DoubleSide, depthWrite: false }) : M(c);
        for (const [t, ...a] of e.parts || []) { let m = null;
          if (t === 'box') { m = box(a[0], a[1], a[2], pm(a[6]), a[3], a[4], a[5]); m.rotation.y = rad(a[7] || 0); }   // w,h,d,x,y,z,col,ry
          else if (t === 'cyl') { m = a[8] ? mesh(new THREE.CylinderGeometry(a[1], a[0], a[2], a[7] || 14, 1, true), Array.isArray(a[6]) ? pm(a[6]) : M(a[6], { side: THREE.DoubleSide }), a[3], a[4] + a[2] / 2, a[5]) : cyl(a[0], a[1], a[2], pm(a[6]), a[3], a[4], a[5], a[7] || 14); }   // r0,r1,h,x,y,z,col,seg,open(tube without caps)
          else if (t === 'sph') m = sph(a[0], pm(a[4]), a[1], a[2], a[3], a[5] || 1);                                  // r,x,y,z,col,sy
          else if (t === 'cone') m = cone(a[0], a[1], pm(a[5]), a[2], a[3], a[4], a[6] || 8);                          // r,h,x,y,z,col,seg
          else if (t === 'wall') {   // W,H,D,x,y,z,col,holes[[cx,w,h,arched]],ry — wall in the local XY plane with door/arch openings cut from the bottom edge
            const [W, H, D, x, y, z, col, holes = [], ry = 0] = a, sh = new THREE.Shape(), cr = Math.cos(rad(ry)), sr = Math.sin(rad(ry)); sh.moveTo(-W / 2, 0); let px = -W / 2;
            const pier = (x0, x1) => { if (y < 2 && x1 - x0 > 0.2 && ry % 90 === 0) { const cx = (x0 + x1) / 2; S.push({ x: x + cx * cr, z: z - cx * sr, hw: ry % 180 ? D / 2 : (x1 - x0) / 2, hd: ry % 180 ? (x1 - x0) / 2 : D / 2, top: y + H }); } };   // shortcut: oblique walls get no pier solids (give e.solids instead), add a rotation to props.box if needed
            for (const [cx, w, h, arched] of [...holes].sort((p, q) => p[0] - q[0])) { const hs = arched ? h - w / 2 : h; pier(px, cx - w / 2); px = cx + w / 2;
              sh.lineTo(cx - w / 2, 0); sh.lineTo(cx - w / 2, hs); if (arched) sh.absarc(cx, hs, w / 2, Math.PI, 0, true); else sh.lineTo(cx + w / 2, hs); sh.lineTo(cx + w / 2, 0); }
            pier(px, W / 2); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H); sh.lineTo(-W / 2, H);
            const geo = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 10 }); geo.translate(0, 0, -D / 2); m = mesh(geo, pm(col), x, y, z); m.rotation.y = rad(ry); }
          else if (t === 'vault') { const [W, L, rise, x, y, z, col, ry = 0] = a, geo = new THREE.CylinderGeometry(1, 1, L, 24, 1, true, -Math.PI / 2, Math.PI); geo.rotateX(-Math.PI / 2); geo.scale(W / 2, rise, 1);   // barrel vault along local z
            m = mesh(geo, Array.isArray(col) ? pm(col) : M(col, { side: THREE.DoubleSide }), x, y, z); m.rotation.y = rad(ry); }
          else if (t === 'lunette') { const [W, rise, x, y, z, col, ry = 0] = a, geo = new THREE.CircleGeometry(1, 24, 0, Math.PI); geo.scale(W / 2, rise, 1); m = mesh(geo, Array.isArray(col) ? pm(col) : M(col, { side: THREE.DoubleSide }), x, y, z); m.rotation.y = rad(ry); }
          else if (t === 'sign') { const [w, h, x, y, z, text, bg, fg, ry = 0, flat] = a; m = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: signTex(text, bg, fg), side: THREE.DoubleSide }), x, y, z); m.rotation.set(flat ? -Math.PI / 2 : 0, rad(ry), 0, 'YXZ'); }
          if (m) G.add(m); }
        S.push(...(e.solids || [])); break; }
      default: return null;
    }
    void r1; return { group: G, solids: S };
  }
}
