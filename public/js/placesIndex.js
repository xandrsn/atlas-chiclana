// "Índice de sitios": side panel (key I / button) listing places the player can travel to; click = teleport.
// Sources merged at runtime (all optional, each fetched with try/catch; re-fetched when the panel opens / on ↻):
//   data/places/index.json  pipeline output. Array (or {places:[...]}) of
//        { name, cat?: one of CATS | kind?, x,z | lon,lat, detailed?: bool, status?: 'done'|'implemented'|..., note? }
//   data/poi.json (monuments, parks, bridges...), data/plazas.json, data/venues.json, data/venue_specs.json,
//   plus built-in Plaza Mayor / Torre del Reloj / Iglesia Mayor entries.
import { toLocal } from './geo.js';

const CATS = [['Monumentos', '🗿'], ['Parques', '🌳'], ['Plazas', '⛲'], ['Edificios', '🏛️'], ['Iglesias', '⛪'], ['Colegios', '🏫'], ['Bares y restaurantes', '🍽️'], ['Campos de fútbol', '⚽'], ['Fútbol sala', '🥅'], ['Pádel', '🎾'], ['Tenis', '🎾'], ['Baloncesto', '🏀'], ['Playas', '🏖️'], ['Puentes', '🌉'], ['Gasolineras', '⛽'], ['Otros', '📍']];
const ICON = Object.fromEntries(CATS);
const LS = 'chiclanaPlacesIndex', MAXROWS = 200;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = d => d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(d < 10000 ? 1 : 0) + ' km';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } };
const lsSet = o => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };
const j = async (u, nocache) => { try { const r = await fetch(u, nocache ? { cache: 'no-cache' } : undefined); return r.ok ? await r.json() : null; } catch { return null; } };

// category from the various source vocabularies
const POI_CAT = { religious: 'Iglesias', monument: 'Monumentos', statue: 'Monumentos', fountain: 'Monumentos', heritage: 'Monumentos', archaeology: 'Monumentos', fortification: 'Monumentos', museum: 'Edificios', park: 'Parques', plaza: 'Plazas', bridge: 'Puentes', landmark: 'Otros' };
const VENUE_CAT = { bar: 'Bares y restaurantes', restaurante: 'Bares y restaurantes', 'cafetería': 'Bares y restaurantes', 'comida rápida': 'Bares y restaurantes', 'heladería': 'Bares y restaurantes', discoteca: 'Bares y restaurantes', bodega: 'Bares y restaurantes',
  colegio: 'Colegios', instituto: 'Colegios', iglesia: 'Iglesias', ayuntamiento: 'Edificios', teatro: 'Edificios', mercado: 'Edificios', biblioteca: 'Edificios', correos: 'Edificios', hospital: 'Edificios', juzgado: 'Edificios', cine: 'Edificios', 'centro de salud': 'Edificios', 'policía': 'Edificios', 'centro de arte': 'Edificios', museo: 'Edificios', plaza: 'Plazas', monumento: 'Monumentos' };
const CATSET = new Map(CATS.map(c => [norm(c[0]), c[0]]));
function catOf(name, c) { if (/^(playa|cala)\b/i.test(name)) return 'Playas'; return c; }
function catFromPlace(p) {
  const k = norm(p.cat || p.category || p.kind || p.type || '');
  return CATSET.get(k) || POI_CAT[k] || VENUE_CAT[k] || (/iglesia|ermita|capilla|parroquia/.test(k) ? 'Iglesias' : /plaza/.test(k) ? 'Plazas' : /parque|jardin/.test(k) ? 'Parques' : /puente/.test(k) ? 'Puentes' : /playa/.test(k) ? 'Playas' : /colegio|escuela|instituto/.test(k) ? 'Colegios' : /bar|restaur|cafe/.test(k) ? 'Bares y restaurantes' : /monument|estatua|fuente/.test(k) ? 'Monumentos' : /edific|ayunt|teatro|museo|mercado/.test(k) ? 'Edificios' : 'Otros');
}

const BUILTIN = [   // researched Plaza Mayor area (data/plaza_mayor_spec.json); positions in local metres
  { name: 'Plaza Mayor', cat: 'Plazas', x: -3664.2, z: -1839.8, detailed: true, sub: 'Plaza' },
  { name: 'Torre del Reloj (Arquillo del Reloj)', cat: 'Monumentos', x: -3637.2, z: -1863.6, detailed: true, sub: 'Torre · 1759-67' },
  { name: 'Iglesia Mayor San Juan Bautista', cat: 'Iglesias', x: -3601.2, z: -1823.7, detailed: true, sub: 'Iglesia' },
  { name: 'Ayuntamiento de Chiclana', cat: 'Edificios', x: -3917.6, z: -2012.9, sub: 'Calle Constitución 1' },
];
const DETAILED_NAMES = ['venus al sol', 'castillo de sancti petri', 'castillo de santi petri'];

