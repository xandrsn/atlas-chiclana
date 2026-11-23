import * as THREE from 'three';

// Madrid events (data/madrid/events.json from scripts/madrid/events_fetch.mjs, OSM geometry): El Rastro (Sunday flea market on Ribera de Curtidores and
// side streets), Acampada de Sol (tents on the Puerta del Sol) and the match at the Bernabéu (stadium lit + crowd, fans walking to the gates).
// Small panel above the map selector: each event has a toggle and a "Ir" button; "Horario" switches the Rastro on automatically on Sundays 9-15 h
// (real clock, Madrid time). Crowds are instanced (2 draw calls each), only people near the camera are animated. Positions of the stalls / tents are
// placeholders along the real street centrelines / plaza polygons (guessed layout), see data/madrid/events_facts.json.
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const SHIRT = [0xd9d9d9, 0x2f6fb0, 0xb5392c, 0x3b7d4f, 0xd9a52a, 0x6a4c93, 0x222831, 0xc76f9a, 0x1f8a8a, 0xe8e8e8];
const SKIN = [0xf0c8a0, 0xe0ac84, 0xc68a60, 0x9a6642];
const AWN = [0xd94a3a, 0xf2f2f2, 0x2f6fb0, 0xe6b422, 0x3b9a5a, 0xcf6fa0];
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };

class Crowd {   // instanced walkers: torso + head; each has a behaviour fn(p, dt) that moves it
  constructor(scene, hf, n, colors, behave) {
    this.hf = hf; this.n = n; this.behave = behave; this.p = [];
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.15, 0.3), new THREE.MeshLambertMaterial(), n);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 6, 5), new THREE.MeshLambertMaterial(), n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) { this.p.push({ i, x: 0, z: 0, a: 0, v: 0.7 + hash(i * 3) * 0.7, ph: hash(i * 5) * 6.28, k: 0 }); this.body.setColorAt(i, c.setHex(colors(i))); this.head.setColorAt(i, c.setHex(SKIN[i % 4])); }
    this.body.frustumCulled = this.head.frustumCulled = false; this.g = new THREE.Group(); this.g.add(this.body, this.head); scene.add(this.g);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._u = new THREE.Vector3(0, 1, 0); this.t = 0;
    for (const p of this.p) behave(p, 0, true);
  }
  update(dt, cam) {
    this.t += dt; const m = this._m, q = this._q, v = this._v;
    for (const p of this.p) {
      this.behave(p, dt, false);
      const near = Math.hypot(p.x - cam.x, p.z - cam.z) < 320, y = near ? this.hf.height(p.x, p.z) : (p.y || 0); p.y = y;
      const bob = near ? Math.abs(Math.sin(this.t * 6 * p.v + p.ph)) * 0.07 : 0, s = near ? 1 : 0;
      q.setFromAxisAngle(this._u, p.a); this._s.set(s, s, s);
      m.compose(v.set(p.x, y + 0.58 + bob, p.z), q, this._s); this.body.setMatrixAt(p.i, m);
      m.compose(v.set(p.x, y + 1.3 + bob, p.z), q, this._s); this.head.setMatrixAt(p.i, m);
    }
    this.body.instanceMatrix.needsUpdate = this.head.instanceMatrix.needsUpdate = true;
  }
  set visible(v) { this.g.visible = v; }
  dispose() { this.g.parent?.remove(this.g); this.body.dispose(); this.head.dispose(); }
}
function steer(p, dt, tx, tz, sp = p.v) {   // walk toward (tx,tz); returns distance left
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1, s = Math.min(d, sp * dt);
  p.x += dx / d * s; p.z += dz / d * s; if (d > 0.3) p.a = Math.atan2(dx, dz); return d;
}

