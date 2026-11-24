// Loading screen with art drawn in code (canvas 2D, flat poster style, no image files): a collage of Chiclana (salt pans, beach,
// Sancti Petri castle, white houses) and Madrid (Gran Vía, Cibeles, the stadium), progress bar and rotating tips.
// API: showLoading(), setProgress(0..1, text), hideLoading().

import { t as tr } from './i18n.js';

const TITLE = 'ATLAS', SUB = 'Chiclana de la Frontera';
const TIPS = [
  'En las salinas el suelo es blando y el viento sopla de lado: entra en las curvas con suavidad.',
  'W y S para acelerar y frenar, A y D para girar, Espacio para el freno de mano.',
  'Pulsa V para subir a la cámara aérea y ver la ciudad desde arriba.',
  'Con la marea baja, el castillo de Sancti Petri parece estar al alcance de la mano. No lo está.',
  'Las casas encaladas reflejan el sol del mediodía: a esa hora, mejor buscar la sombra.',
  'Al anochecer se encienden las farolas y las ventanas; la niebla se acerca y la ciudad se encoge.',
  'F3 abre el panel de rendimiento: fotogramas, celdas cargadas y tiempo de cada sistema.',
  'Los atardeceres en La Barrosa son largos: buena hora para un paseo por la orilla.',
  'Si el juego va lento, baja la calidad con ?q=bajo en la dirección.',
];

// palette: warm flat poster colours
const P = { cream: '#f3e3c3', paper: '#fbf6ec', ink: '#2b2233', terra: '#c8553d', ochre: '#e8a33d', teal: '#1f4e5f', navy: '#22223b', rose: '#e07a5f', sage: '#81b29a', sand: '#f1d39c' };

const rng = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32

// drawing helpers (scenes are authored in a 160 x 100 box)
const poly = (c, pts, fill) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fillStyle = fill; c.fill(); };
const box = (c, x, y, w, h, fill) => { c.fillStyle = fill; c.fillRect(x, y, w, h); };
const disc = (c, x, y, rx, fill, ry = rx) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); };
const bands = (c, y0, y1, cols) => { const h = (y1 - y0) / cols.length; cols.forEach((col, i) => box(c, 0, y0 + i * h, 160, h + 0.3, col)); };   // posterised gradient
const crenels = (c, x0, x1, y, w, fill) => { for (let x = x0; x < x1 - 0.1; x += w * 2) box(c, x, y - w, Math.min(w, x1 - x), w, fill); };

function salinas(c) {
  bands(c, 0, 52, ['#e9895b', '#f0a46b', '#f5bd80', '#f9d9a6']);
  disc(c, 114, 46, 14, '#fbeed2');
  poly(c, [0, 52, 0, 48, 30, 46, 60, 48, 100, 45, 160, 47, 160, 52], '#b9775f');
  box(c, 0, 52, 160, 48, '#d9c7a8');
  const pools = ['#f2c6b4', '#cfe0e3', '#e8b8a6', '#bcd6db', '#f4d2c2'];
  for (let i = 0; i < 5; i++) {   // evaporation pools in perspective rows
    const y0 = 52 + 48 * (i / 5) ** 1.5, y1 = 52 + 48 * ((i + 1) / 5) ** 1.5, n = 3 + i, s0 = 0.4 + 0.6 * i / 5, s1 = 0.4 + 0.6 * (i + 1) / 5;
    for (let k = 0; k < n; k++) {
      const a = k / n - 0.5, b = (k + 1) / n - 0.5, g = 1.2;
      poly(c, [80 + a * 220 * s0 + g, y0 + g * 0.5, 80 + b * 220 * s0 - g, y0 + g * 0.5, 80 + b * 220 * s1 - g, y1 - g * 0.5, 80 + a * 220 * s1 + g, y1 - g * 0.5], pools[(i + k) % 5]);
    }
  }
  for (const [x, y, s] of [[112, 84, 1], [134, 80, 0.8], [98, 74, 0.55]]) {   // salt mounds: lit and shaded faces
    poly(c, [x - 16 * s, y, x, y - 18 * s, x + 16 * s, y], P.paper); poly(c, [x, y - 18 * s, x + 16 * s, y, x + 4 * s, y], '#e6dccb');
  }
  for (const [x, y] of [[40, 70], [52, 73]]) {   // two flamingos
    c.strokeStyle = '#d9707a'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(x + 3, y); c.quadraticCurveTo(x + 7, y - 6, x + 4, y - 10); c.stroke();
    c.beginPath(); c.moveTo(x, y + 1); c.lineTo(x, y + 7); c.stroke(); disc(c, x + 1, y, 4, '#e98a8a', 2.2); disc(c, x + 4, y - 10, 1.2, '#e98a8a');
  }
}

