// Pause menu + pointer lock. Click on the canvas = capture the mouse (and resume); Esc / losing the lock / window blur = pause and
// release the mouse. While paused the game loop gets dt = 0 (frameClock), so the fixed 60 Hz step stops and no time piles up.
import { onAction, controls } from '../input/keys.js';
import { langSwitch, translate } from './i18n.js';

/** pure: real frame time -> game dt; 0 while paused and no catch-up jump on resume */
export function frameClock(max = 0.1) {
  let last = null;
  return (now, paused) => { const dt = paused || last === null ? 0 : Math.min(max, (now - last) / 1000); last = now; return dt; };
}

const NAMES = { Space: 'Espacio', Escape: 'Esc', Enter: 'Intro', ShiftLeft: 'Mayús', ShiftRight: 'Mayús dcha.', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
export const keyName = c => NAMES[c] || c.replace(/^Key|^Digit/, '');
const store = (k, v) => { try { v === undefined ? (v = localStorage.getItem(k)) : localStorage.setItem(k, v); } catch { return null; } return v; };

export class Pause {
  /** q: { presets, current } from data/quality.json; canvas: the game canvas */
  constructor(canvas, q) {
    const C = controls(), M = C.mouse;
    const s = +store('v2.sens'), inv = store('v2.invertY');
    if (s > 0) M.sensitivity = s; if (inv !== null) M.invertY = inv === '1';
    this.canvas = canvas; this.paused = false; this.locked = false; this.lostAt = -1e9;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./pause.css', import.meta.url); document.head.appendChild(link);
    const el = this.el = document.createElement('div'); el.className = 'v2p'; el.hidden = true;
    const opts = Object.entries(q.presets).map(([k, p]) => `<option value="${k}"${k === q.current ? ' selected' : ''}>${p.label || k}</option>`).join('');
    const rows = Object.entries(C.keys).map(([a, codes]) => `<tr><td>${[...new Set(codes.map(keyName))].join(' / ')}</td><td>${C.labels[a] || a}</td></tr>`).join('');
    el.innerHTML = `<div class="v2p-box" role="dialog" aria-modal="true" aria-labelledby="v2p-t">
      <h2 id="v2p-t">Pausa</h2>
      <div class="v2p-main">
        <button class="v2p-go" data-a="resume">Reanudar</button>
        <button data-a="map">Mapa (M)</button>
        <button data-a="help" aria-expanded="false">Controles</button>
        <button data-a="how">Cómo jugar</button>
        <div class="v2p-row"><span>Idioma</span></div>
        <label>Calidad <select data-a="q">${opts}</select></label>
        <label>Sensibilidad del ratón <input data-a="sens" type="range" min="0.0005" max="0.006" step="0.0001" value="${M.sensitivity}"></label>
        <label class="v2p-chk"><input data-a="inv" type="checkbox"${M.invertY ? ' checked' : ''}> Invertir eje Y</label>
        <label class="v2p-off">Volumen (reservado) <input type="range" disabled value="80"></label>
      </div>
      <div class="v2p-help" hidden>
        <table>${rows}
          <tr><td>Ratón</td><td>Girar la cámara (clic en la pantalla para capturarlo)</td></tr>
          <tr><td>Rueda</td><td>Acercar / alejar la cámara</td></tr>
          <tr><td>Mando</td><td>Stick izq. mover · stick der. cámara · A saltar/freno de mano · B correr · Y entrar/salir · RT/LT acelerar/frenar · Start pausa</td></tr>
          <tr><td>Trucos de prueba</td><td>Escribe ${C.cheats.map(c => `<b>${c.code}</b> (<span>${c.label}</span>)`).join(', ')}</td></tr>
          <tr><td>F3</td><td>Panel de rendimiento</td></tr>
        </table>
      </div>
    </div>`;
    el.querySelector('.v2p-row').append(langSwitch()); document.body.appendChild(translate(el));
    this.hint = document.createElement('div'); this.hint.className = 'v2p-hint'; this.hint.textContent = 'Clic para capturar el ratón · Esc pausa'; document.body.appendChild(translate(this.hint));
    const $ = a => el.querySelector(`[data-a="${a}"]`);
    $('resume').onclick = () => this.resume();
    $('how').onclick = () => this.onTutorial?.();   // ui/tutorial.js (boot.js)
    $('map').onclick = () => this.onMap?.();   // set by ui/radar.js (no radar data: the button does nothing)
    el.onclick = e => { if (e.target === el) this.resume(); };   // clicking the game behind the menu also resumes
    $('help').onclick = () => { const h = el.querySelector('.v2p-help'); h.hidden = !h.hidden; $('help').setAttribute('aria-expanded', String(!h.hidden)); };
    $('q').onchange = e => { store('v2.q', e.target.value); const u = new URL(location.href); u.searchParams.delete('q'); location.href = u; };   // presets are read at boot
    $('sens').oninput = e => { M.sensitivity = +e.target.value; store('v2.sens', e.target.value); };
    $('inv').onchange = e => { M.invertY = e.target.checked; store('v2.invertY', e.target.checked ? '1' : '0'); };

    canvas.addEventListener('click', () => { if (!this.locked) this.resume(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked; this.locked = document.pointerLockElement === canvas; this.hint.hidden = this.locked;
      if (was && !this.locked && !this.paused) { this.lostAt = performance.now(); this.pause(); }   // Esc while captured lands here
    });
    addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    onAction('pause', () => { if (performance.now() - this.lostAt < 400) return; this.paused ? this.resume() : this.pause(); });
  }
  /** Events panel (events/events.js): one switch per event of the current map, off by default, applied live */
  eventsPanel(ev) {
    if (!ev.list.length) return;
    const box = document.createElement('details'); box.className = 'v2p-ev'; box.innerHTML = '<summary>Eventos</summary>'; translate(box);
    for (const e of ev.list) {
      const l = document.createElement('label'), c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!ev.on[e.id] });
      c.dataset.event = e.id; c.onchange = () => ev.set(e.id, c.checked);
      l.append(c, ' ' + e.name); l.title = e.place.name + ' · ' + e.generates.join(', '); l.className = 'v2p-chk'; box.append(l);
    }
    this.el.querySelector('.v2p-main').insertBefore(box, this.el.querySelector('.v2p-off'));
  }
  /** bare: frozen without the menu (ui/tutorial.js shows its own screen) */
  pause(bare) { if (this.paused && !bare) return; this.paused = true; this.el.hidden = !!bare; this.hint.hidden = true; if (document.pointerLockElement) document.exitPointerLock(); if (!bare) this.el.querySelector('.v2p-go').focus(); }
  resume() {
    this.paused = false; this.el.hidden = true; this.hint.hidden = this.locked;
    // Chrome refuses the lock for ~1 s after Esc: ask again once that has passed (the click's user activation still holds), else one more click
    const ask = () => { try { return Promise.resolve(this.canvas.requestPointerLock()); } catch (e) { return Promise.reject(e); } };
    ask().catch(() => setTimeout(() => { if (!this.paused && !this.locked) ask().catch(() => {}); }, 1100));
  }
}
