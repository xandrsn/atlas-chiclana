import * as THREE from 'three';

// Estadio Santiago Bernabéu (Madrid map only). Verified from OSM (ODbL): stadium outline (way 1507411898), pitch rectangle (way 1446479375),
// Metro Santiago Bernabéu entrances, Tienda Oficial / Taquillas / Bernabéu Market nodes; Catastro volumes inside the outline are hidden and replaced here.
// Everything else (profile of the tiers, facade slats, 360 screen, retractable roof, access cores, gate numbers, colours) is modelled from public
// Commons photos / press descriptions used only as reference, NOT measured: see data/madrid/bernabeu_facts.json (facts.guessed).
// The bowl is built by sweeping a tier profile between a rectangle around the pitch and the real outline, so it follows the real footprint.
// Draw calls: ~10 (seats, concrete, facade, screen, roof, underside, glass, apron, signs, pitch) + 1 instanced crowd (quads, shader-animated) while a match is on.
const BUILD = 1400, NT = 128;          // build distance (m), angular steps
const PROFILE = {                      // [t (0 pitch side .. 1 outer rim), h above pitch level, kind]
  wall: [[0, 0], [0, 1.3]],
  lower: [[0.03, 1.3], [0.29, 9.5]],
  lowerBack: [[0.29, 9.5], [0.29, 12.5]],
  box: [[0.29, 12.5], [0.35, 12.5]],   // palcos floor
  boxGlass: [[0.35, 12.5], [0.35, 15]],
  mid: [[0.36, 15], [0.62, 26]],
  midBack: [[0.62, 26], [0.62, 29]],
  up: [[0.64, 29], [0.90, 43]],
};
const HR = 51, TOPEN = 0.52;           // roof height above pitch level, t where the roof opening starts
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } return t;
}
const seatTex = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#2b3f6b'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 8; r++) for (let s = 0; s < 8; s++) {
    const blue = (r * 3 + s * 5 + ((r >> 1) & 1) * 2) % 11 < 3 || (s === 0) ;
    g.fillStyle = blue ? '#2f5db3' : '#f3f4f6'; g.fillRect(s * 16 + 2, r * 16 + 3, 12, 8);
    g.fillStyle = blue ? '#244b92' : '#c9ced6'; g.fillRect(s * 16 + 2, r * 16 + 11, 12, 3);
  }
}, true);
const facadeTex = () => canvasTex(256, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#d8dde3'); gr.addColorStop(0.5, '#aeb6bf'); gr.addColorStop(1, '#cfd5db'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) { g.fillStyle = y % 16 ? 'rgba(255,255,255,.45)' : 'rgba(40,50,60,.45)'; g.fillRect(0, y, w, 3); }
  for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(30,40,50,.35)'; g.fillRect(x, 0, 2, h); }
}, true);
const paveTex = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#c9c6bf'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(80,80,80,.35)'; g.lineWidth = 2;
  for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
}, true);
const grassTex = (L, W) => canvasTex(512, 768, (g, w, h) => {   // pitch 68 x 105 (+ margins) mapped to the canvas
  const sx = w / (W + 14), sz = h / (L + 14), cx = w / 2, cz = h / 2;
  for (let i = 0; i < 15; i++) { g.fillStyle = i % 2 ? '#3f8a3d' : '#4a9a46'; g.fillRect(0, cz - L / 2 * sz + i * L / 15 * sz - 0.5, w, L / 15 * sz + 1); }
  g.fillStyle = '#3a7a38'; g.fillRect(0, 0, w, cz - L / 2 * sz - 0); g.fillRect(0, cz + L / 2 * sz, w, h); g.fillRect(0, 0, cx - W / 2 * sx, h); g.fillRect(cx + W / 2 * sx, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = 2.2; const R = (x, z, a, b) => g.strokeRect(cx + x * sx, cz + z * sz, a * sx, b * sz);
  R(-W / 2, -L / 2, W, L); g.beginPath(); g.moveTo(cx - W / 2 * sx, cz); g.lineTo(cx + W / 2 * sx, cz); g.stroke();
  g.beginPath(); g.ellipse(cx, cz, 9.15 * sx, 9.15 * sz, 0, 0, 7); g.stroke();
  for (const s of [-1, 1]) { R(-20.15, s < 0 ? -L / 2 : L / 2 - 16.5, 40.3, 16.5); R(-9.16, s < 0 ? -L / 2 : L / 2 - 5.5, 18.32, 5.5);
    g.beginPath(); g.arc(cx, cz + s * (L / 2 - 11) * sz, 9.15 * sx, s < 0 ? 0.65 : Math.PI + 0.65, s < 0 ? Math.PI - 0.65 : 2 * Math.PI - 0.65); g.stroke(); }
}, false);
function screenTex(text) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#05080f'; g.fillRect(0, 0, 2048, 64); g.font = 'bold 40px sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#f4f6ff';
  const unit = text + '    ★    '; let x = 8; while (x < 2048) { g.fillText(unit, x, 34); x += g.measureText(unit).width; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function labelTex(text, bg, fg = '#fff', w = 256, h = 64) {
  return canvasTex(w, h, (g) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `bold ${h * 0.5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2); }, false);
}

class Mesh {   // tiny indexed-geometry accumulator
  constructor() { this.p = []; this.u = []; this.i = []; }
  v(x, y, z, u, v) { this.p.push(x, y, z); this.u.push(u, v); return this.p.length / 3 - 1; }
  q(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeVertexNormals(); return g; }
}

const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; a += P[i][0] * q[1] - q[0] * P[i][1]; } return a / 2; };
function rayPoly(P, cx, cz, dx, dz) {   // farthest hit of the ray from (cx,cz) with polygon P
  let best = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0] - cx, az = P[i][1] - cz, bx = P[i + 1][0] - cx, bz = P[i + 1][1] - cz, ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ez - az * ex) / den, s = (ax * dz - az * dx) / den;
    if (t > 0 && s >= 0 && s <= 1 && t > best) best = t;
  }
  return best;
}

export class Bernabeu {
  constructor(scene, hf, B, data) {
    this.scene = scene; this.hf = hf; this.B = B; this.g = null; this.match = false; this.t = 0; this.retract = 0; this.retractTo = 0; this.score = [2, 6];
    const by = id => data.find(e => e.id === id);
    const S = by('w1507411898').pts, P = by('w1446479375').pts;
    this.S = S[0][0] === S[S.length - 1][0] ? S : [...S, S[0]];
    this.C = [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length];
    this.data = data; this.hideCatastro();
    // floor fix: the DEM slopes across the bowl, so the terrain poked through the flat pitch; level it (inside the stands only, outline is >= 108 m away)
    hf.level(this.C[0], this.C[1], 72, 25, hf.height(...this.C));
    // football.js drew a second, terrain-draped pitch + rails / floodlights / stand on the same OSM pitch (z-fighting); the bowl draws its own
    const fb = window.__football; if (fb) fb.items = fb.items.filter(it => it.f.id !== 'w1446479375');
  }
  /** the real Catastro volumes of the stadium are replaced by the bowl (their footprint still collides) */
  hideCatastro() {
    const B = this.B, S = this.S; let n = 0;
    for (let i = 0; i < B.n; i++) {
      const cx = (B.bb[i * 4] + B.bb[i * 4 + 1]) / 2, cz = (B.bb[i * 4 + 2] + B.bb[i * 4 + 3]) / 2;
      if (cx < 360 || cx > 625 || cz < -1830 || cz > -1590) continue;
      let ins = false; for (let a = 0, b = S.length - 1; a < S.length; b = a++) if ((S[a][1] > cz) !== (S[b][1] > cz) && cx < (S[b][0] - S[a][0]) * (cz - S[a][1]) / (S[b][1] - S[a][1]) + S[a][0]) ins = !ins;
      if (ins) { B.override(i, { skip: true }); n++; }
    }
    this.hidden = n;
  }
  gy(x, z) { return this.hf.height(x, z); }

  build() {
    const g = this.g = new THREE.Group(); g.name = 'bernabeu';
    const C = this.C, S = this.S, hf = this.hf; this.y0 = this.gy(...C) + 0.1;
    const HX = 40, HZ = 58;                                         // run-off rectangle around the pitch (half sizes)
    const th = [], I = [], O = [];
    for (let k = 0; k <= NT; k++) {
      const a = k / NT * 2 * Math.PI, dx = Math.cos(a), dz = Math.sin(a); th.push([dx, dz]);
      const ri = 1 / Math.max(Math.abs(dx) / HX, Math.abs(dz) / HZ), ro = Math.max(rayPoly(S, C[0], C[1], dx, dz) - 0.5, ri * 1.8);
      I.push([C[0] + dx * ri, C[1] + dz * ri]); O.push([C[0] + dx * ro, C[1] + dz * ro]);
    }
    this.I = I; this.O = O;
    const at = (k, t, h) => [I[k][0] + (O[k][0] - I[k][0]) * t, this.y0 + h, I[k][1] + (O[k][1] - I[k][1]) * t];
    const per = []; { let d = 0; per.push(0); for (let k = 1; k <= NT; k++) { d += Math.hypot(O[k][0] - O[k - 1][0], O[k][1] - O[k - 1][1]); per.push(d); } }
    const seats = new Mesh(), conc = new Mesh(), glass = new Mesh();
    const sweep = (M, prof, uS, vS, flip) => {
      for (let k = 0; k < NT; k++) for (let s = 0; s < prof.length - 1; s++) {
        const a0 = at(k, ...prof[s]), a1 = at(k, ...prof[s + 1]), b0 = at(k + 1, ...prof[s]), b1 = at(k + 1, ...prof[s + 1]);
        const lv = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]) / vS, u0 = per[k] / uS * (a0[0] - C[0] ? 1 : 1) * (0.55 + prof[s][0] * 0.45), u1 = per[k + 1] / uS * (0.55 + prof[s][0] * 0.45);
        const A = M.v(...a0, u0, 0), Bv = M.v(...a1, u0, lv), Cc = M.v(...b1, u1, lv), D = M.v(...b0, u1, 0);
        flip ? M.q(A, D, Cc, Bv) : M.q(A, Bv, Cc, D);
      }
    };
    // tiers (seats), vertical backs/wall (concrete), box glass
    sweep(seats, PROFILE.lower, 4, 4); sweep(seats, PROFILE.mid, 4, 4); sweep(seats, PROFILE.up, 4, 4);
    sweep(conc, PROFILE.wall, 6, 6); sweep(conc, PROFILE.lowerBack, 6, 6); sweep(conc, PROFILE.box, 6, 6); sweep(conc, PROFILE.midBack, 6, 6);
    sweep(glass, PROFILE.boxGlass, 6, 6);
    // concourse floor under the upper tier + the back wall that closes the bowl up to the roof
    const back = [[0.90, 43], [0.90, HR - 1.5]]; sweep(conc, back, 6, 6);
    const stTex = seatTex(); stTex.repeat.set(1, 1);
    const seatMat = new THREE.MeshLambertMaterial({ map: stTex, side: THREE.DoubleSide });
    const concMat = mat(0xb9bcc0, { side: THREE.DoubleSide }), glassMat = new THREE.MeshLambertMaterial({ color: 0x1d3550, side: THREE.DoubleSide, emissive: 0x000000 });
    g.add(new THREE.Mesh(seats.geo(), seatMat), new THREE.Mesh(conc.geo(), concMat)); this.glassMesh = new THREE.Mesh(glass.geo(), glassMat); g.add(this.glassMesh);

    // facade: stainless-steel slat skin from the ground to the rim + the 360 screen band under the roof edge
    const fac = new Mesh(), scr = new Mesh(), roofTop = new Mesh(), under = new Mesh(), apron = new Mesh();
    for (let k = 0; k < NT; k++) {
      const g0 = this.gy(O[k][0], O[k][1]) - 1.5, g1 = this.gy(O[k + 1][0], O[k + 1][1]) - 1.5, top = this.y0 + HR - 6, u0 = per[k] / 10, u1 = per[k + 1] / 10;
      const a = fac.v(O[k][0], g0, O[k][1], u0, 0), b = fac.v(O[k][0], top, O[k][1], u0, (top - g0) / 10), c = fac.v(O[k + 1][0], top, O[k + 1][1], u1, (top - g1) / 10), d = fac.v(O[k + 1][0], g1, O[k + 1][1], u1, 0); fac.q(a, b, c, d);
      const sa = scr.v(O[k][0], top, O[k][1], u0 / 8, 0), sb = scr.v(O[k][0], top + 5.2, O[k][1], u0 / 8, 1), sc = scr.v(O[k + 1][0], top + 5.2, O[k + 1][1], u1 / 8, 1), sd = scr.v(O[k + 1][0], top, O[k + 1][1], u1 / 8, 0); scr.q(sa, sb, sc, sd);
      // roof ring (flat, from the rim in to the opening) + underside
      const ra = at(k, 1, HR), rb = at(k, TOPEN, HR), rc = at(k + 1, TOPEN, HR), rd = at(k + 1, 1, HR);
      const T = roofTop.v(...ra, 0, 0), U = roofTop.v(...rb, 0, 1), V = roofTop.v(...rc, 1, 1), W = roofTop.v(...rd, 1, 0); roofTop.q(T, U, V, W);
      const ua = at(k, 1, HR - 0.6), ub = at(k, TOPEN, HR - 0.6), uc = at(k + 1, TOPEN, HR - 0.6), ud = at(k + 1, 1, HR - 0.6);
      const e = under.v(...ua, 0, 0), f = under.v(...ub, 0, 1), gg = under.v(...uc, 1, 1), h = under.v(...ud, 1, 0); under.q(e, f, gg, h);
      // plaza apron (28 m of paving around the outline)
      const dx0 = O[k][0] - C[0], dz0 = O[k][1] - C[1], l0 = Math.hypot(dx0, dz0), dx1 = O[k + 1][0] - C[0], dz1 = O[k + 1][1] - C[1], l1 = Math.hypot(dx1, dz1), W2 = 28;
      const p0 = [O[k][0], O[k][1]], p1 = [O[k][0] + dx0 / l0 * W2, O[k][1] + dz0 / l0 * W2], p2 = [O[k + 1][0] + dx1 / l1 * W2, O[k + 1][1] + dz1 / l1 * W2], p3 = [O[k + 1][0], O[k + 1][1]];
      const ap = [p0, p1, p2, p3].map((p, i) => apron.v(p[0], this.gy(p[0], p[1]) + 0.07, p[1], p[0] / 6, p[1] / 6)); apron.q(ap[0], ap[1], ap[2], ap[3]);
    }
    const fTex = facadeTex(); const facMat = new THREE.MeshLambertMaterial({ map: fTex, side: THREE.DoubleSide, color: 0xe9edf1 });
    this.screenTex = screenTex('REAL MADRID C.F.   ·   ESTADIO SANTIAGO BERNABÉU   ·   ¡HALA MADRID!');
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, color: 0x777777, side: THREE.DoubleSide });
    const roofMat = mat(0xd8dde2, { side: THREE.DoubleSide }); this.underMat = new THREE.MeshLambertMaterial({ color: 0x444a52, emissive: 0x000000, side: THREE.DoubleSide });
    const pt = paveTex(); pt.repeat.set(1, 1);
    const apMat = new THREE.MeshLambertMaterial({ map: pt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    for (const [m, ma] of [[fac, facMat], [scr, this.screenMat], [roofTop, roofMat], [under, this.underMat], [apron, apMat]]) g.add(new THREE.Mesh(m.geo(), ma));

    // rim beam + floodlight strips along the roof opening
    const nl = 96, lg = new THREE.BoxGeometry(2.2, 0.5, 0.9); this.lightMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
    this.lights = new THREE.InstancedMesh(lg, this.lightMat, nl); const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nl; i++) { const k = Math.floor(i / nl * NT), p = at(k, TOPEN, HR - 0.9), a = Math.atan2(th[k][0], th[k][1]); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a); mtx.compose(new THREE.Vector3(p[0], p[1], p[2]), q, sc); this.lights.setMatrixAt(i, mtx); }
    g.add(this.lights);

    // retractable roof: two membrane halves (north / south) sliding along the pitch length
    let hx = 0, hz = 0; for (let k = 0; k < NT; k++) { const p = at(k, TOPEN, HR); hx = Math.max(hx, Math.abs(p[0] - C[0])); hz = Math.max(hz, Math.abs(p[2] - C[1])); }
    this.roofHalf = hz; const pm = new THREE.MeshLambertMaterial({ color: 0xf1f3f5, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    this.panels = [-1, 1].map(s => { const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 4, 0.5, hz + 2), pm); m.userData.s = s; g.add(m); return m; });
    this.setRoof(1, true);   // open by default (match mode keeps it open)

    // pitch (stripes + markings), slightly above the terrain
    const L = 105, W = 68, pg = new THREE.PlaneGeometry(W + 14, L + 14); pg.rotateX(-Math.PI / 2);
    const pitch = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ map: grassTex(L, W), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    pitch.position.set(C[0], this.y0 + 0.08, C[1]); g.add(pitch);

    this.cores(g); this.signs(g); this.crowd(g, at);
    this.scene.add(g);
  }

  /** four circulation cores at the outline's corners, glass + white frames */
  cores(g) {
    const S = this.S, C = this.C, picks = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => S.reduce((b, p) => (p[0] - C[0]) * sx + (p[1] - C[1]) * sz > (b[0] - C[0]) * sx + (b[1] - C[1]) * sz ? p : b));
    const gm = new THREE.MeshLambertMaterial({ color: 0x9fb4c4 }), fm = mat(0xeef0f2);
    for (const p of picks) {
      const dx = p[0] - C[0], dz = p[1] - C[1], l = Math.hypot(dx, dz), x = p[0] + dx / l * 1.5, z = p[1] + dz / l * 1.5, y = this.gy(x, z), a = Math.atan2(dx, dz);
      const m = new THREE.Mesh(new THREE.BoxGeometry(9, this.y0 + HR + 7 - y, 9), gm); m.position.set(x, (y + this.y0 + HR + 7) / 2, z); m.rotation.y = a; g.add(m);
      for (const s of [-4.5, 4.5]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, this.y0 + HR + 7 - y, 9.2), fm); f.position.copy(m.position); f.rotation.y = a; f.translateX(s); g.add(f); }
    }
    this.corePts = picks;
  }

  signs(g) {
    const sg = new THREE.PlaneGeometry(1, 1), O = this.O, C = this.C, tex = [];
    const add = (txt, bg, x, y, z, w, h, ry, fg) => { const t = labelTex(txt, bg, fg, 512, Math.round(512 * h / w)); const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide })); m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); tex.push(t); return m; };
    // gate boards on the facade (numbers are decorative, not the real gate plan)
    for (let i = 0; i < 12; i++) { const k = Math.floor(i / 12 * NT) + 5, p = O[k], dx = p[0] - C[0], dz = p[1] - C[1], l = Math.hypot(dx, dz); add('PUERTA ' + (i * 5 + 1), '#0d2a5c', p[0] + dx / l * 0.4, this.y0 + 8, p[1] + dz / l * 0.4, 8, 1.6, Math.atan2(dx, dz)); }
    // metro entrances (OSM nodes) with the red diamond, shops / ticket offices with a name board
    const inArea = e => e.pts[0] && Math.hypot(e.pts[0][0] - C[0], e.pts[0][1] - C[1]) < 700;
    for (const e of this.data) {
      const t = e.tags, p = e.pts[0]; if (!p || !inArea(e)) continue;
      if (t.railway === 'subway_entrance') { const y = this.gy(...p);
        const r = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 2), mat(0xcfd3d6)); r.position.set(p[0], y + 2.6, p[1]); g.add(r);
        for (const s of [-1.3, 1.3]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15), mat(0x333)); c.position.set(p[0] + s, y + 1.3, p[1] + 0.8); g.add(c); }
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: labelTex('M', '#d6001c', '#fff', 64, 64), side: THREE.DoubleSide })); d.position.set(p[0], y + 3.6, p[1]); d.rotation.y = Math.PI / 4; g.add(d); }
      if (t.name === 'Tienda Oficial Bernabéu') add('TIENDA OFICIAL', '#f4f4f4', p[0], this.gy(...p) + 4, p[1], 9, 1.6, Math.PI / 2, '#1d3a8a');
      if (t.name === 'Taquillas centrales Bernabéu') add('TAQUILLAS', '#0d2a5c', p[0], this.gy(...p) + 3.4, p[1], 7, 1.4, 0);
      if (t.name === 'Bernabéu Market') add('BERNABÉU MARKET', '#8a1c1c', p[0], this.gy(...p) + 3.4, p[1], 8, 1.4, Math.PI / 2);
    }
  }

  /** full house (match mode only): ONE instanced quad per 3 seats (~27 k quads ~ 80 k fans, 54 k triangles, 1 draw call), alpha-tested silhouette atlas.
   *  Shirt colour per quad (Madrid white, Barça blue/garnet in the away corner), heads untinted; jumps, raised arms and the "ola" run in the vertex shader. */
  crowd(g, at) {
    const tex = canvasTex(256, 64, (c, w, h) => {   // 2 frames (arms down | arms up) x 3 fans; torso white (tinted per instance), head = top 30 % (untinted)
      const skin = ['#e0b08a', '#c98f66', '#8d5a3b'], hair = ['#2a1d14', '#5a3a22', '#111', '#b08a50'];
      for (let f = 0; f < 2; f++) for (let p = 0; p < 3; p++) {
        const x = f * 128 + p * 42.7 + 21, s = (p * 5 + f) % 3;
        c.fillStyle = '#f4f4f4'; c.fillRect(x - 12, 22, 24, 42);                                     // torso (seated)
        if (f) { c.fillStyle = skin[s]; c.fillRect(x - 16, 2, 5, 24); c.fillRect(x + 11, 2, 5, 24); }  // arms up (inside the head band: untinted skin)
        c.fillStyle = skin[s]; c.beginPath(); c.arc(x, 11, 7.5, 0, 7); c.fill();
        c.fillStyle = hair[(p * 3 + f) % 4]; c.beginPath(); c.arc(x, 8, 7.5, Math.PI, 0); c.fill();
      }
    });
    tex.magFilter = THREE.LinearFilter;
    const m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    const U = this.crowdU = { uT: { value: 0 }, uC: { value: new THREE.Vector2(...this.C) } };
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, U);
      s.vertexShader = 'uniform float uT; uniform vec2 uC;\n' + s.vertexShader
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vec3 ip = instanceMatrix[3].xyz; float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
          float ola = pow(max(0.0, sin(atan(ip.z - uC.y, ip.x - uC.x) * 2.0 - uT * 1.3)), 24.0);   // two waves running round the bowl
          float hop = max(0.0, sin(uT * (6.0 + 3.0 * ph) + ph * 40.0)) * step(0.86, fract(ph * 7.31 + floor(uT * 0.2 + ph) * 0.37));   // groups celebrating
          float up = max(ola, hop); vMapUv.x += step(0.3, up) * 0.5;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += up * 0.45;');
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR\n diffuseColor.rgb *= mix(vColor, vec3(1.0), step(0.69, vMapUv.y));\n#endif');
    };
    const geo = new THREE.PlaneGeometry(1.5, 1.15); geo.translate(0, 0.5, 0);
    const tiers = [[0.04, 0.28, 1.3, 9.5], [0.37, 0.61, 15, 26], [0.65, 0.89, 29, 43]], P = [], cols = [];
    tiers.forEach(([t0, t1, h0, h1], ti) => {
      const rows = Math.round((t1 - t0) * 80);   // ~0.8 m row pitch on a ~60 m deep bowl
      for (let r = 0; r < rows; r++) {
        const t = t0 + (t1 - t0) * (r + 0.5) / rows, h = h0 + (h1 - h0) * (r + 0.5) / rows;
        for (let k = 0; k < NT; k++) {
          const a = at(k, t, h), b = at(k + 1, t, h), n = Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 1.5);
          for (let j = 0; j < n; j++) {
            const f = (j + 0.5) / n, x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f, id = ((ti * 40 + r) * NT + k) * 97 + j;
            if (hash(id * 7.3 + r) < 0.04) continue;   // a few empty seats
            const away = ti === 2 && k > 72 && k < 84, u = hash(id * 3.1);   // shortcut: away block = one upper-tier sector, not the real visitors' gate
            P.push(x, a[1], z, Math.atan2(this.C[0] - x, this.C[1] - z));
            cols.push(away ? (u < 0.5 ? 0x1d4fa0 : 0xa3123f) : u < 0.78 ? 0xf2f2f2 : u < 0.88 ? 0x2b3f8f : u < 0.95 ? 0x1a1a1a : 0xd8b440);
          }
        }
      }
    });
    const N = P.length / 4, im = new THREE.InstancedMesh(geo, m, N), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    for (let i = 0; i < N; i++) { q.setFromAxisAngle(Y, P[i * 4 + 3]); im.setMatrixAt(i, mt.compose(v.set(P[i * 4], P[i * 4 + 1], P[i * 4 + 2]), q, one)); im.setColorAt(i, col.set(cols[i])); }
    im.frustumCulled = false; im.visible = false; this.fans = im; this.cwN = N; g.add(im);
  }

  setRoof(v, now) { this.retractTo = v ? 1 : 0; if (now) { this.retract = this.retractTo; this.applyRoof(); } }   // 1 = open
  applyRoof() {
    const r = this.retract, hz = this.roofHalf, y = this.y0 + HR + 0.55;
    for (const m of this.panels) m.position.set(this.C[0], y + (r > 0.02 ? 0.55 : 0), this.C[1] + m.userData.s * ((hz + 2) / 2 + r * (hz + 2) * 0.98));
  }
  /** match mode: floodlights + lit glass + 360 screen on, crowd in the stands, roof opens a little */
  setMatch(on, score) {
    this.match = !!on; if (score) this.score = score;
    if (!this.g) return;
    this.lightMat.color.set(on ? 0xfffbe0 : 0x444444); this.underMat.emissive.set(on ? 0x38362a : 0x000000); this.glassMesh.material.emissive.set(on ? 0x16324a : 0x000000);
    this.screenMat.color.set(on ? 0xffffff : 0x777777); this.fans.visible = !!on;
    if (on) { this.screenTex.dispose(); this.screenTex = screenTex(`FC BARCELONA  ${this.score[0]} - ${this.score[1]}  REAL MADRID      ·      ¡HALA MADRID!`); this.screenMat.map = this.screenTex; this.screenMat.needsUpdate = true; }
  }
  update(dt, cam) {
    const d = Math.hypot(cam.x - this.C[0], cam.z - this.C[1]);
    if (!this.g) { if (d < BUILD) { this.build(); if (this.match) this.setMatch(true); } return; }
    this.g.visible = d < BUILD * 1.6; if (!this.g.visible) return;
    this.t += dt; this.screenTex.offset.x = (this.screenTex.offset.x + dt * 0.02) % 1;
    if (this.retract !== this.retractTo) { this.retract += Math.sign(this.retractTo - this.retract) * Math.min(Math.abs(this.retractTo - this.retract), dt / 40); this.applyRoof(); }
    this.crowdU.uT.value = this.t; this.fans.visible = this.match && d < 1100;   // beyond ~1 km the fans are sub-pixel: the seat texture reads as a crowd
  }
}
