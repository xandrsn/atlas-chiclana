import * as THREE from 'three';
import { props } from './props.js';

// Data-driven detailed venues (bars, restaurants...). Each entry of data/venue_specs.json is built by the same generic code:
//   anchor (x,z) + facing (compass bearing of the facade's outward normal, 0 = north) -> picks the real Catastro footprint edge,
//   paints a facade "skin" (colour, plinth, upper windows, shopfront glass with a lit interior, door vinyl) over that wall,
//   adds a projecting sign (script/sans, emblem), a striped awning, terrace tables/chairs/parasols (solid via props.js),
//   menu board, planters, wall lamps. Built lazily near the camera. Adding a venue = adding a JSON entry (see data/venue_specs.md).
export const customVenueIds = new Set();   // OSM ids handled here; Landmarks skips its generic sign for them
const BUILD = 140;

const mat = (c, o) => new THREE.MeshLambertMaterial({ color: c, ...o });
const mats = new Map(); const M = c => { let m = mats.get(c); if (!m) mats.set(c, m = mat(c)); return m; };
const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();

function fleur(g, cx, cy, s, col) {   // simple fleur-de-lis
  g.save(); g.translate(cx, cy); g.scale(s, s); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 0.06;
  g.beginPath(); g.moveTo(0, -1); g.bezierCurveTo(0.34, -0.5, 0.3, 0.1, 0, 0.35); g.bezierCurveTo(-0.3, 0.1, -0.34, -0.5, 0, -1); g.fill();
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * 0.12, 0.1); g.bezierCurveTo(sx * 0.5, -0.35, sx * 0.95, -0.2, sx * 0.9, 0.2); g.bezierCurveTo(sx * 0.85, 0.5, sx * 0.4, 0.45, sx * 0.3, 0.22); g.bezierCurveTo(sx * 0.5, 0.25, sx * 0.62, 0.05, sx * 0.45, -0.05); g.bezierCurveTo(sx * 0.3, 0.0, sx * 0.2, 0.2, sx * 0.12, 0.3); g.closePath(); g.fill();
  }
  g.fillRect(-0.34, 0.34, 0.68, 0.1); g.beginPath(); g.moveTo(-0.2, 0.46); g.lineTo(0, 0.95); g.lineTo(0.2, 0.46); g.closePath(); g.fill(); g.restore();
}
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

function signTex(s) {
  const W = 1024, H = Math.max(96, Math.round(W * s.h / s.w)), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = s.bg; g.fillRect(0, 0, W, H); g.strokeStyle = s.border || s.fg; g.lineWidth = Math.max(4, H * 0.04); g.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
  const em = s.emblem === 'fleur' ? H * 0.62 : 0; if (em) fleur(g, H * 0.62, H * 0.5, em / 2, s.fg);
  const x0 = em ? H * 1.1 : H * 0.15, avail = W - x0 - H * 0.2, sub = s.sub ? H * 0.2 : 0;
  const FONTS = { script: fs => `italic 700 ${fs}px "Segoe Script","Brush Script MT","Lucida Handwriting","Apple Chancery",cursive`, serif: fs => `700 ${fs}px Georgia,"Times New Roman",serif`, slab: fs => `900 ${fs}px "Rockwell","Courier New",Georgia,serif`, rounded: fs => `800 ${fs}px "Trebuchet MS","Segoe UI",Verdana,sans-serif`, condensed: fs => `800 ${fs}px "Arial Narrow","Impact","Haettenschweiler",sans-serif`, italic: fs => `italic 800 ${fs}px "Arial Black",Arial,sans-serif`, light: fs => `300 ${fs}px "Segoe UI","Helvetica Neue",Arial,sans-serif` };
  const font = FONTS[s.font] || (fs => `800 ${fs}px "Arial Black","Segoe UI",Arial,sans-serif`);
  let fs = H * (s.sub ? 0.58 : 0.68); g.font = font(fs); while (g.measureText(s.text).width > avail && fs > 12) { fs -= 3; g.font = font(fs); }
  g.fillStyle = s.fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.text, x0 + avail / 2, H * (s.sub ? 0.42 : 0.52));
  if (s.sub) { g.font = `600 ${H * 0.15}px Arial,sans-serif`; if ('letterSpacing' in g) g.letterSpacing = `${H * 0.03}px`; g.fillText(s.sub, x0 + avail / 2, H * 0.8); }
  return tex(c);
}
function awningTex(col, stripe) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? stripe : col; g.fillRect(i * 32, 0, 32, 64); }
  const t = tex(c); return t;
}
function boardTex(title, lines) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 384; const g = c.getContext('2d');
  g.fillStyle = '#23302a'; g.fillRect(0, 0, 256, 384); g.strokeStyle = '#8b6b3c'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 374);
  g.fillStyle = '#f3efe2'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 40px Arial,sans-serif'; g.fillText(title, 128, 70);
  g.strokeStyle = '#f3efe2'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 110); g.lineTo(216, 110); g.stroke();
  g.font = '600 26px Arial,sans-serif'; lines.forEach((l, i) => { let fs = 26; g.font = `600 ${fs}px Arial,sans-serif`; while (g.measureText(l).width > 220 && fs > 12) { fs--; g.font = `600 ${fs}px Arial,sans-serif`; } g.fillText(l, 128, 170 + i * 52); });
  return tex(c);
}

