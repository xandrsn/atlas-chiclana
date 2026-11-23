import { toLocal, clamp } from './geo.js';

// Minimap: vector layers (OSM roads by class, water, parks) projected once, drawn each tick only inside the view window.
// View size follows the vehicle: on foot ~1 km, car ~3 km, helicopter the whole map; slower = more zoom; smoothed in log space.
// Road names are never drawn. Madrid shows metro stations instead (names are shown by the HUD).
const TIER = { motorway: 0, trunk: 0, primary: 0, secondary: 0, tertiary: 1, residential: 2, unclassified: 2, living_street: 2, service: 3, pedestrian: 3 };
const ROAD = [['#f2b84b', 3], ['#ffe9a8', 2.2], ['#d5dde6', 1.4], ['#9fb0c0', 1], ['#7d8c9b', 0.7]];
const AREA = { park: '#2f5a35', wood: '#24472b', beach: '#8a7c52', water: '#1f4d73', pitch: '#3a6b3a', sports: '#3a6b3a', orchard: '#3b5a2c' };
const proj = p => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 2) { const [x, z] = toLocal(p[i], p[i + 1]); o[i] = x; o[i + 1] = z; } return o; };
const bbox = a => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); z0 = Math.min(z0, a[i + 1]); z1 = Math.max(z1, a[i + 1]); } return [x0, z0, x1, z1]; };

