// Public transport (Fase 8): data/transit.json (scripts/transit_data.mjs).
//  - Metro (Madrid): walk down the stairs of an entrance (real pit: scripts/bake/plugins/madrid_metro.mjs); on the bottom landing the metro
//    screen opens: pick a line, then a station -> you come out of one of its entrances; or back up to the street, or out by another entrance.
//  - Cercanías (Madrid) / Tranvía (Chiclana): on foot near a stop, F opens the line's screen: another stop of the line, or the train to the
//    other map (reload with ?map=&spawn=, behind the existing loading screen).
// The screens are the pause menu's style (ui/pause.css), own design, no real logos. While one is open the game is paused (pause.paused).
// Pure helpers (stairAt, stopNear, spawnFor, outOf) are exported for the node tests (scripts/transit_v2_test.mjs).
import { onAction } from '../input/keys.js';
import { t as tr, translate } from './i18n.js';

const GB = 64;
/** entrances [[x, z, h, station]] -> bucket grid */
export function entranceGrid(E) { const g = new Map(); E.forEach((e, k) => { const key = Math.floor(e[0] / GB) + ',' + Math.floor(e[1] / GB); if (!g.has(key)) g.set(key, []); g.get(key).push(k); }); return g; }
/** stair-local coords of (x, z): s along the stairs (towards the station, 0 = pit centre), t across */
const loc = (e, x, z) => { const dx = x - e[0], dz = z - e[1], u = [Math.sin(e[2]), Math.cos(e[2])]; return [dx * u[0] + dz * u[1], -dx * u[1] + dz * u[0]]; };
/** index of the entrance whose pit contains (x, z) (part: 'landing' = bottom landing only, 'pit' = anywhere in it, 'mouth' = within 4 m of the street end) or -1 */
export function stairAt(T, grid, x, z, part = 'landing') {
  const S = T.stair, half = (S.len + S.land) / 2;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of grid.get((Math.floor(x / GB) + i) + ',' + (Math.floor(z / GB) + j)) || []) {
    const [s, t] = loc(T.entrances[k], x, z);
    if (part === 'mouth' ? Math.hypot(s + half, t) < 4 : Math.abs(t) <= S.hw && s <= half && s >= (part === 'landing' ? half - S.land - 0.3 : -half)) return k;
  }
  return -1;
}
/** street spot just past an entrance's mouth, facing away from the stairs: [x, z, h] (player heading: forward = (-sin h, -cos h)) */
export function outOf(T, e) { const d = (T.stair.len + T.stair.land) / 2 + 1.2; return [e[0] - Math.sin(e[2]) * d, e[1] - Math.cos(e[2]) * d, e[2]]; }
/** nearest rail stop within r m: { line, stop } | null */
export function stopNear(rail, x, z, r = 7) {
  let best = null, bd = r; for (const line of rail || []) for (const stop of line.stops) { const d = Math.hypot(stop.x - x, stop.z - z); if (d < bd) { bd = d; best = { line, stop }; } }
  return best;
}
/** a rail stop id of this map as a spawn point ({ name, x, z, h }) or null */
export function spawnFor(T, map, id) { for (const l of T?.maps?.[map]?.rail || []) for (const s of l.stops) if (s.id === id) return s; return null; }