// ---- facade skin painted on a canvas (local x = along the wall, y down)
function paintInterior(g, x, y, w, h, hash) {      // lit bar interior seen through glass
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#f3d79c'); gr.addColorStop(1, '#8a5a2b'); g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = '#4a2f1b'; g.fillRect(x, y + h * 0.62, w, h * 0.38);                 // bar counter
  g.fillStyle = '#c9a063'; g.fillRect(x, y + h * 0.6, w, h * 0.04);                  // counter top
  g.fillStyle = '#5b3a20'; g.fillRect(x, y + h * 0.28, w, h * 0.03);                 // back shelf
  for (let i = 0; i < w / (h * 0.09); i++) { const bx = x + (i + 0.3) * h * 0.09 + (hash * 7 % 3), bh = h * (0.1 + ((i * 7 + hash * 13) % 5) * 0.012); g.fillStyle = ['#2d5a3a', '#7a3a1a', '#d9c89a', '#1f3f6b'][(i + (hash * 9 | 0)) % 4]; g.fillRect(bx, y + h * 0.28 - bh, h * 0.04, bh); }
  for (let i = 0; i < Math.max(1, Math.floor(w / (h * 0.9))); i++) { const lx = x + w * (i + 0.5) / Math.max(1, Math.floor(w / (h * 0.9))); const rg = g.createRadialGradient(lx, y + h * 0.18, 0, lx, y + h * 0.18, h * 0.22); rg.addColorStop(0, 'rgba(255,240,190,0.95)'); rg.addColorStop(1, 'rgba(255,240,190,0)'); g.fillStyle = rg; g.fillRect(lx - h * 0.25, y, h * 0.5, h * 0.45); }
  g.fillStyle = '#2a1a10'; for (let i = 0; i < w / (h * 0.45); i++) { const sx = x + (i + 0.5) * h * 0.45; g.fillRect(sx - h * 0.04, y + h * 0.7, h * 0.08, h * 0.28); g.fillRect(sx - h * 0.09, y + h * 0.68, h * 0.18, h * 0.04); }   // stools
}
function glass(g, x, y, w, h, spec, hash) {
  if (spec.interior) paintInterior(g, x, y, w, h, hash); else { const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, '#7f9fb0'); gr.addColorStop(1, '#2f4452'); g.fillStyle = gr; g.fillRect(x, y, w, h); }
  g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.moveTo(x + w * 0.1, y + h); g.lineTo(x + w * 0.45, y); g.lineTo(x + w * 0.6, y); g.lineTo(x + w * 0.25, y + h); g.fill();   // reflection
}
function paintSkin(spec, wM, hM, hash) {
  const px = Math.min(56, 2048 / wM), W = Math.round(wM * px), H = Math.round(hM * px), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const f = spec.facade, m = v => v * px, Y = ym => H - m(ym);          // Y: height above ground -> canvas y
  g.fillStyle = f.color; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.03})`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 2 + rnd() * 6); }   // stucco speckle
  const G = f.groundH || 3.4, cx = W / 2;
  // upper floors
  for (let fl = 1; (fl + 1) * 3 <= hM + 0.4 && fl < 5; fl++) {
    const y0 = G + (fl - 1) * 3.0 + 0.7, sp = f.winSpacing || 3.4;
    for (let u = sp / 2; u < wM; u += sp) {
      const x = m(u) - m(0.55), y = Y(y0 + 1.6), w = m(1.1), h = m(1.6);
      g.fillStyle = f.trim; g.fillRect(x - m(0.1), y - m(0.1), w + m(0.2), h + m(0.2)); glass(g, x, y, w, h, { interior: false }, hash);
      g.fillStyle = f.trim; g.fillRect(x - m(0.15), y + h, w + m(0.3), m(0.1));
    }
  }
  // ground floor: plinth, cornice
  g.fillStyle = f.plinth; g.fillRect(0, Y(f.plinthH || 0.8), W, m(f.plinthH || 0.8));
  g.fillStyle = f.trim; g.fillRect(0, Y(G + 0.25), W, m(0.25)); g.fillRect(0, 0, W, m(0.35));         // cornice over shopfront + parapet cap
  // shopfront openings (u is metres from the skin centre)
  for (const e of spec.shopfront || []) {
    const x = cx + m(e.u) - m(e.w / 2), w = m(e.w), isDoor = e.t === 'door', h = m(e.h), y = isDoor ? Y((f.plinthH || 0.8) * 0.4 + e.h) : Y(e.sill + e.h);
    g.fillStyle = f.trim; g.fillRect(x - m(0.14), y - m(0.14), w + m(0.28), h + m(0.14 + (isDoor ? 0 : 0.14)));
    glass(g, x, y, w, h, spec, hash);
    g.fillStyle = f.trim; if (isDoor) { g.fillRect(x + w / 2 - m(0.04), y, m(0.08), h); g.fillStyle = '#d8d2c2'; g.fillRect(x + w / 2 - m(0.22), y + h * 0.5, m(0.05), m(0.35)); g.fillRect(x + w / 2 + m(0.17), y + h * 0.5, m(0.05), m(0.35)); } else if (e.w > 2.2) g.fillRect(x + w / 2 - m(0.03), y, m(0.06), h);
    if (isDoor && (e.hours || e.tel)) { g.fillStyle = 'rgba(255,255,255,0.92)'; g.textAlign = 'left'; g.font = `600 ${m(0.13)}px Arial,sans-serif`; if (e.hours) g.fillText(e.hours, x + m(0.12), y + h * 0.82); if (e.tel) g.fillText('Tel. ' + e.tel, x + m(0.12), y + h * 0.9); }
  }
  return tex(c);
}

export class VenueSpecs {
  constructor(scene, hf, buildings, specs, landmarks) {
    this.scene = scene; this.hf = hf; this.B = buildings; this.L = landmarks; this.t = 0; this.sx = 1e9; this.sz = 1e9;
    this.items = specs.map(s => ({ s, g: null })); for (const s of specs) customVenueIds.add(s.id);
    this.geo = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 10), sph: new THREE.SphereGeometry(1, 10, 8), plane: new THREE.PlaneGeometry(1, 1) };
  }
  /** pick the footprint edge near the anchor whose outward normal best matches the facing bearing */
  pickEdge(s) {
    const L = this.L, B = this.B, P = B.P, ax = s.anchor.x, az = s.anchor.z, b = (s.facing ?? 0) * Math.PI / 180, dn = [Math.sin(b), -Math.cos(b)]; let best = null;
    for (const i of L.partsNear(ax, az, s.search || 30)) {
      const st = B.off[i], en = B.off[i + 1];
      for (let a = st, c = en - 1; a < en; c = a++) {
        const x0 = P[a * 2], z0 = P[a * 2 + 1], x1 = P[c * 2], z1 = P[c * 2 + 1], ex = x1 - x0, ez = z1 - z0, Ln = Math.hypot(ex, ez); if (Ln < 2.5) continue;
        let nx = ez / Ln, nz = -ex / Ln; const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (L.inPoly(i, mx - nx * 0.3, mz - nz * 0.3) === L.inPoly(i, mx + nx * 0.3, mz + nz * 0.3)) continue;
        if (L.inPoly(i, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; }
        if (L.partsNear(mx + nx * 0.4, mz + nz * 0.4, 1).some(j => L.inPoly(j, mx + nx * 0.4, mz + nz * 0.4))) continue;   // internal wall between two parts
        const dot = nx * dn[0] + nz * dn[1]; if (dot < 0.6) continue;
        const u = Math.max(0, Math.min(1, ((ax - x0) * ex + (az - z0) * ez) / (Ln * Ln))), px = x0 + u * ex, pz = z0 + u * ez, d = Math.hypot(ax - px, az - pz);
        const score = d + (1 - dot) * 10 - Math.min(Ln, 20) * 0.15; if (!best || score < best.score) best = { score, part: i, x0, z0, ex, ez, Ln, nx, nz, u };
      }
    }
    return best;
  }
  mesh(geo, m, sx, sy, sz, x, y, z) { const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); return o; }
  build(it) {
    const s = it.s, e = this.pickEdge(s); if (!e) return null;
    const B = this.B, gy = B.base[e.part], bh = Math.max(3.6, Math.min(12, (s.facade?.height) ?? (B.top[e.part] - gy)));
    const wM = Math.min(s.width || 14, e.Ln), t0 = Math.max(wM / 2, Math.min(e.Ln - wM / 2, e.u * e.Ln)), fx = e.x0 + e.ex * t0 / e.Ln, fz = e.z0 + e.ez * t0 / e.Ln;
    const ang = Math.atan2(e.nx, e.nz), tx = e.nz, tz = -e.nx;                 // local +z = outward normal, local +x = (nz,-nx)
    const g = new THREE.Group(); g.position.set(fx, gy, fz); g.rotation.y = ang;
    const W = (lx, lz) => [fx + lx * tx + lz * e.nx, fz + lx * tz + lz * e.nz];   // local -> world xz
    const hash = (s.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0) | 0, 7) >>> 0) % 997 / 997;
    const skin = new THREE.Mesh(this.geo.plane, new THREE.MeshLambertMaterial({ map: paintSkin(s, wM, bh, hash), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    skin.scale.set(wM, bh, 1); skin.position.set(0, bh / 2, 0.07); g.add(skin);
    if (s.sign) {                                                              // projecting sign board
      const sg = s.sign, sy = sg.y ?? 3.3, su = sg.u ?? 0;
      g.add(this.mesh(this.geo.box, M(0x2a2a2a), sg.w + 0.1, sg.h + 0.1, 0.22, su, sy + sg.h / 2, 0.19));
      const f = this.mesh(this.geo.plane, new THREE.MeshBasicMaterial({ map: signTex(sg), color: 0xe8e8e8 }), sg.w, sg.h, 1, su, sy + sg.h / 2, 0.306); g.add(f);
    }
    if (s.awning) {
      const a = s.awning, tilt = 0.26, d = a.depth, y0 = a.y ?? 3.0, tt = awningTex(a.color, a.stripe); tt.wrapS = THREE.RepeatWrapping; tt.repeat.set(Math.max(1, Math.round(a.w / 4)), 1);
      const am = new THREE.Mesh(this.geo.box, [M(a.color), M(a.color), M(a.color), M(a.color), new THREE.MeshLambertMaterial({ map: tt }), new THREE.MeshLambertMaterial({ map: tt })]);
      am.scale.set(a.w, 0.05, d / Math.cos(tilt)); am.rotation.x = tilt; am.position.set(a.u ?? 0, y0 - Math.sin(tilt) * d / 2, d / 2 * Math.cos(tilt) + 0.05); g.add(am);
      g.add(this.mesh(this.geo.box, M(a.color), a.w, 0.22, 0.04, a.u ?? 0, y0 - Math.sin(tilt) * d - 0.1, d * Math.cos(tilt) + 0.05));
    }
    if (s.terrace) {
      const T = s.terrace, chairs = T.chairs ?? 2;
      for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) {
        const lx = (T.u ?? 0) + (c - (T.cols - 1) / 2) * T.colGap, lz = T.offset + r * T.rowGap, [wx, wz] = W(lx, lz);
        if (this.L.partsNear(wx, wz, 1).some(j => this.L.inPoly(j, wx, wz))) continue;
        const tb = new THREE.Group(); tb.add(this.mesh(this.geo.cyl, M(T.table), 0.42, 0.04, 0.42, 0, 0.74, 0), this.mesh(this.geo.cyl, M(0x333333), 0.04, 0.72, 0.04, 0, 0.36, 0), this.mesh(this.geo.cyl, M(0x333333), 0.22, 0.03, 0.22, 0, 0.02, 0));
        for (let k = 0; k < chairs; k++) { const a = (k / chairs) * Math.PI * 2 + (r + c) * 0.7, cx = Math.cos(a) * 0.68, cz = Math.sin(a) * 0.68, ch = new THREE.Group(); ch.add(this.mesh(this.geo.box, M(T.chair), 0.4, 0.05, 0.4, 0, 0.45, 0), this.mesh(this.geo.box, M(T.chair), 0.4, 0.45, 0.05, 0, 0.7, -0.2), this.mesh(this.geo.box, M(T.chair), 0.34, 0.45, 0.34, 0, 0.22, 0)); ch.position.set(cx, 0, cz); ch.rotation.y = -a + Math.PI / 2; tb.add(ch); if (!it.reg) { const [px, pz] = W(lx + cx, lz + cz); props.circle(px, pz, 0.22, gy + 0.5); } }
        if (T.parasol) { tb.add(this.mesh(this.geo.cyl, M(0x555555), 0.025, 2.2, 0.025, 0, 1.1, 0), this.mesh(this.geo.cone, M(s.awning?.color ?? 0xb5251c), 1.25, 0.35, 1.25, 0, 2.3, 0)); }
        tb.position.set(lx, 0, lz); g.add(tb); if (!it.reg) { const [px, pz] = W(lx, lz); props.circle(px, pz, 0.45, gy + 0.8); }
      }
    }
    for (const x of s.extras || []) {
      if (x.t === 'menuboard') {
        const bm = new THREE.MeshLambertMaterial({ map: boardTex(x.title, x.lines), side: THREE.DoubleSide });
        for (const sd of [-1, 1]) { const p = this.mesh(this.geo.plane, bm, 0.6, 0.9, 1, x.u, 0.5, x.z + sd * 0.14); p.rotation.x = -sd * 0.18; if (sd < 0) p.rotation.y = Math.PI; g.add(p); }
        g.add(this.mesh(this.geo.box, M(0x6b4a2a), 0.62, 0.03, 0.34, x.u, 0.02, x.z)); if (!it.reg) { const [px, pz] = W(x.u, x.z); props.box(px, pz, 0.32, 0.2, ang, gy + 0.95); }
      } else if (x.t === 'planters') for (const u of x.u) {
        g.add(this.mesh(this.geo.cyl, M(0xb8643c), 0.32, 0.55, 0.32, u, 0.275, 0.6), this.mesh(this.geo.sph, M(0x2f6b34), 0.42, 0.5, 0.42, u, 0.8, 0.6)); if (!it.reg) { const [px, pz] = W(u, 0.6); props.circle(px, pz, 0.35, gy + 1.2); }
      } else if (x.t === 'lamps') for (const u of x.u) {
        g.add(this.mesh(this.geo.box, M(0x222222), 0.12, 0.3, 0.14, u, 2.7, 0.14), this.mesh(this.geo.sph, new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), 0.1, 0.1, 0.1, u, 2.55, 0.2));
      } else if (x.t === 'club') {   // nightclub front: neon tubes up the facade, rope + gold posts by the door, speaker stacks (no posters, no people's names)
        const neon = c => new THREE.MeshBasicMaterial({ color: c }), hw = Math.min(x.w, 10) / 2;
        for (const sd of [-1, 1]) { g.add(this.mesh(this.geo.box, neon(0xff4fd8), 0.08, 5.5, 0.08, sd * (hw - 0.3), 3.0, 0.1), this.mesh(this.geo.box, neon(0x39e6ff), 0.08, 5.5, 0.08, sd * (hw - 0.55), 3.0, 0.1), this.mesh(this.geo.box, M(0x15151a), 0.7, 1.5, 0.6, sd * (hw - 0.9), 0.75, 0.5), this.mesh(this.geo.cyl, M(0x3a3a44), 0.24, 0.03, 0.24, sd * (hw - 0.9), 1.0, 0.81));
          for (const z of [0.9, 2.6]) g.add(this.mesh(this.geo.cyl, M(0xc9a23a), 0.05, 1.0, 0.05, sd * 1.5, 0.5, z)); g.add(this.mesh(this.geo.box, M(0x9a1420), 0.04, 0.05, 1.7, sd * 1.5, 0.85, 1.75)); }
        g.add(this.mesh(this.geo.box, neon(0xff4fd8), hw * 2 - 0.6, 0.08, 0.08, 0, 5.75, 0.1), this.mesh(this.geo.box, M(0x7a1220), 2.6, 0.02, 2.6, 0, 0.02, 1.4));
      } else if (x.t === 'barrels') for (const u of x.u) {
        g.add(this.mesh(this.geo.cyl, M(0x7a4f2a), 0.38, 0.9, 0.38, u, 0.45, 0.5), this.mesh(this.geo.cyl, M(0x2a2a2a), 0.4, 0.05, 0.4, u, 0.25, 0.5), this.mesh(this.geo.cyl, M(0x2a2a2a), 0.4, 0.05, 0.4, u, 0.65, 0.5)); if (!it.reg) { const [px, pz] = W(u, 0.5); props.circle(px, pz, 0.38, gy + 0.9); }
      }
    }
    it.reg = true; return g;
  }
  update(cam) { try { this._update(cam); } catch (e) { if (!this._err) { this._err = 1; console.warn('venues3d', e); } } }
  _update(cam) {
    this.t++; if (this.t % 15) return;
    const k = window.__lodK ?? 1;
    for (const it of this.items) {
      const d = Math.hypot(it.s.anchor.x - cam.x, it.s.anchor.z - cam.z);
      if (d < BUILD * k) { if (it.g === null) { const g = this.build(it); it.g = g || false; } if (it.g && !it.g.parent) this.scene.add(it.g); }
      else if (it.g && it.g.parent && d > BUILD * k * 1.3) this.scene.remove(it.g);
    }
  }
  /** debug / tests: force-build every spec now */
  buildAll() { for (const it of this.items) { if (it.g === null) it.g = this.build(it) || false; if (it.g && !it.g.parent) this.scene.add(it.g); } return this.items.map(i => !!i.g); }
}