function playa(c) {
  bands(c, 0, 44, ['#7fb7c9', '#9cc9d2', '#bfdcd8', '#f2e2c4']);
  disc(c, 32, 18, 9, '#fff2cf');
  poly(c, [118, 44, 126, 36, 150, 33, 160, 34, 160, 44], '#c99b6a');   // cliff with an old watchtower
  box(c, 140, 25, 6, 9, '#e9d2a8'); box(c, 140, 25, 2, 9, '#d5b98c');
  bands(c, 44, 62, ['#2f7f8f', '#3f97a3', '#5fb2b5']);
  c.strokeStyle = 'rgba(251,246,236,.8)'; c.lineWidth = 0.8;
  for (const [x, y, w] of [[20, 50, 18], [70, 47, 14], [110, 54, 22], [40, 58, 26]]) { c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 1.5, x + w, y); c.stroke(); }
  box(c, 0, 60, 160, 40, P.sand); box(c, 0, 60, 160, 4, '#d9b77f');
  const umbrella = (x, y, s, col) => {
    c.strokeStyle = '#6b4a3a'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - 12 * s); c.lineTo(x + 1.5 * s, y + 6 * s); c.stroke();
    for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x, y - 12 * s); c.arc(x, y - 12 * s, 13 * s, Math.PI + k * Math.PI / 6, Math.PI + (k + 1) * Math.PI / 6); c.closePath(); c.fillStyle = k % 2 ? P.paper : col; c.fill(); }
    box(c, x - 8 * s, y + 4 * s, 12 * s, 4 * s, col === P.terra ? P.ochre : P.terra);   // towel
  };
  umbrella(42, 78, 0.8, P.terra); umbrella(84, 86, 1, P.teal); umbrella(126, 76, 0.75, P.ochre);
}

function sanctiPetri(c) {
  bands(c, 0, 62, ['#3d3b6e', '#5d4677', '#7a4f7f', '#c8606a', '#ef9a6b', '#f7c98a']);
  disc(c, 104, 58, 12, '#ffe3a8');
  bands(c, 62, 100, ['#5a4a6e', '#3f4a6c', '#2c4f6b', '#22405a']);
  c.fillStyle = '#ffd08a'; for (let i = 0; i < 7; i++) { const w = 18 - i * 2.2; c.fillRect(104 - w / 2, 64 + i * 4, w, 1.2); }   // sun glitter
  const ink = '#2b2440';
  poly(c, [34, 64, 44, 58, 120, 57, 132, 64], '#3a3149');   // islet
  box(c, 46, 46, 64, 12, ink); crenels(c, 46, 110, 46, 2.4, ink);   // walls
  box(c, 71, 24, 14, 22, ink); crenels(c, 71, 85, 24, 2.4, ink);   // keep
  box(c, 76, 14, 4, 8, ink); disc(c, 78, 15, 1.6, '#ffe9a8');   // small light on top
  box(c, 52, 50, 2, 3, '#ffc670'); box(c, 98, 50, 2, 3, '#ffc670');
  c.strokeStyle = 'rgba(251,246,236,.35)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(14, 82); c.lineTo(40, 82); c.moveTo(120, 90); c.lineTo(150, 90); c.stroke();
}

function casasBlancas(c, r) {
  bands(c, 0, 60, ['#4f98c6', '#5fa8d3', '#7cbcdf', '#9fd0e6']);
  box(c, 68, 12, 18, 50, P.paper); box(c, 80, 12, 6, 50, '#e4dccb');   // church tower
  for (const y of [18, 32]) { box(c, 72, y, 6, 9, P.navy); disc(c, 75, y, 3, P.navy); }
  poly(c, [66, 12, 77, 2, 88, 12], P.terra); disc(c, 77, 1.5, 1.2, P.ochre);
  let x = -4;
  while (x < 164) {   // row of whitewashed houses
    const w = 16 + r() * 16, top = 46 + r() * 16, lit = r() < 0.75;
    box(c, x, top, w, 100 - top, lit ? P.paper : '#ece4d4'); box(c, x + w - 3, top, 3, 100 - top, '#ddd3c0');
    if (r() < 0.55) poly(c, [x - 1.5, top, x + w / 2, top - 7, x + w + 1.5, top], P.terra); else box(c, x - 1, top - 2, w + 2, 2, '#e4dccb');
    for (let wx = x + 3; wx < x + w - 6; wx += 8) {
      const wy = top + 6 + r() * 6; box(c, wx, wy, 4.5, 7, r() < 0.5 ? P.teal : '#3f6f5a');
      c.fillStyle = 'rgba(0,0,0,.25)'; for (let b = 1; b < 4; b++) c.fillRect(wx + b * 1.1, wy, 0.3, 7);
      if (r() < 0.6) { box(c, wx - 0.5, wy + 7, 5.5, 1.5, '#a0603f'); disc(c, wx + 1.2, wy + 6.6, 1, P.rose); disc(c, wx + 3.4, wy + 6.4, 1, '#d64545'); }
    }
    if (r() < 0.6) box(c, x + w / 2 - 2.5, 88, 5, 12, P.ochre);
    x += w;
  }
  poly(c, [50, 100, 76, 90, 84, 90, 110, 100], '#d8c3a0');
}