let css = false;
function style() {
  if (css) return; css = true;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./pause.css', import.meta.url); document.head.appendChild(l);
  const s = document.createElement('style'); s.textContent = `
  .v2t .v2p-box { width: min(620px, 100%); }
  .v2t h2 { font-size: 28px; } .v2t h3 { margin: 14px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #f2c14e; }
  .v2t-sub { margin: -6px 0 10px; font-weight: 400; }
  .v2t-lines { display: flex; flex-wrap: wrap; gap: 6px; }
  .v2t-lines button { min-width: 48px; padding: 6px 10px; border-color: var(--c); box-shadow: inset 0 -5px 0 var(--c); }
  .v2t-lines button[aria-pressed=true] { background: var(--c); color: #111; text-shadow: 0 0 2px #fff; }
  .v2t-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; max-height: 46vh; overflow: auto; padding: 2px; }
  .v2t-list button { text-align: left; font-weight: 400; padding: 6px 10px; }
  .v2t-list button:disabled { opacity: .6; cursor: default; background: #22223b; }
  .v2t-dots { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: middle; } .v2t-dots i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); display: inline-block; }
  .v2t-foot { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .v2t-hint { position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 5; padding: 6px 14px; background: rgba(34, 34, 59, .85); color: #fbf6ec; font: 600 14px/1.4 Verdana, sans-serif; border-bottom: 3px solid #f2c14e; pointer-events: none; }
  .v2t-hint[hidden] { display: none; }
  .v2t.v2t-wide .v2p-box { width: min(1180px, 100%); }
  .v2t-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
  .v2t-grid .v2t-list { grid-template-columns: 1fr; max-height: 36vh; }
  .v2t-map { position: relative; height: min(64vh, 600px); min-height: 260px; background: #171629; border: 2px solid #3a3456; }
  .v2t-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  .v2t-map small { position: absolute; left: 8px; bottom: 6px; font-weight: 400; color: #b9b3cc; pointer-events: none; }
  @media (max-width: 760px) { .v2t-grid { grid-template-columns: 1fr; } .v2t-map { height: 46vh; } }`;
  document.head.appendChild(s);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Network map on a canvas (port of the v1 metro map): lines in their colours, stations as dots (interchanges bigger), "here" in yellow.
 * Drag = pan, wheel = zoom, click a station = pick(i). S: [{ x, z, name, lines? }] · L: [{ c, stops: [i], on? }] (on = the highlighted line)
 * cam: kept across re-renders of the same screen (null = fit the whole network). Returns { hover(i) } for the station list.
 */
function netMap(cv, { S, L, here, pick, cam }) {
  const g = cv.getContext('2d'), used = S.map((s, i) => i).filter(i => L.some(l => l.stops.includes(i)));
  let hov = -1, drag = null, moved = 0;
  const W = () => cv.clientWidth, H = () => cv.clientHeight;
  if (!cam.k) {   // fit every station on a line, a little margin
    const xs = used.map(i => S[i].x), zs = used.map(i => S[i].z), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    Object.assign(cam, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, k: Math.min(0.5, 0.88 * Math.min(W() / Math.max(x1 - x0, 1), H() / Math.max(z1 - z0, 1))) });
  }
  const toS = (x, z) => [(x - cam.x) * cam.k + W() / 2, (z - cam.z) * cam.k + H() / 2];
  const hit = (px, py) => { let b = -1, bd = 14 * 14; for (const i of used) { const [x, y] = toS(S[i].x, S[i].z), d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; b = i; } } return b; };
  function draw() {
    const dpr = devicePixelRatio || 1, w = W(), h = H(); if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); g.lineCap = g.lineJoin = 'round';
    const lw = Math.max(2.5, Math.min(7, cam.k * 40)), r = Math.max(3, Math.min(7, cam.k * 55)), sel = L.some(l => l.on), names = cam.k > 0.16 || used.length <= 12;   // a short line: every name
    for (const l of [...L].sort((a, b) => !!a.on - !!b.on)) {   // highlighted line on top, the others dimmed
      g.globalAlpha = sel && !l.on ? 0.4 : 1; g.strokeStyle = l.c; g.lineWidth = l.on ? lw + 2 : lw; g.beginPath();
      l.stops.forEach((i, n) => { const [x, y] = toS(S[i].x, S[i].z); n ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }
    g.globalAlpha = 1; g.font = '12px Verdana, sans-serif';
    const label = (i, x, y, rr) => { g.fillStyle = '#fbf6ec'; g.strokeStyle = '#171629'; g.lineWidth = 3; g.strokeText(S[i].name, x + rr + 4, y + 4); g.fillText(S[i].name, x + rr + 4, y + 4); };
    for (const i of used) {
      const [x, y] = toS(S[i].x, S[i].z); if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue; const rr = (S[i].lines?.length > 1 ? 1.35 : 1) * r;
      g.fillStyle = i === here ? '#f2c14e' : i === hov ? '#c8553d' : '#fbf6ec'; g.strokeStyle = '#22223b'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill(); g.stroke();
      if (i === here) { g.strokeStyle = '#f2c14e'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, rr + 4, 0, 7); g.stroke(); }
      if (names || i === hov || i === here) label(i, x, y, rr);
    }
    if (hov >= 0 && !names) { const [x, y] = toS(S[hov].x, S[hov].z); label(hov, x, y, r * 1.35); }   // hovered name on top of the others
  }
  cv.addEventListener('pointerdown', e => { drag = [e.offsetX, e.offsetY]; moved = 0; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (drag) { cam.x -= (e.offsetX - drag[0]) / cam.k; cam.z -= (e.offsetY - drag[1]) / cam.k; moved += Math.abs(e.offsetX - drag[0]) + Math.abs(e.offsetY - drag[1]); drag = [e.offsetX, e.offsetY]; }
    const h = hit(e.offsetX, e.offsetY); hov = h; cv.style.cursor = drag && moved > 4 ? 'grabbing' : h >= 0 && h !== here ? 'pointer' : 'grab'; draw();
  });
  cv.addEventListener('pointerup', e => { drag = null; if (moved < 5) { const i = hit(e.offsetX, e.offsetY); if (i >= 0 && i !== here) pick(i); } });
  cv.addEventListener('pointerleave', () => { if (!drag) { hov = -1; draw(); } });
  cv.addEventListener('wheel', e => {   // zoom about the cursor
    e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2, k = Math.min(2, Math.max(0.01, cam.k * f)), mx = e.offsetX - W() / 2, my = e.offsetY - H() / 2;
    cam.x += mx / cam.k - mx / k; cam.z += my / cam.k - my / k; cam.k = k; draw();
  }, { passive: false });
  new ResizeObserver(draw).observe(cv);
  draw();
  return { hover(i) { hov = i; draw(); } };
}