export class Minimap {
  /** getActive() -> { x, z, psi, mode, speed } */
  constructor({ canvas, mask, getActive, net, sea, madrid }) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.mask = mask; this.getActive = getActive; this.net = net; this.tram = null; this.sea = sea; this.madrid = madrid;
    this.roads = []; this.areas = []; this.water = []; this.metro = []; this.span = 1000; this.last = '';
    this.full = Math.max(mask.w, mask.h);
    this.load();
  }
  async load() {
    try {
      const osm = await (await fetch('/data/osm.json')).json();
      for (const r of osm.roads) { const t = TIER[r.h?.replace('_link', '')] ?? 4; if (r.u) continue; const p = proj(r.p); this.roads.push({ t, p, b: bbox(p) }); }
      for (const a of osm.areas) if (AREA[a.k]) { const p = proj(a.p); this.areas.push({ c: AREA[a.k], p, b: bbox(p) }); }
      for (const w of osm.waterways || []) { const p = proj(w.p); this.water.push({ p, b: bbox(p), w: w.w || 2 }); }
    } catch (e) { console.warn('minimap data', e); }
    try { const r = await fetch('/data/tram/tram.json'); if (r.ok) this.tram = await r.json(); } catch {}
    if (this.madrid) try { this.metro = (await (await fetch('/data/metro.json')).json()).stations.map(s => [s.x, s.z]); } catch {}
    this.last = '';
  }
  targetSpan(a) {
    const f = this.full, v = Math.abs(a.speed || 0);
    if (a.mode === 'heli') return clamp(f * (0.45 + v / 45), f * 0.45, f);       // hovering zooms in a bit, flying fast shows the whole map
    if (a.mode === 'car' || a.mode === 'rider') return clamp(3000 * (0.4 + v / 30), 1200, 3000);
    if (a.mode === 'chute') return 1500;
    return clamp(1000 * (0.5 + v / 8), 500, 1000);
  }
  draw(dt = 0.1) {
    const a = this.getActive(), W = this.cv.width, H = this.cv.height, g = this.g;
    this.span = Math.exp(Math.log(this.span) + (Math.log(this.targetSpan(a)) - Math.log(this.span)) * Math.min(1, dt * 3));
    const remotes = this.net?.remotes?.size || 0, key = `${a.x | 0},${a.z | 0},${this.span | 0},${a.psi.toFixed(2)}`;
    if (!remotes && key === this.last) return; this.last = key;
    const k = W / this.span, hw = this.span / 2, hh = H / k / 2, x0 = a.x - hw, z0 = a.z - hh, x1 = a.x + hw, z1 = a.z + hh;
    const X = x => (x - x0) * k, Y = z => (z - z0) * k;
    g.fillStyle = this.sea ? '#16324a' : '#1b2530'; g.fillRect(0, 0, W, H);
    g.beginPath(); for (const r of this.mask.rings) r.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)));
    g.fillStyle = '#2a3541'; g.fill('evenodd');
    const vis = b => b[2] >= x0 && b[0] <= x1 && b[3] >= z0 && b[1] <= z1;
    const trace = p => { for (let i = 0; i < p.length; i += 2) i ? g.lineTo(X(p[i]), Y(p[i + 1])) : g.moveTo(X(p[i]), Y(p[i + 1])); };
    if (this.span < 9000) for (const ar of this.areas) if (vis(ar.b)) { g.beginPath(); trace(ar.p); g.fillStyle = ar.c; g.fill(); }
    g.strokeStyle = '#2f6d9c'; g.lineWidth = Math.max(1, 3 * k); g.lineJoin = 'round';
    g.beginPath(); for (const w of this.water) if (vis(w.b)) trace(w.p); g.stroke();
    const maxTier = this.span > 7000 ? 1 : this.span > 3500 ? 2 : this.span > 1800 ? 3 : 4;
    g.lineCap = 'round';
    for (let t = maxTier; t >= 0; t--) {
      g.beginPath(); for (const r of this.roads) if (r.t === t && vis(r.b)) trace(r.p);
      g.strokeStyle = ROAD[t][0]; g.lineWidth = Math.max(0.8, ROAD[t][1] * (this.span > 3500 ? 0.8 : this.span < 1500 ? 1.4 : 1)); g.stroke();
    }
    const U = window.__ug;   // tunnels (dashed) and underground car parks (blue "P" block): underground.js
    if (U && this.span < 6000) {
      g.setLineDash([4, 3]); g.strokeStyle = '#b8c2cc'; g.lineWidth = 1.6; g.beginPath();
      for (const w of U.ways) { if (!w.bb) { w.bb = [1e9, 1e9, -1e9, -1e9]; for (const [x, z] of w.P) { w.bb[0] = Math.min(w.bb[0], x); w.bb[1] = Math.min(w.bb[1], z); w.bb[2] = Math.max(w.bb[2], x); w.bb[3] = Math.max(w.bb[3], z); } }
        if (vis(w.bb)) w.P.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); }
      g.stroke(); g.setLineDash([]);
      for (const h of U.halls) if (vis([h.bb[0], h.bb[2], h.bb[1], h.bb[3]])) { g.beginPath(); h.poly.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.closePath(); g.fillStyle = 'rgba(40,90,170,.55)'; g.fill();
        g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.fillText('P', X((h.bb[0] + h.bb[1]) / 2) - 3, Y((h.bb[2] + h.bb[3]) / 2) + 4); }
    }
    const T = this.tram;
    if (T?.A) { g.beginPath(); trace(T.A.flat()); g.strokeStyle = '#e0482f'; g.lineWidth = 2; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]); }
    if (T?.stations) { g.fillStyle = '#e0482f'; for (const s of T.stations) if (s.x > x0 && s.x < x1 && s.z > z0 && s.z < z1) g.fillRect(X(s.x) - 2, Y(s.z) - 2, 4, 4); }
    g.fillStyle = '#ff6a6a'; for (const [x, z] of this.metro) if (x > x0 && x < x1 && z > z0 && z < z1 && this.span < 6000) { g.beginPath(); g.arc(X(x), Y(z), 2.5, 0, 7); g.fill(); }
    for (const r of this.net?.remotes?.values() || []) if (r.seen && !r.ride) { g.fillStyle = r.color; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(clamp(X(r.pos.x), 4, W - 4), clamp(Y(r.pos.z), 4, H - 4), 4, 0, 7); g.fill(); g.stroke(); }
    g.save(); g.translate(W / 2, H / 2); g.rotate(-a.psi); g.fillStyle = '#ff5a3c'; g.strokeStyle = '#fff'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = 'rgba(8,16,26,.7)'; g.fillRect(4, H - 18, 62, 14); g.fillStyle = '#fff'; g.font = '10px system-ui'; g.fillText(this.span >= 2000 ? (this.span / 1000).toFixed(1) + ' km' : Math.round(this.span) + ' m', 8, H - 8);
    g.fillStyle = '#fff'; g.fillText('N', W - 12, 12);
  }
}