export class PlacesIndex {
  /** opts: { getPos: () => {x,z}, travel: (x,z,label) => void, onOpen: () => void (release held keys) } */
  constructor(opts) {
    this.o = opts; this.items = []; this.loaded = false; this.loading = null; this.t0 = 0; this.open = false;
    const st = lsGet(); this.cat = st.cat || ''; this.sort = st.sort || 'dist'; this.closeOnTravel = st.close !== false;
    this.q = ''; this.sel = 0; this.view = [];
    this.build();
  }
  save() { lsSet({ cat: this.cat, sort: this.sort, close: this.closeOnTravel }); }

  // ------------------------------------------------------------ data
  async load(force) {
    if (this.loading) return this.loading;
    if (this.loaded && !force) { if (Date.now() - this.t0 > 30000) this.reloadPlaces(); return; }
    return this.loading = (async () => {
      const [places, poi, plazas, venues, specs, football, courts] = await Promise.all([j('/data/places/index.json', true), j('/data/poi.json'), j('/data/plazas.json'), j('/data/venues.json'), j('/data/venue_specs.json'), j('/data/football.json'), j('/data/courts.json')]);
      this.src = { poi, plazas, venues, specs, football, courts }; this.places = places; this.merge(); this.loaded = true; this.t0 = Date.now(); this.loading = null; this.render();
    })();
  }
  async reloadPlaces() { this.t0 = Date.now(); const p = await j('/data/places/index.json', true); if (JSON.stringify(p) !== JSON.stringify(this.places)) { this.places = p; this.merge(); this.render(); } }
  merge() {
    const { poi, plazas, venues, specs, football, courts } = this.src, out = [], seen = new Map();   // normalised name -> [{x,z}]
    const specNames = new Set((specs || []).map(s => norm(s.name)));
    const add = (name, cat, x, z, extra = {}) => {
      if (!name || !isFinite(x) || !isFinite(z)) return;
      const n = norm(name); if (!n) return;
      const prev = seen.get(n); if (prev && prev.some(p => Math.hypot(p[0] - x, p[1] - z) < 80)) return;   // same place from another source
      (seen.get(n) || seen.set(n, []).get(n)).push([x, z]);
      const detailed = !!extra.detailed || specNames.has(n) || DETAILED_NAMES.some(d => n.includes(d));
      out.push({ name, k: n, cat: catOf(name, cat), x, z, detailed, sub: extra.sub || '', low: !!extra.low });
    };
    const xz = p => (isFinite(p.x) && isFinite(p.z)) ? [p.x, p.z] : (isFinite(p.lon) && isFinite(p.lat)) ? toLocal(p.lon, p.lat) : [NaN, NaN];
    const arr = Array.isArray(this.places) ? this.places : Array.isArray(this.places?.places) ? this.places.places : [];
    for (const p of arr) { const [x, z] = xz(p); add(p.name || p.n, catFromPlace(p), x, z, { detailed: p.detailed === true || /^(done|implemented|detailed|hecho)/i.test(p.status || ''), sub: p.sub || p.note || p.desc || '' }); }
    for (const f of football || []) add(f.title, f.kind === 'sala' || f.kind === 'school' ? 'Fútbol sala' : 'Campos de fútbol', f.ox, f.oz, { detailed: true, sub: ({ stadium: 'Estadio', 11: 'Fútbol 11', 7: 'Fútbol 7', sala: 'Fútbol sala', school: 'Pista de colegio' })[f.kind] + ' · ' + Math.round(f.L) + '×' + Math.round(f.W) + ' m' });
    const SPN = { padel: 'Pádel', tennis: 'Tenis', basketball: 'Baloncesto' };
    for (const c of courts?.clusters || []) { const top = Object.entries(c.counts).sort((a, b) => b[1] - a[1])[0][0]; add(c.title, SPN[top], c.x, c.z, { detailed: true, sub: Object.entries(c.counts).map(([k, n]) => SPN[k] + ' ×' + n).join(' · ') }); }
    for (const b of BUILTIN) add(b.name, b.cat, b.x, b.z, b);
    for (const s of specs || []) add(s.name, 'Bares y restaurantes', s.anchor?.x, s.anchor?.z, { detailed: true, sub: 'Local' });
    for (const p of plazas || []) add(p.name, 'Plazas', p.c?.[0], p.c?.[1], { sub: p.area ? Math.round(p.area) + ' m²' : '' });
    for (const p of poi || []) add(p.name, POI_CAT[p.cat] || 'Otros', p.x, p.z, { sub: p.kind || '' });
    for (const v of venues || []) { const c = VENUE_CAT[v.t] || 'Otros'; add(v.n, c, v.x, v.z, { sub: v.t + (v.a ? ' · ' + v.a : ''), low: ['Bares y restaurantes', 'Colegios', 'Otros'].includes(c) }); }
    this.items = out;
  }

