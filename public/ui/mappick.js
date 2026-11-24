// Map + spawn picker, in the pause menu and on the loading screen: changing map or spawn reloads with ?map=<id>&spawn=<id>
// (one map in memory; other URL params kept, see boot.js go). Spawns: data/cells/<map>/index.json "spawns".
// e.g. http://localhost:3031/v2/?map=madrid&spawn=sol
import { t, translate } from './i18n.js';

/** maps: data/maps.json · map / spawn: the current ids · get(url) -> json · go(map, spawn): reload there. -> a <div> to append */
export function mapPicker({ maps, map, spawn, get, go }) {
  const el = document.createElement('div'); el.className = 'v2-pick';
  const sel = (label, key) => { const l = document.createElement('label'), s = document.createElement('select'); l.append(label + ' ', s); s.dataset.p = key; el.append(l); return s; };
  const mapSel = sel('Mapa', 'map'), spSel = sel('Aparecer en', 'spawn'), btn = document.createElement('button'), idx = {};
  for (const [k, m] of Object.entries(maps.maps)) mapSel.add(new Option(m.name || k, k, false, k === map));
  btn.type = 'button'; btn.dataset.p = 'go'; btn.textContent = 'Ir'; el.append(btn);
  const fill = async m => {
    spSel.disabled = btn.disabled = true; spSel.length = 0;
    try { const i = idx[m] ??= await get(`/data/cells/${m}/index.json`), want = m === map ? spawn : i.defaultSpawn;
      for (const [k, s] of Object.entries(i.spawns)) spSel.add(new Option(s.name || k, k, false, k === want));
      spSel.disabled = btn.disabled = false; } catch { spSel.add(new Option(t('(no disponible)'), '')); }
  };
  mapSel.onchange = () => fill(mapSel.value);
  btn.onclick = () => { if (spSel.value) go(mapSel.value, spSel.value); };
  if (Object.keys(maps.maps).length < 2) mapSel.parentElement.hidden = true;   // one playable map (data/maps.json enabled): no map choice
  fill(map);
  return translate(el);
}
