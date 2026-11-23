import * as THREE from 'three';
import { props } from './props.js';
import { customVenueIds } from './venues3d.js';

// Landmark detail layer. Instead of replacing the real Catastro volumes it ADDS architecture on top of / in front of them, anchored
// to the real footprints: bell gables, domes, clock tower stages, flags, name boards (public buildings) and, for ~690 OSM venues
// (bars, restaurants, schools...), a sign with the real name on the nearest facade, an awning and terrace tables on the pavement.
// Verified = position/name (OSM, Catastro footprint). Guessed = colours, proportions, details (from public Commons photos viewed offline).
// See data/landmarks.md.
const BUILD = 220;      // venues within this distance of the camera get signs
const BUILD_M = 700;    // monuments

const LM = [
  // kind: how to dress the footprint nearest to (x,z)
  { n: 'Ayuntamiento', x: -3920.7, z: -2015.2, kind: 'ayto' },
  { n: 'Teatro Moderno', x: -3795.9, z: -2065.5, kind: 'board', text: 'TEATRO MODERNO', col: '#7a1f1f' },
  { n: 'Mercado de Abastos', x: -4079.3, z: -2130.2, kind: 'board', text: 'MERCADO DE ABASTOS', col: '#2f5d3a' },
  { n: 'Iglesia de Jesús Nazareno', x: -3889, z: -1913, kind: 'espadana' },
  { n: 'Ermita del Santo Cristo', x: -3641.6, z: -1623.2, kind: 'espadana' },
  { n: 'Iglesia de San Sebastián', x: -3443.9, z: -2151.4, kind: 'espadana' },
  { n: 'Iglesia de San Telmo', x: -3870.9, z: -2186.4, kind: 'espadana' },
  { n: 'Iglesia de la Soledad', x: -4851.9, z: -1927.5, kind: 'espadana' },
];

