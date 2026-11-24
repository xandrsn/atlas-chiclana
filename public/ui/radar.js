// HUD radar (circle, bottom left, turns with the camera) + full-screen map (pause menu "Mapa" or M: wheel zoom, drag, north up).
// Both draw the same 4 m raster (data/parking/<map>.radar.bin from scripts/radar_data.mjs: own colours, baked from the map's own data,
// no tiles) with canvas 2D, plus markers: places (zone spawns), transport stops, helicopters (parked + the player's), the player's car, you.
import { onKey } from '../input/keys.js';
import { t as tr, translate } from './i18n.js';

// class -> colour (own HUD palette): field, green, sand, marsh, water, urban, building, pedestrian, street, main road, motorway
const PAL = ['#a3a874', '#6c9552', '#dccb92', '#c9d2c8', '#3c78a0', '#b4ad9c', '#857e72', '#d8d0bc', '#f4f1e8', '#f2c14e', '#e07a3c'], OUT = '#22223b';
const NAVY = '#22223b', CREAM = '#fbf6ec', GOLD = '#f2c14e', RED = '#c8553d';
const rgba = h => (255 << 24 | parseInt(h.slice(5, 7), 16) << 16 | parseInt(h.slice(3, 5), 16) << 8 | parseInt(h.slice(1, 3), 16)) >>> 0;   // little-endian ImageData word
const LUT = new Uint32Array(256).fill(rgba(OUT)); PAL.forEach((c, i) => { LUT[i] = rgba(c); });

/** RLE file -> { x0, z0, px, W, H, G } (exported for the node test) */
export function decodeRadar(buf) {
  const v = new DataView(buf); if (v.getUint32(0, true) !== 0x31524452) throw new Error('radar.bin: bad magic');
  const W = v.getUint32(16, true), H = v.getUint32(20, true), n = v.getUint32(24, true), src = new Uint8Array(buf, 32, n), G = new Uint8Array(W * H);
  for (let k = 0, o = 0; k < n; k += 2) { G.fill(src[k + 1], o, o + src[k]); o += src[k]; }
  return { x0: v.getFloat32(4, true), z0: v.getFloat32(8, true), px: v.getFloat32(12, true), W, H, G };
}

