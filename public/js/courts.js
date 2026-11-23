import * as THREE from 'three';
import { props } from './props.js';
import { Builder, solidMat, meshMat } from './football.js';

// Padel / tennis / basketball courts (data/courts.json, built by scripts/courts.mjs from OSM). One OSM polygon = one item holding a grid of
// regulation-sized courts. Per item, built lazily near the camera: ONE alpha-cut ground quad with every court painted on it, ONE solid mesh,
// ONE chain-link/net mesh and ONE glass mesh (padel walls). Disposed when far. Solids register in props (collision).
const BUILD = 300, DROP = 650;
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
export const CT = { list: [],
  /** is (x,z) on a court (+2 m)? keeps vegetation off them (world.js) */
  on(x, z) { for (const it of this.list) { if (Math.abs(it.x - x) > 90 || Math.abs(it.z - z) > 90) continue; for (const q of it.courts) { const dx = x - q.ox, dz = z - q.oz, c = Math.cos(q.ang), s = Math.sin(q.ang); if (Math.abs(dx * c + dz * s) < q.L * q.k / 2 + 2 && Math.abs(-dx * s + dz * c) < q.W * q.k / 2 + 2) return true; } } return false; },
  covers(cx, cz) { for (const it of this.list) if (Math.hypot(it.x - cx, it.z - cz) < 6) return true; return false; } };
let glassM = null;
const glassMat = () => glassM ||= new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide });
const REAL = { padel: [20, 10], tennis: [23.77, 10.97], basketball: [28, 15] };
const MARGIN = { padel: [1.2, 1.2], tennis: [2.4, 1.8], basketball: [1.6, 1.6] };
const SURF = {   // [court, run-off]
  padel: [['#2f6db0', '#245a96'], ['#2f8a4a', '#25703b']],
  hard: [['#3a7ca5', '#4d8a5f'], ['#4f9a63', '#2f6a45'], ['#b4573c', '#7d3b2b']],
  grey: [['#7d8286', '#6a6f73']],
  clay: [['#b9603a', '#a9532f']], grass: [['#5aa03c', '#4a8a30']],
  basketball: [['#b4573c', '#7a7d80'], ['#4a7fb0', '#7a7d80'], ['#a9a39a', '#7a7d80']],
};