const mat = (c, o) => new THREE.MeshLambertMaterial({ color: c, ...o });
const M = { white: mat(0xf2efe6), ochre: mat(0xd9b66a), stone: mat(0xcfc8b6), roof: mat(0xa65436), dark: mat(0x2c2f33), gold: mat(0xc9a23a), wood: mat(0x7a5a3a), tbl: mat(0xe8e8e8), chair: mat(0x3a3a3a) };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const texCache = new Map();
function textTex(text, bg, fg = '#fff', w = 512, h = 128) {
  const k = text + bg + fg; let t = texCache.get(k); if (t) return t;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
  let fs = 64; g.font = `bold ${fs}px sans-serif`; while (g.measureText(text).width > w - 40 && fs > 14) { fs -= 4; g.font = `bold ${fs}px sans-serif`; }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 3);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(k, t); return t;
}
function clockTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f4efe0'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#222'; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke();
  g.lineWidth = 3; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(64 + 46 * Math.sin(a), 64 - 46 * Math.cos(a)); g.lineTo(64 + 54 * Math.sin(a), 64 - 54 * Math.cos(a)); g.stroke(); }
  g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 28); g.stroke(); g.beginPath(); g.moveTo(64, 64); g.lineTo(88, 74); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flagTex(kind) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; const g = c.getContext('2d');
  if (kind === 0) { g.fillStyle = '#c60b1e'; g.fillRect(0, 0, 96, 64); g.fillStyle = '#ffc400'; g.fillRect(0, 16, 96, 32); }
  else if (kind === 1) { g.fillStyle = '#0a7d3b'; g.fillRect(0, 0, 96, 64); g.fillStyle = '#fff'; g.fillRect(0, 21, 96, 22); g.fillStyle = '#0a7d3b'; g.fillRect(0, 0, 96, 21); g.fillRect(0, 43, 96, 21); g.fillStyle = '#fff'; g.fillRect(0, 21, 96, 22); }
  else { g.fillStyle = '#fff'; g.fillRect(0, 0, 96, 32); g.fillStyle = '#1d4e9c'; g.fillRect(0, 32, 96, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Landmarks {
  constructor(scene, hf, buildings, venues) {
    this.scene = scene; this.hf = hf; this.B = buildings; this.venues = venues.filter(v => v.name); this.t = 0;
    this.items = LM.map(l => ({ ...l, g: null })); this.vg = new Map(); this.sx = 1e9; this.sz = 1e9;
    this.geo = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cone4: new THREE.ConeGeometry(1, 1, 4), sph: new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), plane: new THREE.PlaneGeometry(1, 1) };
  }
  // -------- footprint helpers (Catastro parts)
  partsNear(x, z, r) {
    const B = this.B, out = new Set();
    for (let gx = Math.floor((x - r) / 64); gx <= Math.floor((x + r) / 64); gx++) for (let gz = Math.floor((z - r) / 64); gz <= Math.floor((z + r) / 64); gz++) { const l = B.grid.get(gx * 100003 + gz); if (l) for (const i of l) out.add(i); }
    return [...out];
  }
  inPoly(i, x, z) { const B = this.B, P = B.P, s = B.off[i], e = B.off[i + 1]; let c = false; for (let a = s, b = e - 1; a < e; b = a++) { const xi = P[a * 2], zi = P[a * 2 + 1], xj = P[b * 2], zj = P[b * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  /** nearest facade edge among nearby parts: {x,z (foot point), nx,nz (outward normal), d, part} */
  nearestEdge(x, z, r) {
    const B = this.B, P = B.P; let best = null;
    for (const i of this.partsNear(x, z, r)) {
      const s = B.off[i], e = B.off[i + 1], inside = this.inPoly(i, x, z);
      for (let a = s, b = e - 1; a < e; b = a++) {
        const ax = P[a * 2], az = P[a * 2 + 1], bx = P[b * 2], bz = P[b * 2 + 1], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez; if (L2 < 4) continue;
        let u = ((x - ax) * ex + (z - az) * ez) / L2; u = Math.max(0, Math.min(1, u)); const px = ax + u * ex, pz = az + u * ez, d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) { const L = Math.sqrt(L2); let nx = ez / L, nz = -ex / L; const tx = px + nx * 0.5, tz = pz + nz * 0.5; if (this.partsNear(tx, tz, 1).some(j => this.inPoly(j, tx, tz))) { nx = -nx; nz = -nz; } best = { x: px, z: pz, nx, nz, d, part: i, L, inside }; }
      }
    }
    return best;
  }
  partAt(x, z, r = 12) { let best = -1, bd = 1e9; for (const i of this.partsNear(x, z, r)) { if (this.inPoly(i, x, z)) return i; const d = Math.hypot(this.B.bb[i * 4] / 2 + this.B.bb[i * 4 + 1] / 2 - x, this.B.bb[i * 4 + 2] / 2 + this.B.bb[i * 4 + 3] / 2 - z); if (d < bd) { bd = d; best = i; } } return best; }
  centroid(i) { const B = this.B; return [(B.bb[i * 4] + B.bb[i * 4 + 1]) / 2, (B.bb[i * 4 + 2] + B.bb[i * 4 + 3]) / 2]; }

  mesh(geo, m, sx, sy, sz, x, y, z) { const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); return o; }
  boxm(m, w, h, d, x, y, z) { return this.mesh(this.geo.box, m, w, h, d, x, y + h / 2, z); }
  cylm(m, r, h, x, y, z) { return this.mesh(this.geo.cyl, m, r, h, r, x, y + h / 2, z); }

  // -------- landmark builders
  build(it) {
    const i = this.partAt(it.x, it.z); if (i < 0) return null;
    const g = new THREE.Group(), B = this.B, [cx, cz] = this.centroid(i), top = B.top[i], gy = B.base[i];
    const w = B.bb[i * 4 + 1] - B.bb[i * 4], d = B.bb[i * 4 + 3] - B.bb[i * 4 + 2], r = Math.min(w, d) / 2;
    if (it.kind === 'dome') {            // drum + dome + lantern + cross over the church's central part
      const R = Math.max(3, Math.min(r * 0.8, 6)); g.add(this.cylm(M.white, R, 2.2, cx, top, cz), this.mesh(this.geo.sph, M.ochre, R, R * 0.9, R, cx, top + 2.2, cz));
      g.add(this.cylm(M.white, R * 0.28, 2.2, cx, top + 2.2 + R * 0.9 - 0.2, cz), this.cylm(M.gold, 0.05, 1.4, cx, top + 4.2 + R * 0.9, cz), this.boxm(M.gold, 0.7, 0.07, 0.07, cx, top + 5.1 + R * 0.9, cz));
    } else if (it.kind === 'espadana') {   // bell gable (espadaña) on the ridge, ochre/white, with bell openings
      const e = this.nearestEdge(cx, cz, 30), ang = e ? Math.atan2(e.nx, e.nz) : 0; const sub = new THREE.Group(); sub.position.set(cx, top, cz); sub.rotation.y = ang;
      sub.add(this.boxm(M.white, 3.2, 4.2, 0.7, 0, 0, 0), this.boxm(M.ochre, 3.6, 0.35, 0.9, 0, 4.2, 0), this.boxm(M.white, 1.6, 1.4, 0.6, 0, 4.55, 0), this.boxm(M.ochre, 1.9, 0.25, 0.8, 0, 5.95, 0));
      for (const bx of [-0.8, 0.8]) sub.add(this.boxm(M.dark, 0.7, 1.7, 0.8, bx, 1.8, 0)); sub.add(this.boxm(M.dark, 0.55, 0.9, 0.7, 0, 4.7, 0), this.cylm(M.gold, 0.04, 1.2, 0, 6.2, 0), this.boxm(M.gold, 0.5, 0.06, 0.06, 0, 7.0, 0)); g.add(sub);
    } else if (it.kind === 'clock') {      // Torre del Reloj: clock stage, belfry with arches, tiled pyramid
      const R = Math.max(2.2, Math.min(r * 0.8, 3.4)), cs = new THREE.Group(); cs.position.set(cx, top, cz);
      cs.add(this.boxm(M.white, R * 2, 4.5, R * 2, 0, 0, 0), this.boxm(M.stone, R * 2.2, 0.3, R * 2.2, 0, 4.5, 0));
      const ct = clockTex(), cm = new THREE.MeshBasicMaterial({ map: ct });
      for (let k = 0; k < 4; k++) { const f = this.mesh(this.geo.plane, cm, 2.2, 2.2, 1, 0, 2.6, 0); f.rotation.y = k * Math.PI / 2; f.translateZ(R + 0.06); cs.add(f); }
      cs.add(this.boxm(M.ochre, R * 1.8, 3.2, R * 1.8, 0, 4.8, 0));
      for (let k = 0; k < 4; k++) { const a = this.boxm(M.dark, 1.1, 2.0, 0.1, 0, 5.2, 0); a.rotation.y = k * Math.PI / 2; a.translateZ(R * 0.9 + 0.02); cs.add(a); }
      cs.add(this.boxm(M.stone, R * 2.1, 0.3, R * 2.1, 0, 8.0, 0), this.mesh(this.geo.cone4, M.roof, R * 1.55, 3.6, R * 1.55, 0, 8.3 + 1.8, 0), this.cylm(M.gold, 0.05, 1.6, 0, 11.9, 0));
      cs.children[cs.children.length - 2].rotation.y = Math.PI / 4; g.add(cs); props.circle(cx, cz, 0.1, 0);
    } else if (it.kind === 'ayto') {      // flagpoles (Spain, Andalucía, Chiclana) on the roof + name board on nearest facade
      const e = this.nearestEdge(it.x - 6, it.z - 8, 40), ang = e ? Math.atan2(e.nx, e.nz) : 0;
      for (let k = 0; k < 3; k++) { const px = cx + (k - 1) * 3 * Math.cos(ang), pz = cz - (k - 1) * 3 * Math.sin(ang); g.add(this.cylm(M.dark, 0.05, 5, px, top, pz)); const fl = this.mesh(this.geo.plane, new THREE.MeshBasicMaterial({ map: flagTex(k), side: THREE.DoubleSide }), 1.8, 1.2, 1, px + 0.95 * Math.cos(ang), top + 4.2, pz - 0.95 * Math.sin(ang)); fl.rotation.y = ang; g.add(fl); }
      const s = this.sign(it.x, it.z, 'AYUNTAMIENTO DE CHICLANA', '#e8e1c8', '#3b2a1a', 4.2, 4.8, 1.0, 60); if (s) g.add(s);
    } else if (it.kind === 'board') {
      const s = this.sign(it.x, it.z, it.text, it.col, '#fff', 3.6, 6, 1.2, 60); if (s) g.add(s);
    }
    return g;
  }
  /** flat board on the facade nearest to (x,z) */
  sign(x, z, text, bg, fg, y, w, h, range = 25) {
    const e = this.nearestEdge(x, z, range); if (!e) return null;
    const gy = this.B.base[e.part], m = new THREE.MeshLambertMaterial({ map: textTex(text, bg, fg), side: THREE.DoubleSide });
    const o = this.mesh(this.geo.plane, m, w, h, 1, e.x + e.nx * 0.12, gy + y, e.z + e.nz * 0.12); o.rotation.y = Math.atan2(e.nx, e.nz); return o;
  }
  venueGroup(v) {
    const e = this.nearestEdge(v.x, v.z, 30); if (!e || e.d > 28 || e.L < 3) return null;
    const g = new THREE.Group(), hs = hash(v.id), gy = this.B.base[e.part], ang = Math.atan2(e.nx, e.nz);
    const food = ['bar', 'restaurant', 'cafe', 'pub', 'fast_food', 'ice_cream'].includes(v.amenity);
    const edu = ['school', 'kindergarten', 'college', 'university'].includes(v.amenity);
    const bg = edu ? '#1f4e8c' : food ? ['#7a1f1f', '#1f5d3a', '#2b2b2b', '#8a5a14', '#1b3d6b'][Math.floor(hs * 5)] : v.amenity === 'pharmacy' ? '#0a8a3a' : '#3a3a3a';
    const sg = this.sign(e.x + e.nx * 0.01, e.z + e.nz * 0.01, v.name, bg, '#fff', food ? 3.4 : 4.2, Math.min(5.5, Math.max(2.5, e.L * 0.6)), 0.7); if (!sg) return null; g.add(sg);
    if (food) {
      const aw = new THREE.Mesh(this.geo.box, mat([0xb5251c, 0x1f6b3a, 0xd9a21a, 0x1b3d6b][Math.floor(hs * 4)]), void 0); aw.scale.set(Math.min(5, e.L * 0.7), 0.08, 1.6); aw.position.set(e.x + e.nx * 0.9, gy + 2.6, e.z + e.nz * 0.9); aw.rotation.y = ang; aw.rotation.x = 0; g.add(aw);
      if (v.outdoor !== 'no') for (let k = 0; k < 2 + Math.floor(hs * 3); k++) {
        const tx = e.x + e.nx * 2.2 + (-e.nz) * (k - 1) * 1.6, tz = e.z + e.nz * 2.2 + e.nx * (k - 1) * 1.6; if (this.B.hit(tx, tz) || this.partsNear(tx, tz, 1).some(j => this.inPoly(j, tx, tz))) continue;
        const ty = this.hf.height(tx, tz); const t = new THREE.Group(); t.add(this.cylm(M.tbl, 0.45, 0.04, 0, 0.72, 0), this.cylm(M.dark, 0.04, 0.72, 0, 0, 0));
        for (const [ox, oz] of [[0.65, 0], [-0.65, 0]]) t.add(this.boxm(M.chair, 0.4, 0.45, 0.4, ox, 0, oz)); t.position.set(tx, ty, tz); g.add(t);
      }
    }
    return g;
  }
  update(cam) { try { this._update(cam); } catch (e) { if (!this._err) { this._err = 1; console.warn('landmarks', e); } } }
  _update(cam) {
    this.t += 1; if (this.t % 20) return;
    const mx = cam.x - this.sx, mz = cam.z - this.sz; if (mx * mx + mz * mz < 25 && this.t % 200) return; this.sx = cam.x; this.sz = cam.z;
    const k = window.__lodK ?? 1;
    for (const it of this.items) { const d = Math.hypot(it.x - cam.x, it.z - cam.z); if (it.g === null && d < BUILD_M * k) { const g = this.build(it); it.g = g || false; if (g) this.scene.add(g); } else if (it.g && d > BUILD_M * k * 1.3) { this.scene.remove(it.g); it.g = null; } }
    let built = 0;
    for (const v of this.venues) {
      if (customVenueIds.has(v.id)) continue;   // detailed venue (venues3d.js) replaces the generic sign
      const d = Math.hypot(v.x - cam.x, v.z - cam.z), on = this.vg.get(v.id);
      if (d < BUILD * k) { if (on === undefined && built < 6) { built++; const g = this.venueGroup(v); this.vg.set(v.id, g || false); if (g) this.scene.add(g); } }
      else if (on) { this.scene.remove(on); this.vg.delete(v.id); }
    }
  }
}