export class Events {
  constructor(scene, hf, data, bern, travel) {
    this.scene = scene; this.hf = hf; this.d = data; this.bern = bern; this.travel = travel; this.on = {}; this.obj = {}; this.auto = false; this.t = 0;
    const L = data.rastro.lines; let sx = 0, sz = 0, n = 0; for (const l of L) for (const q of l.p) { sx += q[0]; sz += q[1]; n++; }
    this.at = {
      rastro: n ? [sx / n, sz / n] : [-1120, 3025],
      sol: data.sol.plazas[0] ? data.sol.plazas[0].c : [-740, 2320],
      partido: [330, -1700],
    };
    this.ui();
  }
  // ------------------------------------------------------------------ El Rastro
  rastro() {
    const lines = this.d.rastro.lines.filter(l => l.p.length > 1), g = new THREE.Group(), st = [];
    for (const l of lines) {
      if (!/Ribera|Cascorro|Mira el Sol|Rodas|Fray|Arniches|Carnero|Estudios|San Cayetano|Bastero|Vara del Rey/.test(l.n)) continue;   // streets of the market; the big avenues stay open
      let acc = 0;
      for (let i = 0; i < l.p.length - 1; i++) {
        const [ax, az] = l.p[i], [bx, bz] = l.p[i + 1], len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let s = 2 - acc; s < len; s += 3.4) for (const side of [-1, 1]) st.push([ax + ux * s - uz * side * 2.7, az + uz * s + ux * side * 2.7, Math.atan2(ux, uz), st.length]);
        acc = (acc + len) % 3.4;
      }
    }
    const N = st.length, can = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.1, 2.2), new THREE.MeshLambertMaterial(), N), tab = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.85, 1.0), new THREE.MeshLambertMaterial({ color: 0x8a6b44 }), N), gd = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.3, 0.7), new THREE.MeshLambertMaterial(), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), u = new THREE.Vector3(0, 1, 0);
    st.forEach(([x, z, a, i]) => {
      const y = this.hf.height(x, z); q.setFromAxisAngle(u, a);
      m.compose(new THREE.Vector3(x, y + 2.3, z), q, new THREE.Vector3(1, 1, 1)); can.setMatrixAt(i, m); can.setColorAt(i, c.setHex(AWN[(hash(i * 1.7) * AWN.length) | 0]));
      m.compose(new THREE.Vector3(x, y + 0.43, z), q, new THREE.Vector3(1, 1, 1)); tab.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, y + 1.0, z), q, new THREE.Vector3(1, 1, 1)); gd.setMatrixAt(i, m); gd.setColorAt(i, c.setHex(SHIRT[(hash(i * 2.3) * SHIRT.length) | 0]));
    });
    for (const o of [can, tab, gd]) o.frustumCulled = false; g.add(can, tab, gd); this.scene.add(g);
    // crowd walks up and down the market streets
    const ls = lines.filter(l => /Ribera|Cascorro|Mira el Sol|Rodas|Fray|Arniches/.test(l.n)), tot = ls.reduce((a, l) => a + l.p.length, 0) || 1;
    const crowd = new Crowd(this.scene, this.hf, 420, i => SHIRT[i % SHIRT.length], (p, dt, init) => {
      if (init) { const l = ls[(hash(p.i) * ls.length) | 0] || { p: [[0, 0], [1, 1]] }; p.l = l.p; p.s = hash(p.i * 9) * (l.p.length - 1); p.dir = hash(p.i * 4) < 0.5 ? 1 : -1; p.off = (hash(p.i * 6) - 0.5) * 3.2; }
      const P = p.l, i = Math.min(P.length - 2, Math.max(0, Math.floor(p.s))), a = P[i], b = P[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, f = p.s - i;
      const x = a[0] + (b[0] - a[0]) * f - (b[1] - a[1]) / len * p.off, z = a[1] + (b[1] - a[1]) * f + (b[0] - a[0]) / len * p.off;
      if (init) { p.x = x; p.z = z; return; }
      p.s += p.dir * p.v * 0.5 * dt / len * (Math.hypot(P[Math.min(P.length - 1, i + 1)][0] - P[i][0], 1) > 0 ? 1 : 1); if (p.s < 0 || p.s > P.length - 1.001) { p.dir *= -1; p.s = Math.min(P.length - 1.001, Math.max(0, p.s)); }
      steer(p, dt, x, z, p.v * 1.2);
    });
    return { g, crowd, stalls: N, update: (dt, cam) => crowd.update(dt, cam), dispose: () => { g.parent?.remove(g); for (const o of [can, tab, gd]) o.dispose(); crowd.dispose(); } };
  }
  // ------------------------------------------------------------------ Acampada de Sol
  sol() {
    const pl = this.d.sol.plazas.filter(p => p.poly && p.poly.length > 2), g = new THREE.Group(), tents = [];
    const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; a += P[i][0] * q[1] - q[0] * P[i][1]; } return Math.abs(a / 2); };
    const polys = pl.map(p => p.poly).sort((a, b) => area(b) - area(a)).slice(0, 3);
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const P of polys) for (const [x, z] of P) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
    for (let k = 0; k < 4000 && tents.length < 80; k++) {
      const x = bx0 + hash(k * 1.3) * (bx1 - bx0), z = bz0 + hash(k * 2.9 + 5) * (bz1 - bz0);
      if (!polys.some(P => inPoly(x, z, P)) || tents.some(t => Math.hypot(t[0] - x, t[1] - z) < 3.4)) continue; tents.push([x, z, hash(k) * 3.14, tents.length]);
    }
    const N = tents.length, geo = new THREE.ConeGeometry(1.25, 1.3, 4); geo.rotateY(Math.PI / 4); geo.scale(1, 1, 1.4);
    const tm = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), N), bm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 2.2, 0.06), new THREE.MeshLambertMaterial({ color: 0x444444 }), N), fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), u = new THREE.Vector3(0, 1, 0);
    const TC = [0x2f6fb0, 0xd9742b, 0x3b9a5a, 0xc23b3b, 0xe6b422, 0x6a4c93, 0x1f8a8a, 0xb0b0b0];
    tents.forEach(([x, z, a, i]) => { const y = this.hf.height(x, z); q.setFromAxisAngle(u, a);
      m.compose(new THREE.Vector3(x, y + 0.65, z), q, new THREE.Vector3(1, 1, 1)); tm.setMatrixAt(i, m); tm.setColorAt(i, c.setHex(TC[(hash(i * 3.3) * TC.length) | 0]));
      if (hash(i * 8.1) < 0.18) { m.compose(new THREE.Vector3(x + 1.6, y + 1.1, z), q, new THREE.Vector3(1, 1, 1)); bm.setMatrixAt(i, m); m.compose(new THREE.Vector3(x + 1.6 + 0.85, y + 1.8, z), q, new THREE.Vector3(1, 1, 1)); fm.setMatrixAt(i, m); fm.setColorAt(i, c.setHex(SHIRT[(hash(i) * 10) | 0])); }
      else { const z0 = new THREE.Matrix4().makeScale(0, 0, 0); bm.setMatrixAt(i, z0); fm.setMatrixAt(i, z0); fm.setColorAt(i, c.setHex(0xffffff)); } });
    for (const o of [tm, bm, fm]) o.frustumCulled = false; g.add(tm, bm, fm); this.scene.add(g);
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const crowd = new Crowd(this.scene, this.hf, 140, i => SHIRT[(i * 7) % SHIRT.length], (p, dt, init) => {
      const pick = () => { for (let k = 0; k < 20; k++) { const x = bx0 + Math.random() * (bx1 - bx0), z = bz0 + Math.random() * (bz1 - bz0); if (polys.some(P => inPoly(x, z, P))) { p.tx = x; p.tz = z; return; } } p.tx = cx; p.tz = cz; };
      if (init) { pick(); p.x = p.tx; p.z = p.tz; pick(); return; }
      if (p.wait > 0) { p.wait -= dt; return; } if (steer(p, dt, p.tx, p.tz, p.v * 0.7) < 0.5) { p.wait = 2 + Math.random() * 8; pick(); }
    });
    return { g, crowd, tents: N, update: (dt, cam) => crowd.update(dt, cam), dispose: () => { g.parent?.remove(g); for (const o of [tm, bm, fm]) o.dispose(); crowd.dispose(); } };
  }
  // ------------------------------------------------------------------ Partido en el Bernabéu
  partido() {
    const b = this.bern; if (!b.g) b.build();
    const ent = b.data.filter(e => e.tags?.railway === 'subway_entrance' && e.pts[0]).map(e => e.pts[0]), O = b.O;
    const starts = ent.length ? ent : [[300, -1700]];
    const crowd = new Crowd(this.scene, this.hf, 360, i => hash(i * 1.9) < 0.7 ? 0xf2f2f2 : hash(i * 1.9) < 0.85 ? 0x2f5db3 : hash(i * 1.9) < 0.93 ? 0x111111 : 0xc9a23a, (p, dt, init) => {
      const respawn = () => { const s = starts[(Math.random() * starts.length) | 0]; p.x = s[0] + (Math.random() - 0.5) * 14; p.z = s[1] + (Math.random() - 0.5) * 14; const k = (Math.random() * (O.length - 1)) | 0; p.tx = O[k][0] + (O[k][0] - b.C[0]) * 0.05; p.tz = O[k][1] + (O[k][1] - b.C[1]) * 0.05; };
      if (init) { respawn(); const f = Math.random(); p.x += (p.tx - p.x) * f; p.z += (p.tz - p.z) * f; return; }
      if (steer(p, dt, p.tx, p.tz, p.v * 1.1) < 2.5) respawn();
    });
    b.setMatch(true, b.score);
    return { crowd, update: (dt, cam) => crowd.update(dt, cam), dispose: () => { crowd.dispose(); b.setMatch(false); } };
  }

  set(id, v) {
    if (!!this.on[id] === !!v) return; this.on[id] = !!v;
    if (v) { try { this.obj[id] = this[id](); } catch (e) { console.warn('event', id, e); this.on[id] = false; } }
    else { this.obj[id]?.dispose(); delete this.obj[id]; }
    this.refresh();
  }
  update(dt, cam) {
    this.t += dt;
    if (this.auto && (this._chk = (this._chk || 0) - dt) < 0) { this._chk = 30; const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date()), wd = p.find(x => x.type === 'weekday').value, h = +p.find(x => x.type === 'hour').value; this.set('rastro', /^dom/i.test(wd) && h >= 9 && h < 15); }
    for (const k in this.obj) this.obj[k].update(dt, cam);
  }
  ui() {
    const box = document.createElement('div'); box.className = 'panel'; box.id = 'evSel';
    box.style.cssText = 'left:14px;bottom:62px;z-index:15;font-size:13px;display:flex;flex-direction:column;gap:5px;padding:7px 10px';
    const rows = [['rastro', 'El Rastro (dom.)'], ['sol', 'Acampada de Sol'], ['partido', 'Partido Bernabéu']];
    box.innerHTML = '<span style="color:#f2b84b;font-weight:600">Eventos</span>' + rows.map(([k, n]) => `<div style="display:flex;gap:6px;align-items:center"><button data-t="${k}" style="flex:1;text-align:left;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:3px 9px;cursor:pointer"></button><button data-g="${k}" title="Ir allí" style="border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:3px 7px;cursor:pointer;background:#13202e;color:#fff">Ir</button></div>`).join('')
      + '<label style="font-size:12px;opacity:.85"><input type="checkbox" data-auto> Horario real (Rastro: domingos 9-15 h)</label>';
    this.names = Object.fromEntries(rows); this.box = box;
    box.addEventListener('click', e => { const t = e.target.dataset?.t, go = e.target.dataset?.g; if (t) this.set(t, !this.on[t]); if (go) this.travel?.(...this.at[go]); });
    box.querySelector('[data-auto]').addEventListener('change', e => { this.auto = e.target.checked; this._chk = 0; });
    for (const ev of ['keydown', 'keyup']) box.addEventListener(ev, e => e.stopPropagation());
    document.body.appendChild(box); this.refresh();
  }
  refresh() { for (const b of this.box.querySelectorAll('[data-t]')) { const on = this.on[b.dataset.t]; b.textContent = (on ? '● ' : '○ ') + this.names[b.dataset.t]; b.style.background = on ? '#f2b84b' : '#13202e'; b.style.color = on ? '#111' : '#fff'; } }
}