function granVia(c, r) {
  bands(c, 0, 66, ['#2e2a4f', '#46335d', '#5a3c68', '#a14f5e', '#e07a5f', '#f2b880']);
  for (let i = 0; i < 9; i++) {   // receding blocks on the right, lit windows
    const s = 1 - i / 10, x = 160 - 38 * s - i * 5, w = 30 * s, top = 66 - 52 * s;
    box(c, x, top, w + 2, 70 - top, i % 2 ? '#3b2f4a' : '#4a3a58');
    for (let wy = top + 3; wy < 64; wy += 4.5 * s + 1) for (let wx = x + 2; wx < x + w - 2; wx += 4 * s + 1) if (r() < 0.55) box(c, wx, wy, 2 * s, 2.2 * s, r() < 0.8 ? '#ffd58a' : '#ff9e7a');
    if (i === 2 || i === 5) box(c, x + 2, top + 8, 2.5 * s, 18 * s, i === 2 ? '#ff6f91' : '#7ee0e0');   // neon bars, no text
  }
  poly(c, [10, 100, 78, 64, 84, 64, 160, 100], '#3a3346');
  c.strokeStyle = '#f2c14e'; c.lineWidth = 0.6; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(81, 66); c.lineTo(86, 100); c.stroke(); c.setLineDash([]);
  for (let i = 0; i < 14; i++) { const t = r(), y = 66 + t * 34, l = 78 - t * 40 + r() * 10; disc(c, l, y, 0.5 + t, '#ff5a4f'); disc(c, 164 - l + 4, y, 0.5 + t, '#fff3c4'); }
  // corner building with a dome and a winged figure on top
  box(c, 0, 44, 50, 56, '#efe1c6'); box(c, 40, 44, 10, 56, '#dccbaa');
  for (let x = 4; x < 40; x += 6) box(c, x, 50, 2, 50, '#e2cfaa');
  for (let y = 52; y < 96; y += 9) for (let x = 7; x < 38; x += 6) box(c, x, y, 2.6, 5, '#ffcf7a');
  box(c, 12, 34, 26, 10, '#e7d6b6'); for (let x = 13; x < 38; x += 3) box(c, x, 35, 1, 9, '#cdb791');
  c.beginPath(); c.ellipse(25, 34, 15, 14, 0, Math.PI, 0); c.fillStyle = '#2b2a3c'; c.fill();
  c.strokeStyle = P.ochre; c.lineWidth = 0.6; for (const a of [0.2, 0.5, 0.8]) { c.beginPath(); c.moveTo(25, 20); c.quadraticCurveTo(10 + a * 30 + (a - 0.5) * 6, 26, 10 + a * 30, 34); c.stroke(); }
  box(c, 23.5, 14, 3, 6, P.ochre); poly(c, [25, 15, 17, 9, 22, 15], P.ochre); poly(c, [25, 15, 33, 9, 28, 15], P.ochre); disc(c, 25, 12.5, 1.3, P.ochre);
}

