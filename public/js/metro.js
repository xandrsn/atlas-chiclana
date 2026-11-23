import * as THREE from 'three';
import { toLocal } from './geo.js';

// Metro (map-agnostic, loaded only where data/<map>/metro.json exists = Madrid). NO trains are simulated:
//  - every entrance (OSM railway=subway_entrance, ODbL) gets a stairwell with parapets, a glass canopy, the Metro rhombus on a totem and one coloured pip per line (no names);
//  - walking DOWN the stairs of an entrance on foot (to the bottom landing) opens a 2D map (stations + lines of data/<map>/metro.json) where you click a station to travel to one of its entrances;
//  - the HUD shows the nearest station + its lines instead of the street name (hud()).
// Line colours: OSM `colour` of the route relation, else the usual Metro de Madrid palette below (from memory: guessed).
const PAL = { 1: '#38a8df', 2: '#e31d3c', 3: '#ffd400', 4: '#b66321', 5: '#82bf45', 6: '#9b9b9b', 7: '#f68b1f', 8: '#f78fb3', 9: '#a0006e', 10: '#0b3f93', 11: '#138d3f', 12: '#9e9100', R: '#e8e8e8' };
const colOf = l => (l.colour && /^#?[0-9a-f]{3,6}$/i.test(l.colour) ? (l.colour[0] === '#' ? l.colour : '#' + l.colour) : PAL[String(l.ref).replace(/^L/i, '')] || '#888');
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const lineCol = new Map();

function diamondTex() {   // Metro de Madrid totem: red rhombus, white field, blue band with "Metro" (drawn from memory, stylised)
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const dia = (r, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(64, 64 - r); g.lineTo(64 + r, 64); g.lineTo(64, 64 + r); g.lineTo(64 - r, 64); g.closePath(); g.fill(); };
  dia(62, '#d6001c'); dia(44, '#fff');
  g.fillStyle = '#1d3f94'; g.fillRect(6, 48, 116, 32); g.fillStyle = '#fff'; g.font = 'bold 27px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Metro', 64, 65);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Stairwell: NSTEP real steps going DOWN below the pavement. The terrain is a heightfield and cannot have a hole, so the mouth is a plane that resets the depth buffer
// to "far" where it is visible (renderOrder 6: after terrain and roads, which use up to 5); the pit (7) and the walker (8) are drawn after it and so show through the ground.
const NSTEP = 16, RISE = 0.17, FL = 4.7, Z0 = -FL / 2, HWID = 0.95, LAND = 1.3, DEEP = NSTEP * RISE;
export class Metro {
  constructor(scene, hf, data, boundary, travel) {
    this.scene = scene; this.hf = hf; this.S = data.stations; this.L = data.lines; this.travel = travel; this.cool = 0; this.open = false; this.near = null; this._hudT = 0;
    for (const l of this.L) l.col = colOf(l);
    for (const s of this.S) s.cols = s.lines.map(l => colOf(l));
    this.ring = boundary?.rings?.[0] || null;
    this.build(); this.ui();
  }
  /** every entrance = a street stairwell (painted flight between steel parapets, open at the street end), a glass canopy on four posts with a red fascia,
   *  and a totem with the Metro rhombus + one pip per line. No names are written on it. 4 draw calls for all of them. The flight descends towards the station. */
  build() {
    const E = []; this.S.forEach((s, si) => s.ent.forEach(e => E.push({ x: e[0], z: e[1], si, k: E.length })));
    this.E = E; const N = E.length; if (!N) return;
    const g = new THREE.Group(), PER = 13, PIT = NSTEP + 6; this.cells = new Map();
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), N * PER);
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.08, 5.2), new THREE.MeshLambertMaterial({ color: 0xa9c4d2, transparent: true, opacity: 0.5, depthWrite: false }), N);
    const mouth = new THREE.InstancedMesh(new THREE.PlaneGeometry(HWID * 2, FL).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.03, 0.03, 0.04, 1.0); gl_FragDepth = 1.0; }' }), N);
    const pit = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), N * PIT); mouth.renderOrder = 6; pit.renderOrder = 7; let np = 0;
    const sign = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.5).rotateY(Math.PI),   // shortcut: reads right from the street end only (mirrored from behind), two planes if it matters
      new THREE.MeshBasicMaterial({ map: diamondTex(), side: THREE.DoubleSide, alphaTest: 0.5 }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color(); let nb = 0;
    const STEEL = 0x8d979c, DARK = 0x3a4044, RED = 0xd6001c;
    for (const e of E) {
      const s = this.S[e.si], y = this.hf.height(e.x, e.z), a = Math.hypot(s.x - e.x, s.z - e.z) > 3 ? Math.atan2(s.x - e.x, s.z - e.z) : hash(e.k * 2.1) * 6.28, co = Math.cos(a), si = Math.sin(a);
      q.setFromAxisAngle(up, a); e.y = y; e.co = co; e.si2 = si; e.out = [e.x - 4.6 * si, e.z - 4.6 * co];   // out = on the pavement in front of the first step
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) { const k = (Math.floor(e.x / 8) + gx) * 100003 + Math.floor(e.z / 8) + gz; (this.cells.get(k) || this.cells.set(k, []).get(k)).push(e); }
      const at = (ox, oy, oz) => p.set(e.x + ox * co + oz * si, y + oy, e.z - ox * si + oz * co);   // local frame: x across, +z down the flight
      const box = (ox, oy, oz, sx, sy, sz, col) => { m.compose(at(ox, oy, oz), q, sc.set(sx, sy, sz)); boxes.setMatrixAt(nb, m); boxes.setColorAt(nb++, c.set(col)); };
      for (const sx of [-1, 1]) { box(sx * 1.02, 0.5, 0.05, 0.14, 1.0, 4.9, STEEL); for (const sz of [-1, 1]) box(sx * 1.1, 1.3, sz * 2.4, 0.09, 2.6, 0.09, DARK); }   // side parapets + canopy posts
      box(0, 0.5, 2.43, 2.18, 1.0, 0.14, STEEL);                                   // parapet closing the deep end
      box(0, 2.48, -2.55, 2.5, 0.26, 0.1, RED);                                    // red fascia over the way in
      box(1.75, 2.1, -2.7, 0.13, 4.2, 0.13, DARK);                                 // totem
      s.cols.slice(0, 4).forEach((col, i) => box(1.75, 3.0 - i * 0.3, -2.7, 0.36, 0.24, 0.16, col));
      const pb = (ox, oy, oz, sx, sy, sz, col) => { m.compose(at(ox, oy, oz), q, sc.set(sx, sy, sz)); pit.setMatrixAt(np, m); pit.setColorAt(np++, c.set(col)); };
      for (let i = 0; i < NSTEP; i++) { const v = 0.62 - 0.3 * i / NSTEP; pb(0, -(i + 1) * RISE - 0.5, Z0 + (i + 0.5) * FL / NSTEP, HWID * 2, 1, FL / NSTEP, c.setRGB(v, v, v + 0.02).getHex()); }   // steps (1 m thick blocks)
      pb(0, -DEEP - 0.1, -Z0 + LAND / 2, HWID * 2, 0.2, LAND, 0x3a3d40); pb(0, -0.3, -Z0 + LAND / 2, HWID * 2, 0.12, LAND, 0x2a2d30);                 // landing floor + its ceiling under the pavement
      for (const sx of [-1, 1]) pb(sx * (HWID + 0.05), -1.6, LAND / 2, 0.1, 3.2, FL + LAND, 0xd8dcd8);                                             // tiled side walls
      pb(0, -1.6, -Z0 + LAND + 0.05, HWID * 2 + 0.2, 3.2, 0.1, 0x1d3f94); pb(0, -DEEP + 1.9, -Z0 + LAND - 0.02, 1.3, 0.35, 0.05, 0xfff1c4);            // end wall (Metro blue) + lit panel
      m.compose(at(0, 2.64, 0), q, one); glass.setMatrixAt(e.k, m);
      m.compose(at(0, 0.06, 0), q, one); mouth.setMatrixAt(e.k, m);
      m.compose(at(1.75, 4.15, -2.7), q, one); sign.setMatrixAt(e.k, m);
    }
    boxes.count = nb; pit.count = np; for (const o of [boxes, mouth, pit, sign, glass]) { o.frustumCulled = false; g.add(o); } this.scene.add(g); this.g = g;
  }
  /** stairwell under (x,z): { e, y } with y = tread / landing height, or null. Hooked as Underground.pit (walk surface + "not solid" below ground) */
  pit(x, z) {
    const l = this.cells?.get(Math.floor(x / 8) * 100003 + Math.floor(z / 8)); if (!l) return null;
    for (const e of l) { const dx = x - e.x, dz = z - e.z, ox = dx * e.co - dz * e.si2, oz = dx * e.si2 + dz * e.co; if (Math.abs(ox) > HWID || oz < Z0 || oz > -Z0 + LAND) continue;
      return { e, y: e.y - Math.min(NSTEP, Math.floor((oz - Z0) / FL * NSTEP) + 1) * RISE }; }
    return null;
  }
  nearest(x, z) {
    let b = -1, bd = 1e12; for (let i = 0; i < this.S.length; i++) { const s = this.S[i], d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; b = i; } } return b < 0 ? null : { s: this.S[b], i: b, d: Math.sqrt(bd) };
  }
  /** street-name replacement for the HUD */
  hud(pos, elName, elArea) {
    const n = this.nearest(pos.x, pos.z); if (!n) return; this.near = n;
    elName.textContent = 'Metro ' + n.s.n;
    elArea.innerHTML = n.s.lines.map((l, i) => `<span style="background:${n.s.cols[i]};color:${/^#(f|e|d|c)/i.test(n.s.cols[i]) ? '#111' : '#fff'};border-radius:4px;padding:0 5px;margin-right:3px;font-weight:700">${String(l.ref).replace(/^L/i, '')}</span>`).join('') + ` <span style="opacity:.8">${n.d < 1000 ? Math.round(n.d / 10) * 10 + ' m' : (n.d / 1000).toFixed(1) + ' km'}</span>`;
  }
  update(dt, pos, onFoot) {
    this.cool -= dt; if (this.open || this.cool > 0 || !onFoot || !this.E?.length) return;
    if (!this._ro && window.__sim?.walker) { this._ro = true; window.__sim.walker.group.traverse(o => { o.renderOrder = 8; }); }   // drawn after the depth punch, else the legs vanish into the pavement
    const p = this.pit(pos.x, pos.z); if (p && pos.y < p.e.y - DEEP + 0.3) this.show(p.e.si);   // reached the bottom landing
  }
  // ------------------------------------------------------------------ 2D map overlay
  ui() {
    const el = this.el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(10,16,24,.94);display:none;color:#fff;font:14px sans-serif;user-select:none';
    el.innerHTML = '<div style="position:absolute;left:16px;top:12px;font-size:18px;font-weight:700;color:#f2b84b">Metro · viaje rápido <span style="font-size:12px;color:#9fb2c4;font-weight:400">(no hay trenes: haz clic en una parada)</span></div>'
      + '<input id="mtSearch" placeholder="Buscar parada…" style="position:absolute;left:16px;top:44px;width:240px;padding:6px 9px;border-radius:6px;border:1px solid #456;background:#13202e;color:#fff">'
      + '<div id="mtList" style="position:absolute;left:16px;top:80px;width:240px;max-height:60vh;overflow:auto;background:#101a26;border-radius:6px"></div>'
      + '<button id="mtClose" style="position:absolute;right:16px;top:12px;padding:6px 14px;border-radius:6px;border:1px solid #789;background:#13202e;color:#fff;cursor:pointer">Cerrar (Esc)</button>'
      + '<div id="mtLeg" style="position:absolute;right:16px;bottom:12px;font-size:12px;color:#9fb2c4"></div><canvas id="mtCv" style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
    document.body.appendChild(el);
    this.cv = el.querySelector('#mtCv'); this.ctx = this.cv.getContext('2d'); this.search = el.querySelector('#mtSearch'); this.list = el.querySelector('#mtList');
    for (const ev of ['keydown', 'keyup', 'keypress']) el.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') this.hide(); });
    el.querySelector('#mtClose').onclick = () => this.hide();
    this.search.addEventListener('input', () => this.filter());
    this.list.addEventListener('click', e => { const i = e.target.closest('[data-i]')?.dataset.i; if (i != null) this.pick(+i); });
    el.querySelector('#mtLeg').innerHTML = [...new Map(this.L.map(l => [l.ref, l.col])).entries()].map(([r, c]) => `<span style="display:inline-block;margin-left:8px"><span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px"></span> ${String(r).replace(/^L/i, 'L')}</span>`).join('');
    this.cam = { x: 0, z: 0, k: 0.07 };    // px per metre
    const cv = this.cv; let drag = null, moved = 0;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; moved = 0; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { this.mx = e.clientX; this.mz = e.clientY; if (drag) { this.cam.x -= (e.clientX - drag.x) / this.cam.k; this.cam.z -= (e.clientY - drag.y) / this.cam.k; moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; } this.draw(); });
    cv.addEventListener('pointerup', e => { drag = null; if (moved < 5) { const s = this.hit(e.clientX, e.clientY); if (s != null) this.pick(s); } });
    cv.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2, w = this.toW(e.clientX, e.clientY); this.cam.k = Math.min(2, Math.max(0.02, this.cam.k * f)); const w2 = this.toW(e.clientX, e.clientY); this.cam.x += w[0] - w2[0]; this.cam.z += w[1] - w2[1]; this.draw(); }, { passive: false });
    addEventListener('resize', () => this.open && this.draw());
  }
  toW(px, py) { return [this.cam.x + (px - innerWidth / 2) / this.cam.k, this.cam.z + (py - innerHeight / 2) / this.cam.k]; }
  toS(x, z) { return [(x - this.cam.x) * this.cam.k + innerWidth / 2, (z - this.cam.z) * this.cam.k + innerHeight / 2]; }
  hit(px, py) { let b = null, bd = 12 * 12; this.S.forEach((s, i) => { const [x, y] = this.toS(s.x, s.z), d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }
  show(si) {
    this.open = true; this.cur = si; this.el.style.display = 'block'; const s = this.S[si]; this.cam.x = s.x; this.cam.z = s.z; this.cam.k = 0.07; this.search.value = ''; this.filter();
    document.exitPointerLock?.(); this.draw(); this.search.focus();
  }
  hide() { this.open = false; this.el.style.display = 'none'; this.cool = 6; }
  filter() {
    const q = this.search.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const r = this.S.map((s, i) => [s, i]).filter(([s]) => !q || s.n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q)).sort((a, b) => a[0].n.localeCompare(b[0].n)).slice(0, 80);
    this.list.innerHTML = r.map(([s, i]) => `<div data-i="${i}" style="padding:4px 9px;cursor:pointer;border-bottom:1px solid #1d2b3b">${s.cols.map(c => `<span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:50%;margin-right:3px"></span>`).join('')}${s.n}</div>`).join('');
  }
  pick(i) {
    const s = this.S[i], es = this.E.filter(e => e.si === i), e = es[(Math.random() * es.length) | 0]; this.hide(); this.travel?.(e.out[0], e.out[1], 'Metro ' + s.n);   // come out in front of one of its entrances
  }
  draw() {
    const cv = this.cv, g = this.ctx, dpr = devicePixelRatio || 1; if (cv.width !== innerWidth * dpr) { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
    if (this.ring) { g.strokeStyle = 'rgba(242,184,75,.35)'; g.setLineDash([6, 6]); g.lineWidth = 1.5; g.beginPath(); this.ring.forEach(([lon, lat], i) => { const [x, z] = this.lonlat(lon, lat), [px, py] = this.toS(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); g.stroke(); g.setLineDash([]); }
    g.lineWidth = Math.max(2, Math.min(6, this.cam.k * 40)); g.lineCap = g.lineJoin = 'round';
    for (const l of this.L) { g.strokeStyle = l.col; g.beginPath(); l.stops.forEach((si, i) => { const s = this.S[si], [x, y] = this.toS(s.x, s.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    const hov = this.mx != null ? this.hit(this.mx, this.mz) : null, r = Math.max(2.5, Math.min(7, this.cam.k * 55));
    this.S.forEach((s, i) => { const [x, y] = this.toS(s.x, s.z); if (x < -20 || y < -20 || x > innerWidth + 20 || y > innerHeight + 20) return; const t = s.lines.length > 1;
      g.fillStyle = i === this.cur ? '#f2b84b' : '#fff'; g.strokeStyle = '#111'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, t ? r * 1.35 : r, 0, 7); g.fill(); g.stroke();
      if (this.cam.k > 0.16 || i === hov || i === this.cur) { g.font = '12px sans-serif'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(s.n, x + r + 4, y + 4); g.fillText(s.n, x + r + 4, y + 4); } });
  }
  lonlat(lon, lat) { return toLocal(lon, lat); }
}
