// Map registry + selector. ONE map per page load (?map=madrid): switching reloads the page, so everything of the other city is unloaded for free.
// Chiclana keeps its data in /data/ (untouched); every other map lives in /data/<id>/. This module rewrites fetch('/data/…') to the active map's folder
// (so existing modules need no change) and must be imported before the first fetch.
import { ORIGIN } from './geo.js';

export const MAPS = {
  chiclana: {
    id: 'chiclana', name: 'Chiclana de la Frontera', base: '/data/', start: [-6.1469, 36.4193], sea: true,
    credit: 'Ortofoto PNOA © IGN (CC BY 4.0) · Edificios: © Dirección General del Catastro (CC BY 4.0) · Relieve: MDT05 © IGN/CNIG (CC BY 4.0), AWS Terrain Tiles · Límites y calles: © OpenStreetMap contributors (ODbL)',
  },
};
const id = 'chiclana';   // web build: only Chiclana is published
export const MAP = MAPS[id] || MAPS.chiclana;
export const IS_MADRID = MAP.id === 'madrid';
export const mapUrl = id => { const u = new URL(location.href); id === 'chiclana' ? u.searchParams.delete('map') : u.searchParams.set('map', id); return u.toString(); };

if (MAP.base !== '/data/') {
  const f0 = window.fetch.bind(window);
  window.fetch = (input, init) => (typeof input === 'string' && input.startsWith('/data/') && !input.startsWith(MAP.base)) ? f0(MAP.base + input.slice(6), init) : f0(input, init);
}

// ---- UI: title, credits, selector (bottom left; the HUD is top left, the minimap bottom right)
const ready = fn => document.readyState === 'loading' ? addEventListener('DOMContentLoaded', fn) : fn();
ready(() => {
  document.title = 'ATLAS · ' + MAP.name;
  const h1 = document.querySelector('#loader h1'); if (h1) h1.textContent = MAP.name;
  const cr = document.getElementById('credit'); if (cr) cr.textContent = MAP.credit;
  const box = document.createElement('div'); box.className = 'panel'; box.id = 'mapSel';
  box.style.cssText = 'left:14px;bottom:14px;z-index:15;font-size:13px;display:flex;gap:8px;align-items:center;padding:6px 10px';
  box.innerHTML = '<span style="color:#f2b84b;font-weight:600">Mapa</span>' + Object.values(MAPS).map(m => `<button data-m="${m.id}" style="background:${m.id === MAP.id ? '#f2b84b' : '#13202e'};color:${m.id === MAP.id ? '#111' : '#fff'};border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:3px 9px;cursor:pointer">${m.id === 'madrid' ? 'Madrid' : 'Chiclana'}</button>`).join('');
  box.addEventListener('click', e => { const m = e.target.dataset?.m; if (m && m !== MAP.id) location.href = mapUrl(m); });
  for (const ev of ['keydown', 'keyup']) box.addEventListener(ev, e => e.stopPropagation());
  document.body.appendChild(box);
});
window.__map = MAP; void ORIGIN;
