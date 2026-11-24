// How to play: shown once, after the first load (localStorage v2.tutorial), and again from the pause menu. Keys come from data/controls.json.
import { controls, onAction } from '../input/keys.js';
import { langSwitch, translate } from './i18n.js';
import { keyName } from './pause.js';

const KEY = 'v2.tutorial';
let open = false, shut = null;
onAction('pause', () => { if (open) shut(); });   // gamepad Start
export function tutorialSeen() { try { return !!localStorage.getItem(KEY); } catch { return true; } }   // no storage: it would come back on every load

/** pause: ui/pause.js; the game stays frozen while this is open and resumes on "Empezar" */
export function showTutorial(pause) {
  if (open) return; open = true;
  const K = controls().keys, k = (...a) => a.map(x => `<kbd>${keyName(K[x]?.[0] || x)}</kbd>`).join(' '), WASD = k('forward', 'left', 'back', 'right');
  const parts = {
    'A pie': [[WASD, 'caminar'], [k('run'), 'correr'], [k('jump'), 'saltar'], [k('Ratón'), 'mirar alrededor (antes, clic en la pantalla)']],
    'Al volante': [[k('enter'), 'subir al vehículo más cercano, y bajar'], [WASD, 'acelerar, frenar y girar'], [k('jump'), 'freno de mano'], [k('flip'), 'ponerlo derecho si ha volcado']],
    'En helicóptero': [[k('H', 'H', 'H'), 'escríbelo y aparece uno delante'], [k('jump'), 'ganar altura'], [k('run'), 'perder altura'], [WASD, 'avanzar, frenar y girar']],
    'Y además': [[k('KeyM'), 'mapa'], [k('KeyT'), 'una hora más: cambian el sol y las sombras'], [k('KeyN'), 'cambiar el modelo de tu coche'], [k('pause'), 'pausa: calidad, idioma, eventos, controles y esta ayuda']],
  };
  const el = document.createElement('div'); el.className = 'v2p v2tut';
  el.innerHTML = `<div class="v2p-box" role="dialog" aria-modal="true" aria-labelledby="v2tut-t">
    <div class="v2tut-head"><h2 id="v2tut-t">Te damos la bienvenida</h2></div>
    <p>Chiclana de la Frontera en 3D, hecha con datos públicos. Muévete a tu aire: a pie, en coche o en helicóptero.</p>
    <div class="v2tut-grid">${Object.entries(parts).map(([h, r]) => `<section><h3>${h}</h3><dl>${r.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></section>`).join('')}</div>
    <button class="v2p-go">Empezar</button></div>`;
  el.querySelector('.v2tut-head').append(langSwitch());
  document.body.append(translate(el)); pause.pause(true);
  const go = el.querySelector('.v2p-go'); go.focus();
  const close = () => { open = false; removeEventListener('keydown', key, true); el.remove(); try { localStorage.setItem(KEY, '1'); } catch {} pause.resume(); };
  const key = e => {   // the game must not hear the keys pressed here; Tab stays inside the dialog
    if (e.code === 'Escape') { e.preventDefault(); close(); }
    else if (e.code === 'Tab') { const f = [...el.querySelectorAll('button')], i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); }
    e.stopImmediatePropagation();
  };
  addEventListener('keydown', key, true); go.onclick = shut = close;
}
