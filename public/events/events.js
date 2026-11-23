// Switchable events (data/events.json): each one is built on the client when switched on AND the player is near, disposed when off / far.
// Draw cost per active event: 1 merged static mesh (everything: stages, stalls, awnings, bulbs, cars, fences; night glow + spinning wheel / carousels
// in the vertex shader) + 2 for its own Crowd (peds/crowd.js: skinned near, lowpoly far) = 3. Switched off or far away: nothing exists (0 draw calls).
// Geometry is built by generators in small time slices (<= BUDGET ms per frame) so switching on never hitches.
import * as THREE from 'three';
import { Builder, rng, pick } from '../lowpoly.js';
import { Crowd } from '../peds/crowd.js';

const D2R = Math.PI / 180, R = 6378137, BUDGET = 6, KEY = 'v2.events', V3 = THREE.Vector3;
const store = (v) => { try { return v === undefined ? localStorage.getItem(KEY) : localStorage.setItem(KEY, v); } catch { return null; } };

/** lon/lat -> local metres of a map (same maths as public/js/geo.js; x east, z south) */
export function projector(o) {
  const m = (lon, lat) => [R * lon * D2R, R * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))], [x0, y0] = m(o.lon, o.lat), K = Math.cos(o.lat * D2R);
  return (lon, lat) => { const [x, y] = m(lon, lat); return [(x - x0) * K, (y0 - y) * K]; };
}

