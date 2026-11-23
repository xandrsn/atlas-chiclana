import * as THREE from 'three';
import { props } from './props.js';
import { stand } from './stairs.js';
const MAPID = new URLSearchParams(location.search).get('map');

// Football pitches (data/football.json, built by scripts/football.mjs from OSM): regulation markings fitted to the real pitch rectangle,
// mown-stripe grass / artificial turf / dirt / painted hard court, goals with nets (solid back + posts), corner flags, perimeter rails or fences
// (with a gate), floodlights, dugouts and a stand for stadiums. Built lazily near the camera: ONE canvas-textured ground quad, ONE vertex-coloured
// solid mesh and ONE alpha-tested net/fence mesh per pitch (3 draw calls), disposed when far.
const BUILD = 380, DROP = 800;
const HARD = [[0x3f7d52, 0x2e5f3c], [0x3e6fa8, 0x2c5280], [0xb5523b, 0x8d3f2c], [0x4a8a5a, 0x35663f]];
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rgb = c => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
const css = c => '#' + c.toString(16).padStart(6, '0');
const shade = (c, k) => { const r = Math.min(255, (c >> 16 & 255) * k) | 0, g = Math.min(255, (c >> 8 & 255) * k) | 0, b = Math.min(255, (c & 255) * k) | 0; return r << 16 | g << 8 | b; };

// Athletics track (400 m, 8 lanes) around a pitch: OSM only has the stadium outline (way 86021326 "Estadio Municipal de Atletismo", Huerta Mata), whose north arc
// matches a standard track centred on pitch w53629674. Standard geometry: 84.39 m straights, 36.5 m inner radius, 1.22 m lanes. Markings are simplified.
const TRACK = { w53629674: { st: 84.39, r: 36.5, lanes: 8, lw: 1.22 } };
const runoff = f => f.kind === 'stadium' || f.kind === '11' ? 3.5 : f.kind === '7' ? 2.4 : 2.2;
/** half extents (along u, across v) of the ground drawn for a pitch: playing field + run-off, or the whole track */
export function half(f) { const t = TRACK[f.id], m = runoff(f); return t ? [t.st / 2 + t.r + t.lanes * t.lw + 2, t.r + t.lanes * t.lw + 2] : [f.L / 2 + m, f.W / 2 + m]; }

/** pitches drawn here: world.js skips its generic (flat colour + thin lines) soccer pitch when one of these covers it */
export const FB = { list: [],
  /** is (x,z) on a pitch, its run-off or its athletics track (+1.5 m)? keeps vegetation off them (world.js) */
  on(x, z) { for (const f of this.list) { const dx = x - f.ox, dz = z - f.oz; if (Math.abs(dx) > 130 || Math.abs(dz) > 130) continue; const c = Math.cos(f.ang), s = Math.sin(f.ang), [hu, hv] = half(f); if (Math.abs(dx * c + dz * s) < hu + 1.5 && Math.abs(-dx * s + dz * c) < hv + 1.5) return true; } return false; },
  covers(cx, cz) { for (const f of this.list) if (Math.hypot(f.x - cx, f.z - cz) < 6) return true; return false; } };

export class Builder {   // flat-shaded vertex-coloured triangles
  constructor() { this.p = []; this.c = []; this.n = []; this.u = []; }
  tri(a, b, c, col, uv) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) { this.c.push(col[0], col[1], col[2]); this.n.push(nx, ny, nz); }
    this.u.push(...(uv || [0, 0, 1, 0, 1, 1]));
  }
  quad(a, b, c, d, col, uv) { this.tri(a, b, c, col, uv && [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5]]); this.tri(a, c, d, col, uv && [uv[0], uv[1], uv[4], uv[5], uv[6], uv[7]]); }
  geometry(withUv) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (withUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere(); return g;
  }
  get count() { return this.p.length / 9; }
}

let netTex = null;
function meshTexture() {   // diamond chain-link / net pattern with alpha
  if (netTex) return netTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineCap = 'square';
  for (const k of [-64, -32, 0, 32, 64]) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); g.beginPath(); g.moveTo(k + 64, 0); g.lineTo(k, 64); g.stroke(); }
  netTex = new THREE.CanvasTexture(c); netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.anisotropy = 4; netTex.colorSpace = THREE.SRGBColorSpace; return netTex;
}
const mats = {};
export const solidMat = () => mats.solid ||= new THREE.MeshLambertMaterial({ vertexColors: true });
export const meshMat = () => mats.mesh ||= new THREE.MeshLambertMaterial({ vertexColors: true, map: meshTexture(), alphaTest: 0.4, side: THREE.DoubleSide });