function cibeles(c) {
  bands(c, 0, 64, ['#8fc1c9', '#a7cfd0', '#c6ddd2', '#f0dcb4']);
  const st = '#f4ecdc', sh = '#ddd0b8';
  box(c, 18, 40, 124, 32, st);   // palace
  for (let x = 22; x < 140; x += 5) box(c, x, 46, 1.6, 9, sh);
  for (const [x, w, top] of [[70, 20, 18], [30, 12, 30], [118, 12, 30]]) {
    box(c, x, top, w, 40 - top + 1, st); box(c, x + w - 3, top, 3, 40 - top, sh);
    poly(c, [x - 1, top, x + w / 2, top - (w > 15 ? 14 : 8), x + w + 1, top], '#5d6d7e');
    for (let k = 0; k <= 1; k++) poly(c, [x - 1 + k * (w - 1), top, x + 0.5 + k * (w - 1), top - 5, x + 2 + k * (w - 1), top], '#5d6d7e');
    box(c, x + w / 2 - 2, top + 5, 4, 7, sh);
  }
  for (const x of [8, 152]) { disc(c, x, 58, 12, '#5a7d5a', 14); disc(c, x + (x < 80 ? 6 : -6), 52, 8, '#6b8f63'); }
  box(c, 0, 72, 160, 28, '#d8c09a');
  disc(c, 80, 88, 50, '#cdb68f', 10); disc(c, 80, 87, 46, '#7fb7c9', 7.5);
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 0.8;
  for (const d of [-1, 1]) for (const s of [12, 24, 36]) { c.beginPath(); c.moveTo(80 + d * 8, 84); c.quadraticCurveTo(80 + d * (8 + s / 2), 70 - s / 6, 80 + d * (8 + s), 86); c.stroke(); }
  const br = '#6f6a5a';   // the goddess on her chariot pulled by two lions
  box(c, 74, 70, 16, 10, br); disc(c, 76, 81, 3.2, br); disc(c, 88, 81, 3.2, br);
  poly(c, [76, 70, 82, 52, 88, 70], br); disc(c, 82, 50, 2.6, br); box(c, 80, 45.5, 4, 2.4, br);
  for (const y of [77, 73]) { disc(c, 64, y, 7, br, 3); disc(c, 57, y - 2.5, 3.2, '#5e594a'); box(c, 60, y + 1.5, 1.6, 4.5, br); box(c, 67, y + 1.5, 1.6, 4.5, br); }
}

function estadio(c, r) {
  bands(c, 0, 80, ['#141a33', '#1a2240', '#1f2a4d', '#2c3a63']);
  c.fillStyle = 'rgba(255,248,220,.8)'; for (let i = 0; i < 40; i++) c.fillRect(r() * 160, r() * 30, 0.5, 0.5);
  for (const x of [30, 64, 96, 130]) poly(c, [x - 2, 34, x - 26, 0, x + 10, 0, x + 2, 34], 'rgba(255,243,196,.13)');
  box(c, 0, 80, 160, 20, '#2a2f45');
  c.save(); c.beginPath(); c.roundRect(14, 32, 132, 50, [22, 22, 4, 4]); c.clip();
  box(c, 0, 30, 160, 60, '#5b6a85');
  for (let i = 0; i < 9; i++) {   // curved metal ribbons of the skin
    c.beginPath(); const y = 34 + i * 5.6; c.moveTo(0, y + 3); c.bezierCurveTo(50, y - 3, 110, y + 5, 160, y - 1); c.lineTo(160, y + 1.6); c.bezierCurveTo(110, y + 7, 50, y - 1, 0, y + 4.8); c.closePath();
    c.fillStyle = i % 2 ? '#c9d3e0' : '#9aa8bd'; c.fill();
  }
  c.restore();
  c.fillStyle = '#ffe9a8'; c.fillRect(22, 31, 116, 1.2);   // glow from the pitch over the roof edge
  for (let x = 30; x < 140; x += 11) { box(c, x, 74, 4, 8, '#ffd58a'); }
  c.fillStyle = '#11152a'; for (let i = 0; i < 30; i++) { const x = r() * 160, y = 86 + r() * 12; c.fillRect(x, y, 1, 2.4); c.beginPath(); c.arc(x + 0.5, y - 0.4, 0.6, 0, 7); c.fill(); }
}

const SCENES = [
  { f: salinas, cap: 'Salinas', city: 'Chiclana' }, { f: playa, cap: 'La Barrosa', city: 'Chiclana' },
  { f: sanctiPetri, cap: 'Sancti Petri', city: 'Chiclana' }, { f: casasBlancas, cap: 'Casco blanco', city: 'Chiclana' },
  // Madrid panels (granVia, cibeles, estadio) left out while only Chiclana is playable (data/maps.json enabled)
];