function paint(it, cu, TL, TW) {
  const ppm = Math.max(3, Math.min(9, 2048 / Math.max(TL, TW))), cv = document.createElement('canvas'); cv.width = Math.ceil(TL * ppm); cv.height = Math.ceil(TW * ppm);
  const g = cv.getContext('2d'), sport = it.sport, [mu, mv] = MARGIN[sport], h = hash(it.id);
  const set = sport === 'padel' ? SURF.padel : sport === 'basketball' ? SURF.basketball : (SURF[it.surface] || SURF.hard), pal = set[h % set.length];
  g.lineCap = 'butt';
  for (const { q, u, v } of cu) {
    const half = it.half, k = q.k, L = half ? 14 : REAL[sport][0], W = REAL[sport][1];
    g.setTransform(ppm * k, 0, 0, ppm * k, (u + TL / 2) * ppm, (v + TW / 2) * ppm);
    g.lineWidth = Math.max(0.06, 1.6 / (ppm * k)); g.strokeStyle = '#f2f2ec';
    g.fillStyle = pal[1]; g.fillRect(-L / 2 - mu / k, -W / 2 - mv / k, L + 2 * mu / k, W + 2 * mv / k);
    g.fillStyle = pal[0]; g.fillRect(-L / 2, -W / 2, L, W);
    if (it.surface === 'grass' && sport === 'tennis') for (let i = 0; i < 12; i += 2) { g.fillStyle = 'rgba(0,40,0,0.09)'; g.fillRect(-L / 2 + L * i / 12, -W / 2, L / 12, W); }
    g.strokeRect(-L / 2, -W / 2, L, W);
    if (sport === 'padel') {
      g.beginPath();
      for (const s of [-1, 1]) { g.moveTo(s * 6.95, -W / 2); g.lineTo(s * 6.95, W / 2); g.moveTo(s * 6.95, 0); g.lineTo(s * L / 2, 0); }
      g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.moveTo(0, -W / 2); g.lineTo(0, W / 2); g.stroke();
    } else if (sport === 'tennis') {
      g.beginPath(); g.moveTo(-L / 2, -4.115); g.lineTo(L / 2, -4.115); g.moveTo(-L / 2, 4.115); g.lineTo(L / 2, 4.115);
      for (const s of [-1, 1]) { g.moveTo(s * 6.4, -4.115); g.lineTo(s * 6.4, 4.115); g.moveTo(s * L / 2, 0); g.lineTo(s * (L / 2 - 0.25), 0); }
      g.moveTo(-6.4, 0); g.lineTo(6.4, 0); g.stroke();
      g.strokeStyle = 'rgba(30,30,30,0.5)'; g.beginPath(); g.moveTo(0, -W / 2 - 0.9); g.lineTo(0, W / 2 + 0.9); g.stroke();
    } else {
      if (!half) { g.beginPath(); g.moveTo(0, -W / 2); g.lineTo(0, W / 2); g.stroke(); g.beginPath(); g.arc(0, 0, 1.8, 0, 6.2832); g.stroke(); }
      for (const e of half ? [-1] : [-1, 1]) {
        const b = half ? -7 : e * 14, d = -Math.sign(b), cx = b + d * 1.575;   // baseline u, direction into the court
        g.fillStyle = 'rgba(30,60,120,0.5)'; g.fillRect(Math.min(b, b + d * 5.8), -2.45, 5.8, 4.9); g.strokeRect(Math.min(b, b + d * 5.8), -2.45, 5.8, 4.9);
        g.beginPath(); g.arc(b + d * 5.8, 0, 1.8, 0, 6.2832); g.stroke();
        g.beginPath(); g.moveTo(b, -6.6); g.lineTo(b + d * 2.99, -6.6); g.moveTo(b, 6.6); g.lineTo(b + d * 2.99, 6.6); g.stroke();
        g.beginPath(); for (let i = 0; i <= 24; i++) { const t = -1.3 + 2.6 * i / 24, x = cx + d * 6.75 * Math.cos(t), y = 6.75 * Math.sin(t); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        g.beginPath(); g.arc(cx, 0, 0.23, 0, 6.2832); g.stroke();
      }
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0, n = cv.width * cv.height / 40; i < n; i++) { g.fillStyle = i & 1 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'; g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 1.5, 1.5); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; return tex;
}

export class Courts {
  constructor(scene, hf, data) {
    this.scene = scene; this.hf = hf; CT.list = data.items; this.items = data.items.map(f => ({ f, g: null })); this.t = 0; window.__courts = this;
  }
  update(cam) {
    if (++this.t % 12) return; let built = 0;
    for (const it of this.items) {
      const d = Math.hypot(it.f.x - cam.x, it.f.z - cam.z);
      if (!it.g && d < BUILD && built < 1) { this.build(it); built++; } else if (it.g && d > DROP) this.dispose(it);
    }
  }
  dispose(it) { this.scene.remove(it.g); it.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.userData.own) { o.material.map.dispose(); o.material.dispose(); } }); it.g = null; }
  build(it) {
    const f = it.f, hf = this.hf, grp = new THREE.Group(), sport = f.sport; it.g = grp;
    const cs = f.courts, ang = cs[0].ang, c = Math.cos(ang), s = Math.sin(ang), [mu, mv] = MARGIN[sport], rl = f.half ? 14 : REAL[sport][0], rw = REAL[sport][1];
    const frame = (ox, oz) => cs.map(q => ({ q, u: (q.ox - ox) * c + (q.oz - oz) * s, v: -(q.ox - ox) * s + (q.oz - oz) * c }));
    const ext = cu => [Math.min(...cu.map(p => p.u - rl * p.q.k / 2 - mu)), Math.max(...cu.map(p => p.u + rl * p.q.k / 2 + mu)), Math.min(...cu.map(p => p.v - rw * p.q.k / 2 - mv)), Math.max(...cu.map(p => p.v + rw * p.q.k / 2 + mv))];
    let cu = frame(cs[0].ox, cs[0].oz), [a0, a1, b0, b1] = ext(cu);
    const uc = (a0 + a1) / 2, vc = (b0 + b1) / 2, Ox = cs[0].ox + uc * c - vc * s, Oz = cs[0].oz + uc * s + vc * c;   // frame origin = centre of the whole grid
    cu = frame(Ox, Oz); [a0, a1, b0, b1] = ext(cu); const TL = a1 - a0, TW = b1 - b0;
    const P = (u, v) => [Ox + u * c - v * s, Oz + u * s + v * c], gy = (u, v) => { const [x, z] = P(u, v); return hf.height(x, z); };
    // ground quad draped on the terrain, alpha-cut so only courts + run-off show
    const nu = Math.max(2, Math.ceil(TL / 4)), nv = Math.max(2, Math.ceil(TW / 4)), pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const [x, z] = P(-TL / 2 + TL * i / nu, -TW / 2 + TW * j / nv); pos.push(x, hf.height(x, z) + 0.12, z); uv.push(i / nu, 1 - j / nv); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, cc = a + nu + 1; idx.push(a, cc, b, b, cc, cc + 1); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals(); gg.computeBoundingSphere();
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: paint(f, cu, TL, TW), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    ground.userData.own = true; ground.renderOrder = 1; grp.add(ground);
    // 3D
    const S = new Builder(), N = new Builder(), G = new Builder(), steel = rgb(0x8a9098), white = [0.95, 0.95, 0.93], dark = rgb(0x2c3036), mesh = [0.55, 0.6, 0.62], glass = [0.7, 0.88, 0.95];
    const box = (u, v, du, dv, y0, h, col, B = S) => {
      const hu = du / 2, hv = dv / 2, cr = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([x, y]) => P(u + x, v + y)), lo = cr.map(p => [p[0], y0, p[1]]), hi = cr.map(p => [p[0], y0 + h, p[1]]);
      B.quad(hi[0], hi[3], hi[2], hi[1], col); for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; B.quad(lo[k], lo[k2], hi[k2], hi[k], col); }
    };
    const solid = (u, v, du, dv, top) => { const [x, z] = P(u, v); props.box(x, z, du / 2, dv / 2, -ang, top); };
    const panel = (u0, v0, u1, v1, y0, y1, col, B, cell = 1.1) => { const [x0, z0] = P(u0, v0), [x1, z1] = P(u1, v1), rep = Math.hypot(x1 - x0, z1 - z0) / cell, rv = (y1 - y0) / cell; B.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], col, [0, 0, rep, 0, rep, rv, 0, rv]); };
    // wall run: 'g' padel glass (3 m) + mesh to 4 m, 'm' padel mesh 4 m, 't' tennis fence 3.6 m; optional door gap (half width) in the middle
    const wall = (ua, va, ub, vb, kind, gap = 0) => {
      const len = Math.hypot(ub - ua, vb - va), pcs = gap ? [[0, 0.5 - gap / len], [0.5 + gap / len, 1]] : [[0, 1]];
      for (const [a, b] of pcs) {
        const p0 = [ua + (ub - ua) * a, va + (vb - va) * a], p1 = [ua + (ub - ua) * b, va + (vb - va) * b], l = len * (b - a); if (l < 0.3) continue;
        const y0 = (gy(p0[0], p0[1]) + gy(p1[0], p1[1])) / 2 + 0.1, H = kind === 't' ? 3.6 : 4;
        if (kind === 'g') { panel(p0[0], p0[1], p1[0], p1[1], y0, y0 + 3, glass, G); panel(p0[0], p0[1], p1[0], p1[1], y0 + 3, y0 + 4, mesh, N); }
        else panel(p0[0], p0[1], p1[0], p1[1], y0 + (kind === 't' ? 0.3 : 0), y0 + H, mesh, N);
        const n = Math.max(1, Math.round(l / 3)); for (let i = 0; i <= n; i++) { const u = p0[0] + (p1[0] - p0[0]) * i / n, v = p0[1] + (p1[1] - p0[1]) * i / n; box(u, v, 0.1, 0.1, gy(u, v) + 0.1, H, steel); }
        const horiz = Math.abs(ub - ua) > Math.abs(vb - va); solid((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, horiz ? l : 0.14, horiz ? 0.14 : l, y0 + H);
      }
    };
    // a neighbouring court on that side shares the wall: only the + side of a pair is drawn
    const nb = (p, su, sv) => cu.some(o => o !== p && (su ? Math.abs(o.v - p.v) < 3 && Math.sign(o.u - p.u) === su && Math.abs(o.u - p.u) > p.q.L * 0.8 && Math.abs(o.u - p.u) < p.q.L * 1.9
      : Math.abs(o.u - p.u) < 3 && Math.sign(o.v - p.v) === sv && Math.abs(o.v - p.v) > p.q.W * 0.8 && Math.abs(o.v - p.v) < p.q.W * 2.4));
    for (const p of cu) {
      const { q, u, v } = p, k = q.k, hl = q.L / 2, hw = q.W / 2, y0 = gy(u, v) + 0.12;
      if (sport === 'padel') {
        for (const e of [-1, 1]) if (e > 0 || !nb(p, -1, 0)) wall(u + e * hl, v - hw, u + e * hl, v + hw, 'g');
        for (const e of [-1, 1]) if (e > 0 || !nb(p, 0, -1)) {
          const vv = v + e * hw, gl = 3.5 * k; wall(u - hl, vv, u - hl + gl, vv, 'g'); wall(u - hl + gl, vv, u + hl - gl, vv, 'm', e < 0 ? 0.65 : 0); wall(u + hl - gl, vv, u + hl, vv, 'g');
        }
        panel(u, v - hw, u, v + hw, y0, y0 + 0.88, [0.12, 0.12, 0.12], N, 0.2); box(u, v, 0.03, q.W, y0 + 0.85, 0.05, white);
        for (const t of [-1, 1]) box(u, v + t * hw, 0.1, 0.1, y0, 1.0, steel);
        solid(u, v, 0.08, q.W, y0 + 0.9);
      } else if (sport === 'tennis') {
        const fu = hl + 2.4 * k, fv = hw + 1.8 * k;
        for (const e of [-1, 1]) if (e > 0 || !nb(p, -1, 0)) wall(u + e * fu, v - fv, u + e * fu, v + fv, 't');
        for (const e of [-1, 1]) if (e > 0 || !nb(p, 0, -1)) wall(u - fu, v + e * fv, u + fu, v + e * fv, 't', e < 0 ? 0.9 : 0);
        const nw = hw + 0.9 * k; panel(u, v - nw, u, v + nw, y0, y0 + 0.914, [0.85, 0.85, 0.85], N, 0.25); box(u, v, 0.04, 2 * nw, y0 + 0.87, 0.06, white);
        for (const t of [-1, 1]) box(u, v + t * nw, 0.1, 0.1, y0, 1.07, steel);
        solid(u, v, 0.08, 2 * nw, y0 + 0.92);
      } else {
        for (const e of f.half ? [-1] : [-1, 1]) {
          const ub = u + e * (hl + (f.half ? 0 : 1.0)), ue = u + e * (hl - 1.2 * k), yb = gy(ub, v) + 0.12;   // pole at the baseline (or behind it), board 1.2 m inside
          box(ub, v, 0.18, 0.18, yb, 3.3, steel); solid(ub, v, 0.3, 0.3, yb + 3.3);
          box((ub + ue) / 2, v, Math.abs(ub - ue), 0.1, yb + 3.0, 0.1, steel);
          box(ue, v, 0.06, 1.8, yb + 2.9, 1.05, [0.92, 0.95, 0.97]);
          box(ue - e * 0.3, v, 0.45, 0.45, yb + 3.04, 0.03, [0.95, 0.4, 0.1]);
          panel(ue - e * 0.3, v - 0.2, ue - e * 0.3, v + 0.2, yb + 2.5, yb + 3.04, [0.9, 0.9, 0.9], N, 0.12);
        }
      }
    }
    if (f.lit) for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const u = su * (TL / 2 - 0.5), v = sv * (TW / 2 - 0.5), y0 = gy(u, v), hh = sport === 'basketball' ? 8 : 9;
      box(u, v, 0.3, 0.3, y0, hh, steel); box(u - su * 0.3, v, 0.4, 1.6, y0 + hh, 0.6, [0.98, 0.97, 0.85]); box(u - su * 0.35, v, 0.15, 1.8, y0 + hh - 0.08, 0.08, dark); solid(u, v, 0.5, 0.5, y0 + hh);
    }
    grp.add(new THREE.Mesh(S.geometry(false), solidMat()));
    if (N.count) grp.add(new THREE.Mesh(N.geometry(true), meshMat()));
    if (G.count) { const gm = new THREE.Mesh(G.geometry(false), glassMat()); gm.renderOrder = 2; grp.add(gm); }
    this.scene.add(grp);
  }
}