/**
 * T: data/transit.json · map: current map id · play: sim/play.js api · cells: stream/cells.js (ground) · pause: ui/pause.js
 * teleport(x, z, h): same map, behind the loading screen (boot.js) · go(map, spawn): another map (reload)
 */
export function makeTransit({ T, map, play, cells, pause, teleport, go }) {
  style();
  const M = T.maps[map] || {}, metro = M.metro, rail = M.rail || [], grid = metro ? entranceGrid(metro.entrances) : new Map();
  const MT = metro && { ...metro, stair: T.stair };
  const colour = ref => metro?.lines.find(l => l.ref === ref)?.colour || '#888';
  const el = document.createElement('div'); el.className = 'v2p v2t'; el.hidden = true; document.body.appendChild(el);
  const hint = document.createElement('div'); hint.className = 'v2t-hint'; hint.hidden = true; hint.setAttribute('aria-live', 'polite'); document.body.appendChild(hint);
  let open = null, armed = true, wasIn = false, near = null;

  let cam = {};   // network map view, kept while switching lines on the same screen
  const show = (html, wire) => {
    el.classList.toggle('v2t-wide', html.includes('v2t-map'));
    el.innerHTML = `<div class="v2p-box" role="dialog" aria-modal="true" aria-labelledby="v2t-t">${html}</div>`; translate(el).hidden = false;
    pause.paused = true; if (document.pointerLockElement) document.exitPointerLock();   // frozen like the pause menu, without opening it
    wire(sel => el.querySelectorAll(sel)); (el.querySelector('[autofocus]') || el.querySelector('button:not(:disabled)'))?.focus();
  };
  const close = () => { if (!open) return; open = null; el.hidden = true; el.innerHTML = ''; pause.resume(); };
  const ride = (x, z, h) => { close(); teleport(x, z, h); };

  /** metro screen at entrance k (line: the tab shown) */
  function metroScreen(k, line) {
    const e = metro.entrances[k], si = e[3], st = metro.stations[si]; if (!line) cam = {}; line ||= st.lines[0] || metro.lines[0].ref; open = { kind: 'metro', k };
    const L = metro.lines.find(l => l.ref === line), dots = s => `<span class="v2t-dots" aria-hidden="true">${s.lines.map(r => `<i style="--c:${colour(r)}"></i>`).join('')}</span>`;
    const exits = st.exits.length, other = metro.entrances.map((x, i) => i).filter(i => metro.entrances[i][3] === si && i !== k);
    show(`<h2 id="v2t-t">Metro</h2><p class="v2t-sub">Estás en <b>${esc(st.name)}</b>${dots(st)} · ${tr(exits === 1 ? '{0} boca' : '{0} bocas', exits)}</p>
      <div class="v2t-grid"><div class="v2t-map"><canvas role="img" aria-label="Plano de la red de metro: haz clic en una estación para viajar"></canvas><small>Arrastra para mover · rueda: zoom · clic en una estación para viajar</small></div><div>
      <h3 style="margin-top:0">Líneas</h3><div class="v2t-lines" role="group" aria-label="Líneas">${metro.lines.map(l => `<button data-line="${l.ref}" style="--c:${l.colour}" aria-pressed="${l.ref === line}">${l.ref}</button>`).join('')}</div>
      <h3>${tr('Estaciones de la línea {0}', line === 'R' ? 'R' : line.slice(1))}</h3>
      <div class="v2t-list">${L.stops.map(i => { const s = metro.stations[i]; return `<button data-st="${i}"${i === si ? ' disabled' : ''}>${esc(s.name)}${dots(s)}${i === si ? tr(' · aquí') : ''}</button>`; }).join('')}</div>
      </div></div>
      <div class="v2t-foot"><button class="v2p-go" data-a="up" autofocus>Subir a la calle</button>${other.length ? `<button data-a="other">Salir por otra boca</button>` : ''}<button data-a="close">Cerrar (Esc)</button></div>`,
    q => {
      q('[data-line]').forEach(b => b.onclick = () => metroScreen(k, b.dataset.line));
      const travel = i => { const s = metro.stations[i], x = s.exits[Math.floor(Math.random() * s.exits.length)]; if (x) ride(...x); };
      const nm = netMap(q('.v2t-map canvas')[0], { S: metro.stations, L: metro.lines.map(l => ({ c: l.colour, stops: l.stops, on: l.ref === line })), here: si, pick: travel, cam });
      q('[data-st]').forEach(b => { b.onclick = () => travel(+b.dataset.st); b.onmouseenter = b.onfocus = () => nm.hover(+b.dataset.st); });
      q('[data-a=up]').forEach(b => b.onclick = () => ride(...outOf(MT, e)));
      q('[data-a=other]').forEach(b => b.onclick = () => ride(...outOf(MT, metro.entrances[other[Math.floor(Math.random() * other.length)]])));
      q('[data-a=close]').forEach(b => b.onclick = close);
    });
  }
  /** rail screen at a stop: the other stops of its line + the trains to the other map */
  function railScreen({ line, stop }) {
    open = { kind: 'rail' }; cam = {};
    const trips = T.trips.filter(t => t.from.map === map && (t.from.stop === stop.id || t.from.line === line.id));
    show(`<h2 id="v2t-t">${esc(line.name)}</h2><p class="v2t-sub">Parada <b>${esc(stop.name)}</b></p>
      <div class="v2t-grid"><div class="v2t-map"><canvas role="img" aria-label="Plano de la línea: haz clic en una parada para viajar"></canvas><small>Arrastra para mover · rueda: zoom · clic en una parada para viajar</small></div><div>
      <h3 style="margin-top:0">Destinos</h3><div class="v2t-list">${line.stops.map((s, i) => `<button data-s="${i}"${s === stop ? ' disabled' : ''}>${esc(s.name)}${s === stop ? tr(' · aquí') : ''}</button>`).join('')}</div>
      ${trips.length ? `<h3>Larga distancia</h3><div class="v2t-list">${trips.map((t, i) => `<button data-trip="${i}">${esc(t.name)}</button>`).join('')}</div>` : ''}
      </div></div>
      <div class="v2t-foot"><button data-a="close" autofocus>Cerrar (Esc)</button></div>`,
    q => {
      const travel = i => { const s = line.stops[i]; ride(s.x, s.z, s.h); };
      const nm = netMap(q('.v2t-map canvas')[0], { S: line.stops, L: [{ c: line.kind === 'tranvia' ? '#e0482f' : '#c8553d', stops: line.stops.map((s, i) => i) }], here: line.stops.indexOf(stop), pick: travel, cam });
      q('[data-s]').forEach(b => { b.onclick = () => travel(+b.dataset.s); b.onmouseenter = b.onfocus = () => nm.hover(+b.dataset.s); });
      q('[data-trip]').forEach(b => b.onclick = () => { const t = trips[+b.dataset.trip]; close(); go(t.to.map, t.to.spawn); });
      q('[data-a=close]').forEach(b => b.onclick = close);
    });
  }

  onAction('pause', () => { if (open) close(); });   // Esc: pause.js resumes, this closes the screen
  onAction('enter', () => { if (!open && !pause.paused && !wasIn && !play.inCar && near) railScreen(near); });   // F near a stop (wasIn: this F press got us out of a vehicle)

  return {
    get open() { return !!open; },
    /** per frame, after the sim: triggers and hints */
    update() {
      wasIn = play.inCar;
      if (open || play.inCar) { hint.hidden = true; return; }
      const p = play.player;
      if (metro) {
        const k = stairAt(MT, grid, p.x, p.z), under = (cells.ground.terrain(p.x, p.z)?.y ?? p.y) - p.y > 1.5;
        if (k >= 0 && under) { if (armed) { armed = false; metroScreen(k); return; } } else armed = true;
      }
      near = stopNear(rail, p.x, p.z);
      const mouth = metro && !near ? stairAt(MT, grid, p.x, p.z, 'mouth') : -1;
      const txt = play.tramNear?.() ? tr('F · subir al tranvía') : near ? `F · ${near.line.name}: ${near.stop.name}` : mouth >= 0 ? tr('Metro {0}: baja la escalera', metro.stations[metro.entrances[mouth][3]].name) : '';
      if (hint.textContent !== txt) hint.textContent = txt; hint.hidden = !txt;
    },
    T, metroScreen, railScreen, close,
  };
}