  // ------------------------------------------------------------ ui
  build() {
    const css = document.createElement('style');
    css.textContent = `
#pxBtn{position:fixed;right:12px;top:112px;z-index:4;cursor:pointer;color:#e8f0f7;font:inherit;padding:6px 10px}
#px{position:fixed;right:12px;top:12px;bottom:12px;width:min(350px,calc(100vw - 24px));z-index:6;display:none;flex-direction:column;gap:8px;box-sizing:border-box}
#px.on{display:flex}
#px .hd{display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px}#px .hd span{flex:1}
#px button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);border-radius:6px;color:#e8f0f7;font:inherit;font-size:12px;padding:3px 8px;cursor:pointer}
#px button:hover{background:rgba(255,255,255,.2)}
#px input[type=search]{width:100%;box-sizing:border-box;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;padding:7px 9px;font:inherit;font-size:14px}
#px .chips{display:flex;flex-wrap:wrap;gap:4px}
#px .chips button{padding:2px 7px;border-radius:12px}#px .chips button.on{background:#f2b84b;color:#14202c;border-color:#f2b84b;font-weight:600}
#px .opts{display:flex;justify-content:space-between;align-items:center;color:#b7c7d6;font-size:12px;gap:6px}
#px .opts label{display:flex;align-items:center;gap:4px;cursor:pointer}
#pxList{flex:1;overflow:auto;margin:0 -4px;min-height:0;overscroll-behavior:contain}
#pxList .r{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:6px;cursor:pointer}
#pxList .r:hover,#pxList .r.sel{background:rgba(255,255,255,.16)}
#pxList .ic{font-size:18px;width:24px;text-align:center}
#pxList .tx{flex:1;min-width:0}#pxList .nm{display:flex;align-items:center;font-size:13px}#pxList .nm b{font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#pxList .bd{flex:none}
#pxList .sb{color:#9fb4c6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pxList .di{color:#b7c7d6;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
#pxList .bd{background:#2f8f5b;color:#fff;border-radius:8px;font-size:10px;padding:0 5px;margin-left:5px;vertical-align:1px}
#pxList .em{color:#9fb4c6;padding:10px 6px;font-size:12px}
@media (max-width:600px){#px{top:auto;height:70vh;bottom:6px;right:6px;width:calc(100vw - 12px)}#pxBtn{top:auto;bottom:210px}}`;
    document.head.appendChild(css);
    const btn = this.btn = document.createElement('button'); btn.id = 'pxBtn'; btn.className = 'panel'; btn.type = 'button'; btn.textContent = '📍 Sitios (I)'; document.body.appendChild(btn);
    const el = this.el = document.createElement('div'); el.id = 'px'; el.className = 'panel';
    el.innerHTML = `<div class="hd"><span>📍 Índice de sitios</span><button type="button" data-a="ref" title="Recargar lista">↻</button><button type="button" data-a="x" title="Cerrar (Esc)">✕</button></div>
<input type="search" placeholder="Buscar sitio…" autocomplete="off" spellcheck="false">
<div class="chips"></div>
<div class="opts"><button type="button" data-a="sort"></button><label><input type="checkbox" data-a="close"> cerrar al viajar</label></div>
<div id="pxList" tabindex="-1"></div>`;
    document.body.appendChild(el);
    this.input = el.querySelector('input[type=search]'); this.chips = el.querySelector('.chips'); this.list = el.querySelector('#pxList');
    el.querySelector('[data-a=close]').checked = this.closeOnTravel;
    btn.addEventListener('click', () => this.toggle());
    // everything typed/scrolled/dragged inside the panel stays out of the game
    for (const t of ['keydown', 'keyup', 'wheel', 'pointerdown', 'mousedown', 'touchstart']) el.addEventListener(t, e => e.stopPropagation(), { passive: true });
    el.addEventListener('keydown', e => this.onKey(e));
    this.input.addEventListener('input', () => { this.q = this.input.value; this.sel = 0; this.render(); });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a],[data-c],.r'); if (!b) return;
      if (b.dataset.a === 'x') this.toggle(false);
      else if (b.dataset.a === 'ref') this.load(true);
      else if (b.dataset.a === 'sort') { this.sort = this.sort === 'dist' ? 'az' : 'dist'; this.save(); this.render(); }
      else if (b.dataset.a === 'close') { this.closeOnTravel = b.checked; this.save(); }
      else if (b.dataset.c !== undefined) { this.cat = b.dataset.c; this.sel = 0; this.save(); this.render(); }
      else if (b.classList.contains('r')) this.go(this.view[+b.dataset.i]);
    });
    addEventListener('keydown', e => {   // global toggle; ignored while typing elsewhere
      if (e.code !== 'KeyI' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t !== this.input) return;
      if (t === this.input) return;      // typing an "i" in the search box
      this.toggle();
    });
    this.list.addEventListener('pointerdown', () => { this.down = true; }); addEventListener('pointerup', () => { this.down = false; });
    this.timer = setInterval(() => this.tick(), 700);
  }
  tick() {   // live distances; full re-sort only when the player moved noticeably (never while a click is in progress)
    if (!this.open || this.down || !this.loaded) return;
    const pos = this.o.getPos?.(); if (!pos) return;
    if (this.sort === 'dist' && (!this.lastPos || Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z) > 60)) return this.render(true);
    const di = this.list.querySelectorAll('.r .di');
    this.view.forEach((it, i) => { if (di[i]) di[i].textContent = fmt(Math.hypot(it.x - pos.x, it.z - pos.z)); });
  }
  toggle(on) {
    on = on === undefined ? !this.open : on; if (on === this.open) return; this.open = on;
    this.el.classList.toggle('on', on); this.btn.style.display = on ? 'none' : '';
    if (on) { this.o.onOpen?.(); this.load(); this.render(); setTimeout(() => this.input.focus(), 0); }
    else { this.input.blur(); document.activeElement?.blur?.(); }
  }
  onKey(e) {
    if (e.code === 'Escape') { e.preventDefault(); this.toggle(false); }
    else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); const n = this.view.length; if (n) { this.sel = (this.sel + (e.code === 'ArrowDown' ? 1 : -1) + n) % n; this.render(true); this.list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); } }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (e.target.tagName === 'BUTTON') return; e.preventDefault(); this.go(this.view[this.sel]); }
  }
  go(it) {
    if (!it) return;
    this.o.travel(it.x, it.z, it.name);
    if (this.closeOnTravel) this.toggle(false);
  }
  render(soft) {
    if (!this.open) return;
    const pos = this.o.getPos?.() || { x: 0, z: 0 }, q = norm(this.q), words = q.split(' ').filter(Boolean);
    const counts = new Map();
    let rows = [];
    for (const it of this.items) {
      if (words.length && !words.every(w => it.k.includes(w))) continue;
      counts.set(it.cat, (counts.get(it.cat) || 0) + 1);
      if (this.cat && it.cat !== this.cat) continue;
      if (!this.cat && !words.length && it.low && !it.detailed) continue;   // default view: curated (bars, schools, shops only via filter/search)
      rows.push(it);
    }
    this.lastPos = { x: pos.x, z: pos.z };
    for (const it of rows) it.d = Math.hypot(it.x - pos.x, it.z - pos.z);
    rows.sort(this.sort === 'dist' ? (a, b) => a.d - b.d : (a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
    const total = rows.length; this.view = rows = rows.slice(0, MAXROWS);
    if (this.sel >= rows.length) this.sel = Math.max(0, rows.length - 1);
    if (!soft || !this.chips.firstChild) {
      this.chips.innerHTML = `<button type="button" data-c="" class="${this.cat ? '' : 'on'}">Todos</button>` + CATS.map(([c, ic]) => `<button type="button" data-c="${c}" class="${this.cat === c ? 'on' : ''}"${counts.get(c) ? '' : ' style="opacity:.45"'}>${ic} ${c} ${counts.get(c) || 0}</button>`).join('');
      this.el.querySelector('[data-a=sort]').textContent = this.sort === 'dist' ? '↕ Más cerca primero' : '↕ A–Z';
    }
    this.list.innerHTML = rows.map((it, i) => `<div class="r${i === this.sel ? ' sel' : ''}" data-i="${i}"><span class="ic">${ICON[it.cat] || '📍'}</span><span class="tx"><div class="nm"><b>${esc(it.name)}</b>${it.detailed ? '<span class="bd">Detallado</span>' : ''}</div><div class="sb">${esc(it.cat)}${it.sub ? ' · ' + esc(it.sub) : ''}</div></span><span class="di">${fmt(it.d)}</span></div>`).join('')
      + (total > rows.length ? `<div class="em">Mostrando ${rows.length} de ${total}: afina la búsqueda.</div>` : '')
      + (!rows.length ? `<div class="em">${this.loaded ? 'Sin resultados.' : 'Cargando…'}</div>` : '')
      + (!this.cat && !words.length ? `<div class="em">Bares, restaurantes, colegios y comercios: elige su filtro o escribe su nombre.</div>` : '');
  }
}