export async function makeRadar({ map, play, cam, pause, index, transit }) {
  let R;
  try { R = decodeRadar(await (await fetch(`/data/parking/${map}.radar.bin`)).arrayBuffer()); } catch (e) { console.warn('[v2] sin radar:', e.message); return null; }
  const at = (x, z) => { const i = Math.floor((x - R.x0) / R.px), j = Math.floor((z - R.z0) / R.px); return i < 0 || j < 0 || i >= R.W || j >= R.H ? 255 : R.G[j * R.W + i]; };

  // markers: [x, z, kind, label]; kinds drawn by mark()
  const T = transit?.maps?.[map], marks = [];
  for (const s of Object.values(index.spawns || {})) marks.push([s.x, s.z, 'place', s.name]);
  for (const s of T?.metro?.stations || []) marks.push([s.x, s.z, 'metro', s.name]);
  for (const l of T?.rail || []) for (const s of l.stops) marks.push([s.x, s.z, 'rail', `${l.name}: ${s.name}`]);
  const live = () => {   // moving ones: helicopters on their pads, the player's car / helicopter
    const o = [], P = play.pads;
    for (const s of P?.spots || []) if (s.ok !== false) o.push([s.x, s.z, 'heli', tr('Helicóptero')]);
    if (play.heli) o.push([play.heli.x, play.heli.z, 'heli', tr('Tu helicóptero')]);
    if (play.inKind !== 'car') o.push([play.vehicles[0].sim.x, play.vehicles[0].sim.z, 'car', tr('Tu coche')]);
    return o;
  };
  const mark = (g, k, u, v, s = 1) => {
    g.lineWidth = 2 * s; g.strokeStyle = NAVY;
    if (k === 'place') { g.fillStyle = CREAM; g.fillRect(u - 3 * s, v - 3 * s, 6 * s, 6 * s); g.strokeRect(u - 3 * s, v - 3 * s, 6 * s, 6 * s); return; }
    if (k === 'car') { g.fillStyle = RED; g.fillRect(u - 4 * s, v - 3 * s, 8 * s, 6 * s); g.strokeRect(u - 4 * s, v - 3 * s, 8 * s, 6 * s); return; }
    const [bg, t] = { metro: ['#2a62b8', 'M'], rail: ['#2f8a5a', 'T'], heli: [GOLD, 'H'] }[k];
    g.beginPath(); g.arc(u, v, 6.5 * s, 0, 7); g.fillStyle = bg; g.fill(); g.stroke();
    g.fillStyle = k === 'heli' ? NAVY : CREAM; g.font = `900 ${9 * s}px Verdana, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, u, v + 0.5 * s);
  };
  const arrow = (g, u, v, ang, s) => {   // you: gold arrowhead, ang = screen angle of the heading (0 = up)
    g.save(); g.translate(u, v); g.rotate(ang); g.beginPath(); g.moveTo(0, -9 * s); g.lineTo(6.5 * s, 7 * s); g.lineTo(0, 3.5 * s); g.lineTo(-6.5 * s, 7 * s); g.closePath();
    g.fillStyle = GOLD; g.fill(); g.lineWidth = 2 * s; g.strokeStyle = NAVY; g.stroke(); g.restore();
  };
  const css = (el, s) => { el.style.cssText = s; return el; };

  // ---- radar: N px canvas, a disc of the raster around the focus, rotated so the camera's forward is up
  const N = 210, rc = css(document.createElement('canvas'), `position:fixed;left:18px;bottom:18px;width:${N}px;height:${N}px;border-radius:50%;border:4px solid ${NAVY};box-shadow:0 4px 0 ${RED},0 6px 16px #0006;z-index:4;pointer-events:none;background:${OUT}`);
  rc.width = rc.height = N; rc.setAttribute('aria-hidden', 'true'); document.body.appendChild(rc);
  const rg = rc.getContext('2d'), img = rg.createImageData(N, N), px32 = new Uint32Array(img.data.buffer), dir = cam.position.clone();   // a Vector3 scratch (getWorldDirection needs one)
  let last = 0;
  const drawRadar = () => {
    const f = play.current, c = N / 2, kind = play.inKind, sp = Math.abs(f.v || 0);
    const s = kind === 'heli' ? 5 : kind === 'car' ? 2 + Math.min(2, sp / 15) : 1.6;   // m per px: wider while driving fast / flying
    cam.getWorldDirection(dir); let fx = dir.x, fz = dir.z; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const rx = -fz, rz = fx;   // screen right in the world (camera forward x up)
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      const a = (u + 0.5 - c) * s, b = (c - v - 0.5) * s;
      px32[v * N + u] = LUT[at(f.x + a * rx + b * fx, f.z + a * rz + b * fz)];
    }
    rg.putImageData(img, 0, 0);
    const scr = (x, z) => { const dx = x - f.x, dz = z - f.z; return [c + (dx * rx + dz * rz) / s, c - (dx * fx + dz * fz) / s]; };
    for (const [x, z, k] of marks.concat(live())) { const [u, v] = scr(x, z); if (Math.hypot(u - c, v - c) < c - 6) mark(rg, k, u, v, 0.85); }
    const hx = -Math.sin(f.h), hz = -Math.cos(f.h); arrow(rg, c, c, Math.atan2(hx * rx + hz * rz, hx * fx + hz * fz), 1);
    const na = Math.atan2(-rz, -fz);   // north (-z) on screen
    const nu = c + Math.sin(na) * (c - 11), nv = c - Math.cos(na) * (c - 11);
    rg.beginPath(); rg.arc(nu, nv, 8, 0, 7); rg.fillStyle = NAVY; rg.fill(); rg.fillStyle = GOLD; rg.font = '900 11px Verdana, sans-serif'; rg.textAlign = 'center'; rg.textBaseline = 'middle'; rg.fillText('N', nu, nv + 0.5);
  };

  // ---- full map: north up, wheel = zoom at the cursor, drag = pan; half-resolution raster + full-resolution markers and names
  const ov = css(document.createElement('div'), `position:fixed;inset:0;z-index:20;background:${OUT};display:none;cursor:grab;font:600 13px Verdana,sans-serif;color:${CREAM}`);
  const mc = css(document.createElement('canvas'), 'position:absolute;inset:0;width:100%;height:100%');
  const bar = css(document.createElement('div'), `position:absolute;left:0;right:0;top:0;display:flex;gap:14px;align-items:center;padding:10px 16px;background:${NAVY};box-shadow:0 4px 0 ${RED}`);
  bar.innerHTML = `<b style="font:900 24px 'Arial Black',Impact,sans-serif;color:${GOLD};text-shadow:2px 2px 0 ${RED};text-transform:uppercase">Mapa</b>
    <span style="flex:1;opacity:.85">Rueda: zoom · arrastrar: mover · M o Esc: volver</span>
    <span>■ sitio · <span style="color:#7fb0ff">M</span> metro · <span style="color:#8fd6a8">T</span> tren/tranvía · <span style="color:${GOLD}">H</span> helicóptero · <span style="color:${RED}">■</span> tu coche</span>
    <button style="font:inherit;color:${NAVY};background:${GOLD};border:2px solid ${CREAM};padding:6px 12px;cursor:pointer">Volver</button>`;
  ov.append(mc, bar); document.body.appendChild(translate(ov));
  const mg = mc.getContext('2d'), half = document.createElement('canvas'), hg = half.getContext('2d');
  const V = { x: 0, z: 0, s: 4 }; let open = false, dirty = true, drag = null;
  const drawMap = () => {
    const W = mc.width = innerWidth, H = mc.height = innerHeight, w = half.width = Math.ceil(W / 2), h = half.height = Math.ceil(H / 2);
    const im = hg.createImageData(w, h), p = new Uint32Array(im.data.buffer), x0 = V.x - W / 2 * V.s, z0 = V.z - H / 2 * V.s;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p[j * w + i] = LUT[at(x0 + (i * 2 + 1) * V.s, z0 + (j * 2 + 1) * V.s)];
    hg.putImageData(im, 0, 0); mg.imageSmoothingEnabled = false; mg.drawImage(half, 0, 0, w * 2, h * 2);
    const scr = (x, z) => [(x - x0) / V.s, (z - z0) / V.s], all = marks.concat(live());
    for (const [x, z, k] of all) { const [u, v] = scr(x, z); if (u > -10 && v > -10 && u < W + 10 && v < H + 10) mark(mg, k, u, v, 1.2); }
    mg.font = '600 12px Verdana, sans-serif'; mg.textAlign = 'left'; mg.textBaseline = 'middle'; mg.lineWidth = 3; mg.strokeStyle = NAVY; mg.fillStyle = CREAM;
    for (const [x, z, k, t] of all) { if (k !== 'place' && V.s > 3) continue; const [u, v] = scr(x, z); if (u > 0 && v > 0 && u < W && v < H) { mg.strokeText(t, u + 11, v); mg.fillText(t, u + 11, v); } }   // names: places always, the rest when zoomed in
    const f = play.current, [u, v] = scr(f.x, f.z); arrow(mg, u, v, -f.h, 1.4);   // north up: screen angle of heading h (0 = north) is -h
    dirty = false;
  };
  const show = on => { open = on; ov.style.display = on ? '' : 'none'; if (on) { const f = play.current; V.x = f.x; V.z = f.z; dirty = true; } };
  bar.querySelector('button').onclick = () => show(false);
  ov.addEventListener('wheel', e => { e.preventDefault(); const k = Math.exp(e.deltaY * 0.0015), mx = e.clientX - innerWidth / 2, mz = e.clientY - innerHeight / 2, s2 = Math.min(40, Math.max(0.5, V.s * k));
    V.x += mx * (V.s - s2); V.z += mz * (V.s - s2); V.s = s2; dirty = true; }, { passive: false });
  ov.addEventListener('pointerdown', e => { if (e.target.tagName === 'BUTTON') return; drag = [e.clientX, e.clientY]; ov.setPointerCapture(e.pointerId); ov.style.cursor = 'grabbing'; });
  ov.addEventListener('pointermove', e => { if (!drag) return; V.x -= (e.clientX - drag[0]) * V.s; V.z -= (e.clientY - drag[1]) * V.s; drag = [e.clientX, e.clientY]; dirty = true; });
  ov.addEventListener('pointerup', () => { drag = null; ov.style.cursor = 'grab'; });
  addEventListener('resize', () => { dirty = true; });
  pause.onMap = () => show(true);
  onKey('KeyM', () => { if (open) return show(false); if (!pause.paused) pause.pause(); show(true); });

  const tick = now => {
    requestAnimationFrame(tick);
    if (open && !pause.paused) show(false);   // Esc resumed the game: the map goes with the pause menu
    if (open) { if (dirty) drawMap(); return; }
    if (now - last > 66) { last = now; drawRadar(); }   // ~15 Hz is plenty for a radar
  };
  requestAnimationFrame(tick);
  return { at, show, get open() { return open; }, marks };
}