/** pitch geometry in the pitch frame: u along the length (world dir (cos a, sin a)), v across ((-sin a, cos a)); returns canvas + dims */
function paintGround(f, TL, TW, m) {
  const L = f.L, W = f.W, ppm = Math.max(3, Math.min(14, 2048 / Math.max(TL, TW))), cw = Math.round(TL * ppm), ch = Math.round(TW * ppm);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d'); const rnd = (() => { let s = hash(f.id) || 1; return () => (s = Math.imul(s ^ s >>> 15, 0x2c1b3c6d) + 0x9e3779b9 | 0, (s >>> 8) / 16777216); })();
  const hard = f.surface === 'hard', dirt = f.surface === 'dirt', art = f.surface === 'artificial';
  const hc = HARD[hash(f.id) % HARD.length];
  const X = u => (u + TL / 2) * ppm, Y = v => (v + TW / 2) * ppm;      // metres (centre origin) -> canvas
  // run-off area
  g.fillStyle = hard ? '#6d7074' : dirt ? '#a6845d' : art ? '#2c7a38' : '#4a8230'; g.fillRect(0, 0, cw, ch);
  const tk = TRACK[f.id];
  if (tk) {   // tartan oval: thick red stroke along the mid-lane line, white lane lines, finish line and the 100 m start on the -v straight
    const oval = r => { g.beginPath(); g.moveTo(X(-tk.st / 2), Y(-r)); g.lineTo(X(tk.st / 2), Y(-r)); g.arc(X(tk.st / 2), Y(0), r * ppm, -Math.PI / 2, Math.PI / 2); g.lineTo(X(-tk.st / 2), Y(r)); g.arc(X(-tk.st / 2), Y(0), r * ppm, Math.PI / 2, Math.PI * 1.5); g.closePath(); g.stroke(); };
    const tw = tk.lanes * tk.lw;
    g.strokeStyle = '#8f9296'; g.lineWidth = (tw + 1.2) * ppm; oval(tk.r + tw / 2);   // kerb / drain strip
    g.strokeStyle = '#b5483a'; g.lineWidth = tw * ppm; oval(tk.r + tw / 2);
    g.strokeStyle = '#f3f3ec'; g.lineWidth = Math.max(1.2, 0.05 * ppm); for (let k = 0; k <= tk.lanes; k++) oval(tk.r + k * tk.lw);
    g.lineWidth = Math.max(2, 0.12 * ppm); for (const u of [tk.st / 2, -tk.st / 2]) { g.beginPath(); g.moveTo(X(u), Y(-tk.r)); g.lineTo(X(u), Y(-tk.r - tw)); g.stroke(); }   // finish line and the start of the straight (shortcut: no 100 m chute, no staggered starts)
  }
  // playing surface
  const pl = X(-L / 2), pt = Y(-W / 2), pw = L * ppm, ph = W * ppm;
  if (hard) { g.fillStyle = css(hc[0]); g.fillRect(pl, pt, pw, ph); g.fillStyle = css(hc[1]); g.fillRect(pl - 2.2 * ppm, pt - 2.2 * ppm, 2.2 * ppm, ph + 4.4 * ppm); g.fillRect(pl + pw, pt - 2.2 * ppm, 2.2 * ppm, ph + 4.4 * ppm); g.fillRect(pl, pt - 2.2 * ppm, pw, 2.2 * ppm); g.fillRect(pl, pt + ph, pw, 2.2 * ppm); }
  else if (dirt) { g.fillStyle = '#c49a68'; g.fillRect(pl, pt, pw, ph); }
  else if (art) { g.fillStyle = '#34933f'; g.fillRect(pl, pt, pw, ph); const n = Math.max(6, Math.round(L / 7)); for (let i = 0; i < n; i += 2) { g.fillStyle = 'rgba(0,40,0,0.10)'; g.fillRect(pl + pw * i / n, pt, pw / n, ph); } }
  else { const n = Math.max(8, Math.round(L / 5.2)); for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#4d9a36' : '#5aa941'; g.fillRect(pl + pw * i / n, pt, pw / n + 1, ph); } }
  // texture noise: grass blades / turf fibre / dust / asphalt grain
  const dots = Math.round(cw * ch / (hard ? 70 : 28));
  for (let i = 0; i < dots; i++) { const x = rnd() * cw, y = rnd() * ch, k = rnd(); g.fillStyle = k < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'; g.fillRect(x, y, 1.5, hard ? 1.5 : 3); }
  // wear: goalmouths, centre, penalty spots (bare earth)
  if (!hard) for (const [u, v, r, a] of [[-L / 2 + 6, 0, 6, 0.42], [L / 2 - 6, 0, 6, 0.42], [0, 0, 4, 0.22], [-L / 2 + 11, 0, 1.6, 0.3], [L / 2 - 11, 0, 1.6, 0.3]]) {
    const gr = g.createRadialGradient(X(u), Y(v), 0, X(u), Y(v), r * ppm); gr.addColorStop(0, `rgba(150,118,75,${dirt ? a * 0.5 : a})`); gr.addColorStop(1, 'rgba(150,118,75,0)'); g.fillStyle = gr; g.fillRect(X(u) - r * ppm, Y(v) - r * ppm, 2 * r * ppm, 2 * r * ppm);
  }
  // markings
  g.strokeStyle = dirt ? 'rgba(240,236,222,0.72)' : '#f3f3ec'; g.fillStyle = g.strokeStyle; g.lineCap = 'butt'; g.lineJoin = 'miter';
  const lw = (hard ? 0.08 : 0.12) * ppm; g.lineWidth = Math.max(1.4, lw);
  const line = (u0, v0, u1, v1) => { g.beginPath(); g.moveTo(X(u0), Y(v0)); g.lineTo(X(u1), Y(v1)); g.stroke(); };
  const arc = (u, v, r, a0, a1) => { g.beginPath(); g.arc(X(u), Y(v), r * ppm, a0, a1); g.stroke(); };
  const spot = (u, v, r) => { g.beginPath(); g.arc(X(u), Y(v), r * ppm, 0, 6.2832); g.fill(); };
  const hl = L / 2, hw = W / 2;
  g.strokeRect(pl, pt, pw, ph); line(0, -hw, 0, hw);
  if (hard) {   // futsal: 6 m penalty quarter-circles around each post (3 m goal), 6 m and 10 m spots, centre circle 3 m
    const k = Math.min(L / 40, W / 20, 1.25), R = 6 * k, gw = 3 * k;
    arc(0, 0, 3 * k, 0, 6.2832); spot(0, 0, 0.12);
    for (const s of [-1, 1]) {
      const ue = s * hl;
      for (const t of [-1, 1]) {   // quarter circle around each post, from the goal line to the parallel line
        const a0 = Math.atan2(t, 0), a1 = Math.atan2(0, -s); let dl = a1 - a0; while (dl > Math.PI) dl -= 2 * Math.PI; while (dl <= -Math.PI) dl += 2 * Math.PI;
        g.beginPath(); g.arc(X(ue), Y(t * gw / 2), R * ppm, a0, a1, dl < 0); g.stroke();
      }
      line(ue - s * R, -gw / 2, ue - s * R, gw / 2); spot(ue - s * 6 * k, 0, 0.12); spot(ue - s * 10 * k, 0, 0.1);
      for (const t of [-1, 1]) { const base = Math.atan2(-t, -s); g.beginPath(); g.arc(X(ue), Y(t * hw), 0.4 * ppm, base - Math.PI / 4, base + Math.PI / 4); g.stroke(); }
    }
  } else {
    const kx = L / 105, ky = W / 68, kk = Math.min(kx, ky);
    const pa = [16.5 * kx, 20.16 * ky], ga = [5.5 * kx, 9.16 * ky], ps = 11 * kx, cr = 9.15 * kk;
    arc(0, 0, cr, 0, 6.2832); spot(0, 0, 0.17 * Math.max(0.7, kk) + 0.08);
    for (const s of [-1, 1]) {
      const ue = s * hl, d = (a) => ue - s * a;
      g.strokeRect(Math.min(X(ue), X(d(pa[0]))), Y(-pa[1]), pa[0] * ppm, 2 * pa[1] * ppm);
      g.strokeRect(Math.min(X(ue), X(d(ga[0]))), Y(-ga[1]), ga[0] * ppm, 2 * ga[1] * ppm);
      spot(d(ps), 0, 0.17 * Math.max(0.7, kk) + 0.08);
      const cosA = Math.min(1, (pa[0] - ps) / cr), a = Math.acos(cosA);   // arc of the D, outside the box
      if (s > 0) arc(d(ps), 0, cr, Math.PI - a, Math.PI + a); else arc(d(ps), 0, cr, -a, a);
      for (const t of [-1, 1]) { const cu = s * hl, cvv = t * hw; g.beginPath(); const base = Math.atan2(-t, -s); g.arc(X(cu), Y(cvv), 1 * ppm, base - Math.PI / 4, base + Math.PI / 4); g.stroke(); }
    }
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class Football {
  constructor(scene, hf, buildings, list) {
    FB.list = list; this.scene = scene; this.hf = hf; this.B = buildings; this.items = list.map(f => ({ f, g: null, built: false })); this.t = 0; this.n = 0;
    window.__football = this;
  }
  /** world position of pitch-frame point (u,v) */
  P(f, u, v) { const c = Math.cos(f.ang), s = Math.sin(f.ang); return [f.ox + u * c - v * s, f.oz + u * s + v * c]; }
  update(cam) {
    this.t++; if (this.t % 10 !== 0) return;
    let built = 0;
    for (const it of this.items) {
      const d = Math.hypot(it.f.ox - cam.x, it.f.oz - cam.z);
      if (!it.g && d < BUILD && built < 1) { this.build(it); built++; }
      else if (it.g && d > DROP) { this.dispose(it); }
      else if (it.g) it.g.visible = true;
    }
  }
  dispose(it) {
    this.scene.remove(it.g); it.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.map && o.material.map !== netTex) { o.material.map.dispose(); o.material.dispose(); } }); it.g = null;
    // solids stay registered (props has no removal): they are tiny and static
  }
  build(it, force = false) {
    const f = it.f, hf = this.hf, g = new THREE.Group(); it.g = g;
    const kind = f.kind, big = kind === 'stadium' || kind === '11', m = runoff(f), L = f.L, W = f.W, tk = TRACK[f.id], [hu, hv] = half(f), TL = 2 * hu, TW = 2 * hv;
    // ---- ground quad draped on the terrain
    const nu = Math.max(2, Math.ceil(TL / 5)), nv = Math.max(2, Math.ceil(TW / 5)), pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = -TL / 2 + TL * i / nu, v = -TW / 2 + TW * j / nv, [x, z] = this.P(f, u, v);
      pos.push(x, hf.height(x, z) + 0.12, z); uv.push(i / nu, 1 - j / nv);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeVertexNormals(); gg.computeBoundingSphere();
    const ground = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: paintGround(f, TL, TW, m), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    ground.renderOrder = 1; g.add(ground);
    // ---- solids / nets / fence
    const S = new Builder(), N = new Builder(), white = [0.95, 0.95, 0.93], steel = rgb(0x8a9098), dark = rgb(0x2c3036);
    const gy = (u, v) => { const [x, z] = this.P(f, u, v); return hf.height(x, z); };
    const box = (u, v, du, dv, y0, h, col, B = S) => {   // oriented box centred (u,v), sizes du (along u) x dv, from y0
      const c = Math.cos(f.ang), s = Math.sin(f.ang), hu = du / 2, hv = dv / 2, cr = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([a, b]) => { const x = f.ox + (u + a) * c - (v + b) * s, z = f.oz + (u + a) * s + (v + b) * c; return [x, z]; });
      const y1 = y0 + h, lo = cr.map(p => [p[0], y0, p[1]]), hi = cr.map(p => [p[0], y1, p[1]]);
      B.quad(hi[0], hi[3], hi[2], hi[1], col); for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; B.quad(lo[k], lo[k2], hi[k2], hi[k], col); }
    };
    const solid = (u, v, du, dv, top, walk = false, rotExtra = 0) => { const [x, z] = this.P(f, u, v); props.box(x, z, du / 2, dv / 2, -(f.ang + rotExtra), top, walk); };
    const panel = (u0, v0, u1, v1, y0, y1, col, B = N) => {   // vertical mesh panel between two ground points, UV repeating each 1.1 m
      const [x0, z0] = this.P(f, u0, v0), [x1, z1] = this.P(f, u1, v1), len = Math.hypot(x1 - x0, z1 - z0), rep = len / 1.1, rv = (y1 - y0) / 1.1;
      B.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], col, [0, 0, rep, 0, rep, rv, 0, rv]);
    };
    const gwid = big ? 7.32 : kind === '7' ? 6 : 3, ghgt = big ? 2.44 : kind === '7' ? 2.0 : 2.0, gdep = big ? 2.0 : kind === '7' ? 1.5 : 1.0, th = 0.1;
    for (const s of [-1, 1]) {   // goals
      const ue = s * L / 2, y0 = gy(ue, 0) + 0.12, ub = ue + s * gdep;
      for (const t of [-1, 1]) { box(ue, t * gwid / 2, th, th, y0, ghgt, white); box(ub, t * gwid / 2, th * 0.8, th * 0.8, y0, ghgt * 0.85, steel); solid(ue, t * gwid / 2, th * 1.2, th * 1.2, y0 + ghgt); }
      box(ue, 0, th, gwid + th, y0 + ghgt - th, th, white); box((ue + ub) / 2, -gwid / 2, gdep, th * 0.7, y0 + ghgt * 0.85, th * 0.7, steel); box((ue + ub) / 2, gwid / 2, gdep, th * 0.7, y0 + ghgt * 0.85, th * 0.7, steel);
      // nets: back, two sides, sloping top
      const nb = 0.3; panel(ub, -gwid / 2, ub, gwid / 2, y0, y0 + ghgt * 0.85, [0.9, 0.9, 0.9]); panel(ue, -gwid / 2, ub, -gwid / 2, y0, y0 + ghgt * 0.85, [0.9, 0.9, 0.9]); panel(ue, gwid / 2, ub, gwid / 2, y0, y0 + ghgt * 0.85, [0.9, 0.9, 0.9]); void nb;
      { const [ax, az] = this.P(f, ue, -gwid / 2), [bx, bz] = this.P(f, ue, gwid / 2), [cx, cz] = this.P(f, ub, gwid / 2), [dx, dz] = this.P(f, ub, -gwid / 2), rep = gwid / 1.1, rep2 = gdep / 1.1; N.quad([ax, y0 + ghgt, az], [bx, y0 + ghgt, bz], [cx, y0 + ghgt * 0.85, cz], [dx, y0 + ghgt * 0.85, dz], [0.9, 0.9, 0.9], [0, 0, rep, 0, rep, rep2, 0, rep2]); }
      solid(ub, 0, 0.1, gwid, y0 + ghgt * 0.85); solid((ue + ub) / 2, -gwid / 2, gdep, 0.1, y0 + ghgt * 0.85); solid((ue + ub) / 2, gwid / 2, gdep, 0.1, y0 + ghgt * 0.85);
    }
    // corner flags (big pitches)
    if (big) for (const s of [-1, 1]) for (const t of [-1, 1]) { const u = s * L / 2, v = t * W / 2, y0 = gy(u, v) + 0.12; box(u, v, 0.05, 0.05, y0, 1.6, [0.95, 0.9, 0.3]); box(u - s * 0.2, v, 0.4, 0.02, y0 + 1.25, 0.3, [0.85, 0.12, 0.12]); }
    // ---- perimeter: tall wire fence (courts, 7-a-side, school yards) / low rail (11-a-side, stadium), with a gate
    const fu = hu - 0.4, fv = hv - 0.4, tall = !big, FH = tall ? 4.2 : 1.1, post = tall ? 0.09 : 0.06;
    const gate = { side: -1, half: 1.6 };   // gate on the -v long side, centred
    const seg = (ua, va, ub2, vb, h, gapHalf) => {
      const len = Math.hypot(ub2 - ua, vb - va), pieces = gapHalf ? [[0, 0.5 - gapHalf / len], [0.5 + gapHalf / len, 1]] : [[0, 1]];
      for (const [a, b] of pieces) {
        const p0 = [ua + (ub2 - ua) * a, va + (vb - va) * a], p1 = [ua + (ub2 - ua) * b, va + (vb - va) * b], l = len * (b - a); if (l < 0.3) continue;
        const gy0 = (gy(p0[0], p0[1]) + gy(p1[0], p1[1])) / 2 + 0.1;
        if (tall) { panel(p0[0], p0[1], p1[0], p1[1], gy0 + 0.5, gy0 + h, [0.55, 0.6, 0.62]); box((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(ub2 - ua) > 0.1 ? l : 0.12, Math.abs(ub2 - ua) > 0.1 ? 0.12 : l, gy0, 0.5, rgb(0x9a968e)); }
        else box((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, Math.abs(ub2 - ua) > 0.1 ? l : 0.1, Math.abs(ub2 - ua) > 0.1 ? 0.1 : l, gy0 + 0.6, 0.12, [0.9, 0.92, 0.95]);
        const n = Math.max(1, Math.round(l / 3.2)); for (let i = 0; i <= n; i++) { const u = p0[0] + (p1[0] - p0[0]) * i / n, v = p0[1] + (p1[1] - p0[1]) * i / n; box(u, v, post, post, gy(u, v) + 0.1, h, tall ? steel : [0.8, 0.82, 0.86]); }
        const horiz = Math.abs(ub2 - ua) > 0.1; solid((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, horiz ? l : 0.14, horiz ? 0.14 : l, gy0 + (tall ? h : 1.0));
      }
    };
    seg(-fu, -fv, fu, -fv, FH, gate.half); seg(-fu, fv, fu, fv, FH, big ? 1.8 : 0); seg(-fu, -fv, -fu, fv, FH, 0); seg(fu, -fv, fu, fv, FH, 0);
    // ---- floodlights (11-a-side, stadium, 7-a-side)
    if (kind !== 'sala' && kind !== 'school') for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const u = s * (hu + 1.5), v = t * (hv + 1.5), y0 = gy(u, v), hh = big ? 16 : 9;
      box(u, v, 0.35, 0.35, y0, hh, steel); box(u - s * 0.4, v, 0.5, 2.4, y0 + hh, 0.9, [0.98, 0.97, 0.85]); box(u - s * 0.45, v, 0.2, 2.6, y0 + hh - 0.1, 0.1, dark); solid(u, v, 0.6, 0.6, y0 + hh);
    }
    // ---- dugouts and stand
    if (big) {
      const v0 = tk ? W / 2 + 1.6 : W / 2 + m + 3.2;   // inside the track: on the infield
      for (const s of [-1, 1]) { const u = s * 8, y0 = gy(u, v0); box(u, v0, 6, 1.4, y0, 0.06, dark); box(u, v0 + 0.4, 6, 0.1, y0, 2.2, [0.45, 0.6, 0.7]); box(u, v0, 6.4, 1.8, y0 + 2.2, 0.12, rgb(0xcfd3d8)); box(u, v0 - 0.2, 5, 0.4, y0 + 0.4, 0.45, [0.2, 0.3, 0.55]); solid(u, v0, 6.4, 1.8, y0 + 2.3); }
    }
    // ---- grandstands (stairs.js): walkable tiers + aisle stairs. Real layout unknown -> guessed sizes per venue (see docs/PLAN.md)
    const STANDS = { w184503719: [{ axis: 'v', len: W * 0.7, rows: 10, roof: true, front: L / 2 + m + 6 }, { axis: 'v', side: -1, len: W * 0.5, rows: 6, front: L / 2 + m + 6 }],   // Estadio Municipal (old ground): behind the goals, the long sides are covered by Catastro buildings
      w479104708: [{ len: 42, rows: 6, roof: true, side: -1 }] }[f.id];   // Huerta Mata, next to the athletics track (the +v side is covered by a Catastro building): roofed stand (~250 seats, Diario Bahia de Cadiz)
    // Chiclana: ONLY those two grounds have stands (user, 2026-11-12). Madrid keeps the guessed four-side stands of the previous batch.
    const ALL = kind === 'stadium' ? [8, 6] : kind === '11' ? [4, 3] : kind === '7' ? [3, 2] : [2, 0];
    const around = [{ len: L * 0.6, rows: ALL[0], side: 1 }, { len: L * 0.6, rows: ALL[0], side: -1 }, ...(ALL[1] ? [{ axis: 'v', len: W * 0.55, rows: ALL[1], side: 1, front: L / 2 + m + 6 }, { axis: 'v', len: W * 0.55, rows: ALL[1], side: -1, front: L / 2 + m + 6 }] : [])];
    for (const st of STANDS || (MAPID === 'madrid' ? around : []))
      stand({ gy, box, solid }, { front: W / 2 + m + 6, side: 1, ...st });
    const sm = new THREE.Mesh(S.geometry(false), solidMat()); g.add(sm);
    if (N.count) { const nm = new THREE.Mesh(N.geometry(true), meshMat()); g.add(nm); }
    this.scene.add(g); it.built = true; this.n++;
    return g;
  }
}
