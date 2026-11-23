// The only place v2 reads the keyboard (and the mouse / gamepad). Bindings come from data/controls.json (setControls).
// Held actions: actions() / drive(). Edge actions (enter, camera, pause, gamepad buttons): onAction(). Mouse look: takeLook().
const on = (t, f, o) => globalThis.addEventListener?.(t, f, o);   // no-op under node (the tests import the pure mappers)
let C = null;
const down = new Set(), handlers = new Map(), look = { dx: 0, dy: 0, wheel: 0 };
let typed = '', padPrev = [], locked = () => false;

/** pure: held keys (+ gamepad snapshot) -> movement/vehicle actions. pad = { axes: [], buttons: [{pressed, value}] } | null */
export function mapActions(cfg, held, pad) {
  const k = name => (cfg.keys[name] || []).some(c => held.has(c)) ? 1 : 0, G = cfg.gamepad, dz = v => Math.abs(v) < G.deadzone ? 0 : (v - Math.sign(v) * G.deadzone) / (1 - G.deadzone);
  const b = name => { const x = pad?.buttons[G.buttons[name]]; return x ? x.value ?? +x.pressed : 0; };
  const ax = pad ? dz(pad.axes[0] || 0) : 0, ay = pad ? dz(pad.axes[1] || 0) : 0;
  const mx = clamp(k('right') - k('left') + ax), my = clamp(k('forward') - k('back') - ay);
  return {
    mx, my, run: k('run') || b('run') > 0.5 ? 1 : 0, jump: k('jump') || b('jump') > 0.5 ? 1 : 0,
    throttle: clamp(k('forward') - k('back') + b('throttle') - b('brake')), steer: clamp(k('left') - k('right') - ax),
    brake: k('jump') || b('jump') > 0.5 ? 1 : 0,
    blade: k('bladeUp') - k('bladeDown'),
    lookX: pad ? dz(pad.axes[2] || 0) : 0, lookY: pad ? dz(pad.axes[3] || 0) : 0,
  };
}
const clamp = v => Math.max(-1, Math.min(1, v));

/** pure: rolling buffer of typed letters; returns [buffer, matched cheat | null] */
export function feedCheat(buf, ch, cheats) {
  buf = (buf + ch).slice(-24);
  const hit = cheats.find(c => buf.endsWith(c.code));
  return [hit ? '' : buf, hit || null];
}

export function setControls(cfg, isLocked) { C = cfg; if (isLocked) locked = isLocked; }
export const controls = () => C;
const pad = () => { const p = globalThis.navigator?.getGamepads?.(); if (p) for (const g of p) if (g && g.connected) return g; return null; };
let snap = null;
/** call once per frame: polls the gamepad (edge buttons fire onAction) and returns the held actions */
export function poll() {
  const g = pad(); snap = mapActions(C, down, g);
  if (g) {
    for (const [name, i] of Object.entries(C.gamepad.buttons)) { const p = !!g.buttons[i]?.pressed; if (p && !padPrev[i]) fire(name); padPrev[i] = p; }
  }
  return snap;
}
export const actions = () => snap || mapActions(C, down, null);
export const drive = () => { const a = actions(); return { throttle: a.throttle, steer: a.steer, brake: a.brake }; };
/** consumes accumulated mouse motion (pixels) + wheel; gamepad right stick is in actions().lookX/Y */
export function takeLook() { const r = { ...look }; look.dx = look.dy = look.wheel = 0; return r; }
export function onAction(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); }
const fire = name => (handlers.get(name) || []).forEach(f => f());
/** kept for code that binds a raw key (F3 panel) */
export const onKey = (code, fn) => on('keydown', e => { if (e.code === code) { e.preventDefault(); fn(); } });

on('keydown', e => {
  if (!C) return;
  if (!e.repeat) {
    for (const [name, codes] of Object.entries(C.keys)) if (codes.includes(e.code) && ['enter', 'camera', 'pause', 'flip'].includes(name)) { e.preventDefault(); fire(name); }
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) { let hit; [typed, hit] = feedCheat(typed, e.key.toUpperCase(), C.cheats); if (hit) fire('cheat:' + hit.code); }
  }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  down.add(e.code);
});
on('keyup', e => down.delete(e.code));
on('blur', () => down.clear());
// Chrome sends one huge movementX/Y right after the lock is taken (and some mice spike): skip 60 ms after a lock change, clamp per event.
// A lock change (Esc, pause, resume) also drops held keys and pending look, so nothing keeps turning / walking after the menu.
let lockT = -1e9; const clampPx = v => Math.max(-200, Math.min(200, v || 0));
globalThis.document?.addEventListener('pointerlockchange', () => { lockT = performance.now(); look.dx = look.dy = 0; down.clear(); });
on('mousemove', e => { if (locked() && performance.now() - lockT > 60) { look.dx += clampPx(e.movementX); look.dy += clampPx(e.movementY); } });
on('wheel', e => { if (C) look.wheel += Math.sign(e.deltaY); }, { passive: true });