/** draws the whole poster collage into canvas `cv` at CSS size w x h; returns the y (CSS px) of the gap between the two rows */
export function drawCollage(cv, w, h, seed = 7) {
  const dpr = Math.min(devicePixelRatio || 1, 2), c = cv.getContext('2d'), r = rng(seed);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = P.cream; c.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.4, R = Math.hypot(w, h);   // sunburst behind the panels
  for (let k = 0; k < 36; k += 2) { const a = k / 36 * Math.PI * 2, b = (k + 1) / 36 * Math.PI * 2; poly(c, [cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(b) * R, cy + Math.sin(b) * R], '#efd3a6'); }
  const rows = [2, 2], area = h * (w / h >= 1 ? 0.72 : 0.7), m = Math.max(10, Math.min(w, h) * 0.03);
  const rh = (area - m * (rows.length + 1)) / rows.length; let i = 0;
  rows.forEach((n, row) => {
    const pw = Math.min((w - m * (n + 1)) / n, rh * 1.9), x0 = (w - (pw * n + m * (n - 1))) / 2;
    for (let k = 0; k < n; k++, i++) panel(c, SCENES[i], x0 + k * (pw + m), m + row * (rh + m), pw, rh, (r() - 0.5) * 5 * Math.PI / 180, r);
  });
  return m + Math.floor(rows.length / 2) * (rh + m) - m / 2;
}

function panel(c, s, x, y, w, h, rot, r) {
  const b = Math.max(4, Math.min(w, h) * 0.035), capH = Math.max(14, h * 0.12), iw = w - 2 * b, ih = h - b - capH;
  c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(rot); c.translate(-w / 2, -h / 2);
  c.shadowColor = 'rgba(70,35,15,.35)'; c.shadowBlur = 14; c.shadowOffsetY = 5; c.fillStyle = P.paper; c.fillRect(0, 0, w, h); c.shadowColor = 'transparent';
  c.save(); c.beginPath(); c.rect(b, b, iw, ih); c.clip();
  const k = Math.max(iw / 160, ih / 100); c.translate(b + (iw - 160 * k) / 2, b + (ih - 100 * k) / 2); c.scale(k, k);   // "cover" fit
  s.f(c, r); c.restore();
  const fs = Math.max(9, Math.min(capH * 0.55, w * 0.07));
  c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; c.fillStyle = P.ink; c.textBaseline = 'middle'; c.fillText(s.cap.toUpperCase(), b, h - capH / 2);
  c.font = `700 ${fs * 0.62}px Verdana, sans-serif`; const tw = c.measureText(s.city.toUpperCase()).width + fs * 0.8;
  c.fillStyle = s.city === 'Madrid' ? P.teal : P.terra; c.fillRect(w - b - tw, h - capH / 2 - fs * 0.5, tw, fs);
  c.fillStyle = P.paper; c.fillText(s.city.toUpperCase(), w - b - tw + fs * 0.4, h - capH / 2 + 0.5);
  c.restore();
}

let root = null, timer = 0, onResize = null;

export function showLoading() {
  if (root) return root;
  if (!document.querySelector('link[data-v2-loading]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./loading.css', import.meta.url).href; l.dataset.v2Loading = ''; document.head.append(l);
  }
  root = document.createElement('div'); root.className = 'v2l';
  root.innerHTML = `<canvas class="v2l-art" aria-hidden="true"></canvas>
    <div class="v2l-title"><h1>${TITLE}</h1><p>${SUB}</p></div>
    <div class="v2l-foot">
      <div class="v2l-row"><span class="v2l-msg" aria-live="polite">Arrancando…</span><span class="v2l-pct">0 %</span></div>
      <div class="v2l-bar" role="progressbar" aria-label="Progreso de carga" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
      <p class="v2l-tip"><b>Consejo</b> <span></span></p>
    </div>`;
  document.body.append(root);
  const cv = root.querySelector('canvas'), title = root.querySelector('.v2l-title');
  onResize = () => { const gap = drawCollage(cv, innerWidth, innerHeight); title.style.top = gap + 'px'; };
  addEventListener('resize', onResize); onResize();
  let t = Math.floor(Math.random() * TIPS.length); const tip = root.querySelector('.v2l-tip span');
  const next = () => { tip.classList.remove('in'); void tip.offsetWidth; tip.textContent = tr(TIPS[t++ % TIPS.length]); tip.classList.add('in'); };
  next(); timer = setInterval(next, 6000);
  return root;
}

export function setProgress(p, text) {
  if (!root) return;
  const v = Math.round(Math.max(0, Math.min(1, +p || 0)) * 100), bar = root.querySelector('.v2l-bar');
  bar.firstChild.style.width = v + '%'; bar.setAttribute('aria-valuenow', v); root.querySelector('.v2l-pct').textContent = v + ' %';
  if (text != null) root.querySelector('.v2l-msg').textContent = text;
}

export function hideLoading() {
  if (!root) return;
  const el = root; root = null; clearInterval(timer); removeEventListener('resize', onResize);
  el.classList.add('v2l-out'); setTimeout(() => el.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600);
}