/** pure schema check of the catalogue (used by scripts/events_v2_test.mjs); returns a list of problems */
export function validateCatalog(cat, maps) {
  const bad = [], ids = new Set(), num = (v, a, b) => typeof v === 'number' && v >= a && v <= b;
  if (!Array.isArray(cat.events) || !cat.events.length) return ['no events'];
  for (const e of cat.events) {
    const w = e.id || '?'; if (!/^[a-z0-9-]+$/.test(w) || ids.has(w)) bad.push(w + ': id'); ids.add(w);
    const m = maps.maps[e.map]; if (!m) { bad.push(w + ': map'); continue; }
    if (typeof e.name !== 'string' || !e.name) bad.push(w + ': name');
    if (!['festival', 'feria', 'rastro', 'match'].includes(e.kind)) bad.push(w + ': kind');
    const [x0, y0, x1, y1] = m.extent; if (!num(e.place?.lon, x0, x1) || !num(e.place?.lat, y0, y1)) bad.push(w + ': place outside the map extent');
    if (!num(e.area?.r, 20, 800)) bad.push(w + ': area.r');
    if (!Array.isArray(e.generates) || !e.generates.length) bad.push(w + ': generates');
    if (!Array.isArray(e.sources) || !e.sources.length) bad.push(w + ': sources');
    if (!num(e.crowd?.n, 1, 400) || !Array.isArray(e.crowd.palette) || !e.crowd.palette.every(c => /^#[0-9a-f]{6}$/i.test(c))) bad.push(w + ': crowd');
    for (const l of e.axes || []) if (l.length % 2 || l.length < 4) bad.push(w + ': axis');
    if (e.closure && !num(e.closure.r, 10, 800)) bad.push(w + ': closure');
    if (JSON.stringify(e).match(/gta|grand theft/i)) bad.push(w + ': forbidden name');
  }
  return bad;
}

// Unlit vertex-colour material with: aBone = kind + 10 * glow (kind 1 rigid wheel about uHub/uAx, 2 gondola hung at aPivot, 3 spins about the vertical through aPivot);
// glow vertices ignore the day tint (uInv = 1 / tint, mixed in by uGlow = night)
function makeMat() {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true }), u = { uT: { value: 0 }, uGlow: { value: 0 }, uInv: { value: new V3(1, 1, 1) }, uHub: { value: new V3() }, uAx: { value: new V3(0, 0, 1) } };
  m.userData.u = u; m.customProgramCacheKey = () => 'events';
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = `uniform float uT, uGlow; uniform vec3 uInv, uHub, uAx; attribute float aBone; attribute vec3 aPivot;
vec3 rotA(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
` + s.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = vec3(position); float kd = aBone - floor(aBone * 0.1) * 10.0;
if (kd > 0.5) {
  if (kd < 1.5) transformed = uHub + rotA(position - uHub, uAx, uT * 0.12);
  else if (kd < 2.5) transformed = uHub + rotA(aPivot - uHub, uAx, uT * 0.12) + (position - aPivot);
  else transformed = aPivot + rotA(position - aPivot, vec3(0.0, 1.0, 0.0), uT * 0.7);
}`).replace('#include <color_vertex>', `#include <color_vertex>
  if (aBone > 9.5) vColor *= mix(vec3(1.0), uInv * 1.25, uGlow);`);
  };
  return m;
}

/** geometry kit: oriented boxes into one Builder, snapped to the ground */
function kit(gy, seed, dry = () => true) {
  const B = new Builder(), r = rng(seed), api = {
    B, r, gy,
    /** box from centre + half-vectors */
    ob3(c, ex, ey, ez, col, k = 0, glow = 0, pv = [0, 0, 0]) {
      if (!dry(c[0], c[2])) return;   // nothing stands on water
      B.style(col).rig(k + 10 * glow, pv);
      const q = []; for (let i = 0; i < 8; i++) { const a = i & 1 ? 1 : -1, b = i & 2 ? 1 : -1, d = i & 4 ? 1 : -1; q.push(new V3(c[0] + a * ex[0] + b * ey[0] + d * ez[0], c[1] + a * ex[1] + b * ey[1] + d * ez[1], c[2] + a * ex[2] + b * ey[2] + d * ez[2])); }
      B.hexa(q);
    },
    /** yawed box on the ground: centre (x, z), w along local x, d along local z (facing), height h, yaw a, base lift y0 */
    ob(x, z, w, d, h, a, col, y0 = 0, o = {}) {
      const c = Math.cos(a), s = Math.sin(a), sink = y0 ? 0 : 0.3;
      api.ob3([x, gy(x, z) + y0 - sink + (h + sink) / 2, z], [w / 2 * c, 0, -w / 2 * s], [0, (h + sink) / 2, 0], [d / 2 * s, 0, d / 2 * c], col, o.k, o.glow, o.pv);
    },
    /** sloped striped canopy (two-sided): centre (x, z), width w along local x, depth d along local z (front = +z), yaw a, front / back heights above the ground */
    awning(x, z, w, d, a, hf, hb, c1, c2) {
      if (!dry(x, z)) return;
      const c = Math.cos(a), s = Math.sin(a), n = Math.max(2, Math.round(w / 0.55)), g = gy(x, z), P = (lx, lz, h) => new V3(x + lx * c + lz * s, g + h, z - lx * s + lz * c);
      for (let i = 0; i < n; i++) {
        const l0 = -w / 2 + w * i / n, l1 = -w / 2 + w * (i + 1) / n; B.style(i & 1 ? c1 : c2).rig(0, [0, 0, 0]);
        const q = [P(l0, -d / 2, hb), P(l1, -d / 2, hb), P(l1, d / 2, hf), P(l0, d / 2, hf)], m = P(0, 0, (hf + hb) / 2);
        B.quad(...q, new V3(m.x, m.y - 5, m.z)); B.quad(...q, new V3(m.x, m.y + 5, m.z));
      }
    },
    /** a string of glowing bulbs between two ground points at height h with sag */
    bulbs(x0, z0, x1, z1, h, sag, n, cols) {
      for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = h - 4 * sag * t * (1 - t); api.ob3([x, gy(x, z) + y, z], [0.07, 0, 0], [0, 0.07, 0], [0, 0, 0.07], cols[i % cols.length], 0, 1); }
    },
    /** a car-sized parked vehicle */
    car(x, z, a, col) { api.ob(x, z, 1.8, 4.3, 0.85, a, col, 0.25); api.ob(x - Math.sin(a) * 0.2, z - Math.cos(a) * 0.2, 1.6, 2.2, 0.65, a, '#2a3038', 1.05); },
    /** a standing person-sized figure (police: navy, hi-vis) */
    cop(x, z, a) { api.ob(x, z, 0.5, 0.3, 0.95, a, '#1d2a52', 0.8); api.ob(x, z, 0.52, 0.32, 0.5, a, '#d8e04a', 1.15, { glow: 1 }); api.ob(x, z, 0.24, 0.24, 0.24, a, '#e0b090', 1.65); api.ob(x, z, 0.26, 0.26, 0.1, a, '#1d2a52', 1.88); },
    /** barrier panel centred at (x, z), length w along yaw a */
    fence(x, z, w, a, col = '#8d9299') { api.ob(x, z, w, 0.08, 1.1, a, col, 0.05); },
    /** a market / bar stall facing local +z (counter, goods, striped canopy) */
    stall(x, z, a, w, d, c1, c2, goods) {
      const c = Math.cos(a), s = Math.sin(a), f = (q) => [x + s * q, z + c * q];
      api.ob(x, z, w, d, 1, a, '#d8d2c4', 0.0); api.ob(...f(d * 0.15), w * 0.9, d * 0.5, 0.35, a, goods, 1.0);
      for (const sx of [-1, 1]) api.ob(x + c * sx * w / 2 * 0.95 + s * d * 0.45, z - s * sx * w / 2 * 0.95 + c * d * 0.45, 0.1, 0.1, 2.5, a, '#4a4a4a');
      const [ax, az] = f(d * 0.15); api.awning(ax, az, w, d + 0.8, a, 2.2, 2.7, c1, c2);
    },
  };
  return api;
}

/** the baked ground clamps water to y 0.2 (shore ~0.45): anything at or under 0.5 m is water; unloaded ground counts as dry */
export const dryAt = (g, x, z) => (g.terrain(x, z)?.y ?? 9) > 0.5;
function wetShare(g, x, z, r) { let n = 0, w = 0; for (let i = 0; i < 48; i++) { const t = i / 48 * 6.283, d = r * Math.sqrt((i % 6 + 0.5) / 6); n++; if (!dryAt(g, x + Math.cos(t) * d, z + Math.sin(t) * d)) w++; } return w / n; }
const yawOf = compass => Math.PI - compass * D2R;   // local +z faces this compass heading (0 = north)
const SPIN = { k: 3 };

/** polyline (flat x, z) walked every `step` m: fn(x, z, ux, uz, i); resumable pieces of work are yielded by the callers */
function along(p, step, fn) {
  let rem = 0, i = 0;
  for (let q = 0; q + 3 < p.length; q += 2) {
    const dx = p[q + 2] - p[q], dz = p[q + 3] - p[q + 1], L = Math.hypot(dx, dz); if (!L) continue; const ux = dx / L, uz = dz / L; let s = rem;
    for (; s <= L; s += step) fn(p[q] + ux * s, p[q + 1] + uz * s, ux, uz, i++);
    rem = s - L;
  }
}
const offset = (p, o) => { const out = []; for (let q = 0; q < p.length; q += 2) { const a = Math.max(0, q - 2), b = Math.min(p.length - 2, q + 2), dx = p[b] - p[a], dz = p[b + 1] - p[a + 1], L = Math.hypot(dx, dz) || 1; out.push(p[q] - dz / L * o, p[q + 1] + dx / L * o); } return out; };

// ---- builders: generators, each `yield` is a chance to hand the frame back
const BUILD = {
  *festival(E) {
    const { K, c, ev } = E, a0 = ev.heading * D2R, f = [Math.sin(a0), -Math.cos(a0)];
    const yaw = yawOf(ev.heading), P = (u, v) => [c[0] + f[0] * u + Math.cos(yaw) * v, c[1] + f[1] * u - Math.sin(yaw) * v];
    const O = (u, v, w, d, h, col, y0, o) => K.ob(...P(u, v), w, d, h, yaw, col, y0, o);
    // stage: deck, back wall, roof truss on four towers, LED screens, speaker stacks
    O(-4, 0, 30, 16, 1.6, '#25272b'); O(-11, 0, 30, 0.6, 10, '#17181b', 1.6);
    for (const v of [-14, 14]) for (const u of [-11, 3]) O(u, v, 0.9, 0.9, 12, '#3a3d44', 1.6);
    O(-4, 0, 31, 17, 1, '#2a2c31', 13.4); O(-4, 0, 30, 15, 0.5, '#d4d8e0', 14.4, { glow: 1 });
    for (let i = -6; i <= 6; i++) O(1.5, i * 2.2, 0.5, 0.5, 0.5, '#fff1c8', 12.6, { glow: 1 });   // light bar
    O(-10.4, 0, 14, 0.5, 8, '#6a3dff', 3.2, { glow: 1 });   // centre LED wall
    for (const v of [-19, 19]) { O(-6, v, 0.5, 8, 9, '#ff3d8a', 2.2, { glow: 1 }); O(-6, v * 1.07, 3, 3, 8, '#17181b', 2.2); }   // side screens + speaker hangs
    yield;
    // light / sound towers in the field and the mixing desk
    for (const [u, v] of [[34, -26], [34, 26], [62, -34], [62, 34], [88, 0]]) { O(u, v, 0.8, 0.8, 11, '#3a3d44'); O(u, v, 2.6, 1.0, 1.1, '#fff4d0', 11, { glow: 1 }); O(u, v, 1.4, 1.4, 2.2, '#17181b', 8.6); }
    O(48, 0, 6, 5, 2.4, '#e7e7e7', 0); O(48, 0, 6.4, 5.4, 0.3, '#b21f2d', 2.4);
    // front-of-stage barrier arc and perimeter fence with gates
    for (let i = -8; i <= 8; i++) { const v = i * 3.9; O(8.5 + Math.abs(i) * 0.5, v, 3.9, 0.15, 1.2, '#8d9299', 0.05); }
    yield;
    for (let u = 8; u < 130; u += 4) for (const v of [-50, 50]) O(u, v, 4, 0.1, 2, '#7d8793', 0.05);
    for (let v = -50; v < 50; v += 4) { if (Math.abs(v) > 10) O(130, v, 4, 0.1, 2, '#7d8793', 0.05); O(-26, v, 4, 0.1, 2, '#7d8793', 0.05); }
    for (const v of [-10, 10]) O(124, v, 0.8, 0.8, 3.2, '#c8322b');   // gate posts
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) O(134 + i * 5, s * (3 + (i & 1) * 2.4), 0.1, 4, 1.1, '#8d9299', 0.05);   // queue maze
    for (let u = 4; u < 130; u += 9) for (const v of [-50, 50]) O(u, v, 0.1, 0.1, 6, '#fff4d0', 5, { glow: 1 });   // lamps on the fence
    yield;
    // bars and food trucks along both sides of the field
    const cols = [['#e7e7e7', '#b21f2d'], ['#e7e7e7', '#1f6fb5'], ['#e7e7e7', '#d9a21a']];
    for (let i = 0; i < 6; i++) { const [c1, c2] = cols[i % 3], v = (i & 1 ? 1 : -1) * 42, u = 22 + (i >> 1) * 30; const [x, z] = P(u, v); K.stall(x, z, yaw + (v > 0 ? Math.PI : 0), 6, 3, c1, c2, '#8b5a2b'); K.ob(...P(u, v), 6.2, 0.2, 0.12, yaw, '#ffd27a', 2.9, { glow: 1 }); }
    for (let i = 0; i < 5; i++) { const u = 18 + i * 20, v = (i & 1 ? 1 : -1) * 31, col = pick(K.r, ['#e23c3c', '#f2c230', '#30b060', '#2f6fe0', '#f4f4f0']); O(u, v, 2.2, 5.5, 2.6, col, 0.3); O(u, v, 2.3, 2.6, 0.9, '#2a2a2a', 1.4); O(u, v, 2.6, 6, 0.15, '#fff', 3.3, { glow: 1 }); }
    yield;
    // car park: six zones of rows, full, beyond the gate
    for (let zone = 0; zone < 2; zone++) for (let row = 0; row < 3; row++) for (let i = 0; i < 18; i++) {
      const u = 150 + row * 9 + zone * 34, v = -48 + i * 5.4 + (zone ? 2 : 0); if (K.r() < 0.06) continue;
      O(u, v, 0.15, 4.6, 0.02, '#8e8b86', 0.05); const [x, z] = P(u, v); K.car(x, z, yaw + Math.PI / 2, pick(K.r, ['#e8e8ea', '#2a2d35', '#b5262d', '#21418f', '#8e9399', '#e2c26a', '#2f7a46', '#f4f4f0']));
    }
    for (let v = -52; v <= 52; v += 26) for (const u of [145, 170, 195]) O(u, v, 0.15, 0.15, 7, '#3a3d44', 0, {}), O(u, v, 0.8, 0.8, 0.35, '#fff4d0', 7, { glow: 1 });
    yield;
    // crowd lanes: the fan in front of the stage, the gate and the car park
    for (let v = -44; v <= 44; v += 7) E.ways.push([P(14, v), P(84, v)].flat()), E.ways.push([P(84, v), P(60, v + 3.5), P(14, v)].flat());
    E.ways.push([P(84, -50), P(120, -8), P(140, 0), P(190, 0)].flat(), [P(84, 50), P(120, 8), P(140, 0)].flat(), [P(150, -48), P(150, 48)].flat(), [P(165, -48), P(165, 48)].flat());
    E.focus = P(60, 0);
  },

  *feria(E) {
    const { K, ev, pr } = E, L = E.data, el = L.design.elements, W = e => pr(e.at[0], e.at[1]);
    const garl = el.filter(e => e.kind === 'garland').map(W).sort((a, b) => a[1] - b[1]), axis = garl.flat(), cas = el.filter(e => e.kind === 'caseta');
    const bulbCols = ['#ffd27a', '#ff7a5a', '#fff1c8', '#8ad0ff', '#ffb0d0'];
    for (const e of cas) {   // striped canopy over the front of every booth + a bulb string along its front edge
      const [x, z] = W(e), [w, , d] = e.size, yaw = yawOf(e.rot), fx = Math.sin(e.rot * D2R), fz = -Math.cos(e.rot * D2R), q = d / 2 + 1.3, cx = x + fx * q, cz = z + fz * q;
      K.ob(x, z, w * 0.96, d * 0.96, e.size[1] * 0.96, yaw, e.color || '#c8322b');   // slightly inside the baked booth (if it is there): never z-fights, and shows when the bake lacks it
      K.awning(cx, cz, w, 3, yaw, 2.4, 3.3, e.color || '#c8322b', '#fbf6ec');
      K.bulbs(cx + fx * 1.5 - Math.cos(yaw) * w / 2, cz + fz * 1.5 + Math.sin(yaw) * w / 2, cx + fx * 1.5 + Math.cos(yaw) * w / 2, cz + fz * 1.5 - Math.sin(yaw) * w / 2, 2.4, 0.3, 10, bulbCols);
    }
    yield;
    for (let i = 0; i + 1 < garl.length; i++) {   // farolillos hanging across the Real street + bulb lines down its length
      const [x, z] = garl[i], [x2, z2] = garl[i + 1], dx = x2 - x, dz = z2 - z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 9, nz = dx / l * 9;
      K.bulbs(x - nx, z - nz, x + nx, z + nz, 6.2, 0.6, 14, bulbCols);
      for (let k = 0; k < 6; k++) { const t = (k + 0.5) / 6, hx = x + nx * (2 * t - 1), hz = z + nz * (2 * t - 1); K.ob3([hx, K.gy(hx, hz) + 5.5 - 4 * 0.6 * t * (1 - t) * 0, hz], [0.22, 0, 0], [0, 0.32, 0], [0, 0, 0.22], pick(K.r, ['#e23c3c', '#fff1c8', '#e23c3c', '#ffb02a']), 0, 1); }
    }
    for (const s of [-1, 1]) K.bulbs(...offset(axis.slice(0, 4), 9 * s), 4.5, 0.5, 4, bulbCols);
    yield;
    // portada: lit arch (the baked one stays; this adds the bulbs outlining it)
    const por = el.find(e => e.kind === 'portada'), [px, pz] = W(por), py = yawOf(por.rot);
    for (let i = 0; i <= 28; i++) { const t = i / 28 - 0.5, h = por.size[1] - 1 * Math.abs(t) * 0; K.ob3([px + Math.cos(py) * t * 34, K.gy(px, pz) + h + 0.4, pz - Math.sin(py) * t * 34], [0.12, 0, 0], [0, 0.12, 0], [0, 0, 0.12], bulbCols[i % 5], 0, 1); }
    yield;
    // noria (rigid wheel + hanging gondolas, turning in the shader) and two spinning rides to the east of the fairground
    const [ax, az] = [garl[Math.floor(garl.length * 0.3)][0] + 58, garl[Math.floor(garl.length * 0.3)][1]], Rr = 15, hub = [ax, K.gy(ax, az) + Rr + 3, az], n = [1, 0, 0], t = [0, 0, 1];
    E.hub = new V3(...hub); E.ax = new V3(...n);
    const pt = (th, rr) => [hub[0], hub[1] + Math.sin(th) * rr, hub[2] + Math.cos(th) * rr];
    for (let i = 0; i < 24; i++) {
      const a0 = i / 24 * 6.2832, a1 = (i + 1) / 24 * 6.2832, m = (a0 + a1) / 2, p = pt(m, Rr), len = Rr * (a1 - a0) / 2 + 0.1;
      K.ob3(p, [0, Math.cos(m) * len, -Math.sin(m) * len], [0, Math.sin(m) * 0.2, Math.cos(m) * 0.2], [0.35, 0, 0], '#e8e8e8', 1);
      K.ob3(p, [0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1], bulbCols[i % 5], 1, 1);
      if (i % 2 === 0) { const hp = pt(a0, Rr); K.ob3([hp[0], hp[1] - 1.1, hp[2]], [0.9, 0, 0], [0, 0.7, 0], [0, 0, 0.9], ['#e23c3c', '#2f6fe0', '#f2c230', '#30b060'][(i / 2) % 4], 2, 0, hp); K.ob3([hp[0], hp[1] - 0.3, hp[2]], [0.06, 0, 0], [0, 0.4, 0], [0.06, 0, 0], '#888', 2, 0, hp); }
      if (i % 3 === 0) { const a = pt(a0, 0), b = pt(a0, Rr); K.ob3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [0.15, 0, 0], [0, Math.sin(a0) * Rr / 2, Math.cos(a0) * Rr / 2], [0.12, 0, 0], '#d8d8d8', 1); }
    }
    for (const s of [-1, 1]) K.ob3([hub[0] + s * 1.6, hub[1] - Rr / 2 - 1.2, hub[2]], [0.3, 0, 0], [0, Rr / 2 + 1.5, Rr * 0.28], [0.3, 0, 0], '#9aa0a8'), K.ob3([hub[0] + s * 1.6, hub[1] - Rr / 2 - 1.2, hub[2]], [0.3, 0, 0], [0, Rr / 2 + 1.5, -Rr * 0.28], [0.3, 0, 0], '#9aa0a8');   // A-frame legs
    K.ob3([hub[0], hub[1], hub[2]], [1.9, 0, 0], [0, 0.5, 0], [0, 0, 0.5], '#e23c3c', 0, 1);
    yield;
    for (const [dx, dz, col] of [[58, 40, '#1f6fb5'], [58, -30, '#e67e22'], [70, 5, '#c8322b']]) {   // "pulpo" rides: arms spin about their own centre
      const x = ax - 58 + dx - 6, z = az + dz, g = K.gy(x, z), pv = [x, g, z];
      K.ob3([x, g + 0.5, z], [1.4, 0, 0], [0, 0.5, 0], [0, 0, 1.4], '#3a3d44');
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.2832, ex = x + Math.cos(a) * 4.2, ez = z + Math.sin(a) * 4.2; K.ob3([(x + ex) / 2, g + 3.2, (z + ez) / 2], [Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2], [0, 0.12, 0], [0.12, 0, 0.12], '#d8d8d8', 3, 0, pv); K.ob3([ex, g + 2.4, ez], [0.7, 0, 0], [0, 0.5, 0], [0, 0, 0.7], col, 3, 0, pv); K.ob3([ex, g + 3.1, ez], [0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1], bulbCols[k % 5], 3, 1, pv); }
      K.ob3([x, g + 3.2, z], [0.5, 0, 0], [0, 0.4, 0], [0, 0, 0.5], '#ffd27a', 3, 1, pv);
    }
    yield;
    for (let i = 0; i < 5; i++) {   // horse-drawn carriages parked along the Real street
      const [x, z] = garl[3 + i * 3] || garl[0], a = yawOf(185 + (i & 1) * 180), s = i & 1 ? 1 : -1, cx = x + s * 7, cz = z;
      K.ob(cx, cz, 1.5, 2.6, 0.9, a, '#1b1b1d', 0.8); K.ob(cx, cz, 1.6, 1.6, 0.8, a, ['#e23c3c', '#f2c230', '#2f6fe0'][i % 3], 1.7);
      for (const wx of [-0.85, 0.85]) for (const wz of [-0.9, 0.9]) K.ob(cx + Math.cos(a) * wx + Math.sin(a) * wz, cz - Math.sin(a) * wx + Math.cos(a) * wz, 0.1, 0.9, 0.9, a + Math.PI / 2, '#3a2a1a', 0.1);
      const hx = cx + Math.sin(a) * 3.2, hz = cz + Math.cos(a) * 3.2; K.ob(hx, hz, 0.7, 1.9, 0.95, a, '#6b4423', 0.8); K.ob(hx + Math.sin(a) * 1.2, hz + Math.cos(a) * 1.2, 0.3, 0.6, 0.6, a, '#6b4423', 1.5);
      for (const lx of [-0.2, 0.2]) for (const lz of [-0.7, 0.7]) K.ob(hx + Math.cos(a) * lx + Math.sin(a) * lz, hz - Math.sin(a) * lx + Math.cos(a) * lz, 0.12, 0.12, 0.85, a, '#4a2f18', 0);
    }
    for (const q of [-3, 0, 3]) E.ways.push(offset(axis, q));
    for (const q of [-12, 12]) E.ways.push(offset(axis, q));
    E.focus = garl[Math.floor(garl.length / 2)];
  },

  *rastro(E) {
    const { K } = E, pal = [['#c8322b', '#fbf6ec'], ['#1f6fb5', '#fbf6ec'], ['#2e8b57', '#fbf6ec'], ['#d9a21a', '#fbf6ec'], ['#7a3b8a', '#f2e6c8'], ['#e67e22', '#fbf6ec']];
    const goods = ['#8b5a2b', '#c9a464', '#4a6a8a', '#a33b3b', '#6a8a4a', '#d8d2c4'];
    for (const ax of E.axes) {
      along(ax, 3.4, (x, z, ux, uz) => {
        for (const s of [-1, 1]) { const [c1, c2] = pick(K.r, pal); K.stall(x - uz * 3 * s, z + ux * 3 * s, Math.atan2(s * uz, -s * ux), 2.7, 1.6, c1, c2, pick(K.r, goods)); }   // facing the street axis
      });
      yield;
    }
    for (const ax of E.axes) for (const o of [-1.2, 0, 1.2]) E.ways.push(offset(ax, o));
    E.focus = [E.c[0], E.c[1]];
  },

  *match(E) {
    const { K, ev, pr } = E; let cx = 0, cz = 0;
    const out = []; for (let i = 0; i < ev.outline.length; i += 2) out.push(...pr(ev.outline[i], ev.outline[i + 1]));
    for (let i = 0; i < out.length; i += 2) { cx += out[i] / (out.length / 2); cz += out[i + 1] / (out.length / 2); }
    // stadium light: glowing band on the roof line + floodlight masts
    for (let i = 0; i < out.length; i += 2) {
      const j = (i + 2) % out.length, x0 = out[i], z0 = out[i + 1], x1 = out[j], z1 = out[j + 1], l = Math.hypot(x1 - x0, z1 - z0), m = [(x0 + x1) / 2, (z0 + z1) / 2], a = Math.atan2(x1 - x0, z1 - z0);
      if (l > 0.5) K.ob(m[0], m[1], 0.7, l + 0.4, 1.2, a, '#fff6dc', 44, { glow: 1 });
      if (i % 6 === 0) { const ix = m[0] + (cx - m[0]) * 0.02, iz = m[1] + (cz - m[1]) * 0.02; K.ob(ix, iz, 0.7, 0.7, 40, 0, '#4a4f58', 0); K.ob(ix, iz, 3.2, 1.2, 1.4, a, '#fff6dc', 40, { glow: 1 }); }
    }
    yield;
    const stand = (x, z, ux, uz) => {   // scarf stall on the pavement, open towards the street axis
      const yaw = Math.atan2(ux, uz) - Math.PI / 2; K.stall(x - uz * 5, z + ux * 5, yaw, 3, 1.6, '#fbfbf7', '#1f3a6b', '#e8e6e2');
      for (let k = 0; k < 4; k++) K.ob(x - uz * 5 + ux * (k - 1.5) * 0.7, z + ux * 5 + uz * (k - 1.5) * 0.7, 0.35, 0.05, 0.9, yaw, k & 1 ? '#fbfbf7' : '#3b5db0', 1.2);
    };
    for (const ax of E.axes) { let k = 0; along(ax, 22, (x, z, ux, uz) => { if (Math.hypot(x - cx, z - cz) < 280 && k++ % 2 === 0) stand(x, z, ux, uz); }); }
    yield;
    // closures: barriers + patrol car + officers where the street axes cross the ring
    for (const ax of E.axes) along(ax, 5, (x, z, ux, uz) => {
      const d = Math.hypot(x - cx, z - cz); if (Math.abs(d - 300) > 2.6 || E.shut.some(q => Math.hypot(q[0] - x, q[1] - z) < 22)) return;
      E.shut.push([x, z]); const a = Math.atan2(ux, uz);
      for (let k = -2; k <= 2; k++) K.fence(x - uz * k * 2.6, z + ux * k * 2.6, 2.6, a, '#e7e7e7');
      K.car(x + ux * 6, z + uz * 6, a, '#f4f4f0'); K.ob(x + ux * 6, z + uz * 6, 1.4, 0.3, 0.2, a, '#3d7bff', 2.0, { glow: 1 });
      K.cop(x + ux * 2 - uz * 3, z + uz * 2 + ux * 3, a); K.cop(x + ux * 2 + uz * 3, z + uz * 2 - ux * 3, a);
    });
    for (const ax of E.axes) for (const o of [-3.5, -1.2, 1.2, 3.5]) E.ways.push(offset(ax, o));
    E.focus = [cx, cz]; let best = 1e9;   // the stadium itself is no street: look at the pavement ~150 m out, where the fans are
    for (const ax of E.axes) along(ax, 10, (x, z) => { const d = Math.abs(Math.hypot(x - cx, z - cz) - 150); if (d < best) { best = d; E.focus = [x, z]; } });
  },
};

export class Events {
  /** opts: scene, cat (data/events.json), map, origin ({lat, lon}), cells, db (data/peds.json), walk, Q, closed (traffic closures [x, z, r]), get (json fetch), crowd (the ambient Crowd: its pavements are reused) */
  constructor(o) {
    Object.assign(this, o); this.pr = projector(o.origin); this.list = o.cat.events.filter(e => e.map === o.map); this.on = {}; this.act = new Map(); this.mat = null;
    try { const s = JSON.parse(store() || '{}'); for (const e of this.list) this.on[e.id] = s[e.id] === true; } catch { for (const e of this.list) this.on[e.id] = false; }   // default: all off
    for (const e of this.list) { const [x, z] = this.pr(e.place.lon, e.place.lat); e.x = x; e.z = z; }
    const q = new URLSearchParams(location.search).get('events'); if (q) for (const id of q.split(',')) if (id in this.on) this.on[id] = true;   // ?events=<id>,<id> switches on for this visit (benchmarks, captures)
  }
  set(id, v) { this.on[id] = !!v; store(JSON.stringify(this.on)); }
  /** active event stats for the perf panel / tests */
  get active() { return [...this.act.values()].filter(a => a.ready).length; }
  want(e, f) { return this.on[e.id] && Math.hypot(f.x - e.x, f.z - e.z) < e.area.r + this.Q.drawDist * 0.8; }
  update(dt, f, obstacles, light, night) {
    for (const e of this.list) {
      const a = this.act.get(e.id);
      if (this.want(e, f)) { if (!a && this.cells.near(e.x, e.z, Math.min(e.area.r, 180)) >= 1 && this.cells.ground.terrain(e.x, e.z)) this.start(e); } else if (a) this.drop(e, a);
    }
    for (const a of this.act.values()) this.tick(a, dt, f, obstacles, light, night);
  }
  start(e) {
    const a = { e, gen: null, ready: false, cancelled: false, mesh: null, crowd: null, ways: [], shut: [] }; this.act.set(e.id, a);
    (async () => {
      const E = { ev: e, pr: this.pr, c: [e.x, e.z], ways: a.ways, shut: a.shut, K: kit((x, z) => this.cells.ground.terrain(x, z)?.y ?? this.cells.heightAt(x, z), e.id.length * 977 + 5, (x, z) => dryAt(this.cells.ground, x, z)), axes: (e.axes || []).map(l => { const p = []; for (let i = 0; i < l.length; i += 2) p.push(...this.pr(l[i], l[i + 1])); return p; }) };
      if (e.layout) E.data = await this.get(e.layout);
      if (a.cancelled) return;
      if (wetShare(this.cells.ground, e.x, e.z, e.area.r * 0.6) > 0.5) { console.warn('[events]', e.id, 'mostly on water: not mounted'); a.cancelled = true; return; }
      a.E = E; a.gen = BUILD[e.kind](E);
    })().catch(err => { console.error('[events]', e.id, err); a.cancelled = true; });
  }
  tick(a, dt, f, obstacles, light, night) {
    const e = a.e;
    if (a.gen) {   // time-sliced build
      const t0 = performance.now(); let r; do r = a.gen.next(); while (!r.done && performance.now() - t0 < BUDGET);
      if (r.done) { a.gen = null; this.finish(a); }
      return;
    }
    if (!a.ready) return;
    const u = a.mesh.material.userData.u; u.uT.value += dt; u.uGlow.value = night;
    if (light) { a.mesh.material.color.setRGB(...light); u.uInv.value.set(1 / Math.max(0.12, light[0]), 1 / Math.max(0.12, light[1]), 1 / Math.max(0.12, light[2])); a.crowd.light(light); }
    a.crowd.update(dt, { x: f.x, y: f.y, z: f.z }, obstacles);
  }
  finish(a) {
    const e = a.e, E = a.E, g = E.K.B.geometry({ rigged: true });
    const mat = makeMat(); if (E.hub) { mat.userData.u.uHub.value.copy(E.hub); mat.userData.u.uAx.value.copy(E.ax); }
    const m = a.mesh = new THREE.Mesh(g, mat); m.frustumCulled = false; m.name = 'event:' + e.id; this.scene.add(m);
    // crowd: its own instance (2 draw calls); walks synthetic lanes of the event + the map's pavements inside the area
    const base = this.crowd?.data?.ways || [], ways = a.ways.slice();
    for (const w of base) if (Math.hypot(w[0] - e.x, w[1] - e.z) < e.area.r) ways.push(w);
    const pal = e.crowd.palette, db = { ...this.db, styles: this.db.styles.map(s => ({ ...s, top: { ...s.top, palette: pal } })) };
    a.crowd = new Crowd({ scene: this.scene, db, data: { ways }, walk: this.walk, Q: { peds: Math.round(e.crowd.n * Math.min(1, (this.Q.peds || 28) / 28 + 0.4)), treeDist: this.Q.treeDist }, seed: 7 + e.id.length, spacing: e.crowd.spacing });
    if (e.closure) { const [x, z] = this.pr(e.closure.lon, e.closure.lat); a.zone = [x, z, e.closure.r]; this.closed.push(a.zone); }
    a.ready = true;
  }
  drop(e, a) {
    a.cancelled = true; this.act.delete(e.id); if (a.zone) { const i = this.closed.indexOf(a.zone); if (i >= 0) this.closed.splice(i, 1); }
    if (a.mesh) { this.scene.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.dispose(); }
    if (a.crowd) { for (const l of a.crowd.L) { this.scene.remove(l.im); l.im.geometry.dispose(); l.im.dispose(); } a.crowd.tex?.dispose?.(); a.crowd.mat.dispose(); a.crowd.smat.dispose(); }
  }
}
