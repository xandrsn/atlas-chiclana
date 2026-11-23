import * as THREE from 'three';
import { Car, Heli, VEHICLES } from './vehicles.js';
import { Walker } from './walker.js';

// Multiplayer client (protocol v2, see server/lobby.mjs).
//  - sends the local pose as an 18-byte binary message, only while it changes (20 Hz moving, 1 Hz keep-alive standing still);
//  - keeps a clock offset to the server (ping/pong, best round trip wins) and draws remote players on the SERVER timeline, ~2 ticks in the past:
//    interpolation between the two surrounding snapshots, bounded extrapolation (<= 250 ms, from the last measured velocity) when a packet is late;
//  - reconnects by itself with exponential back-off; shows the roster (name, colour, vehicle, distance) and the ping;
//  - collisions against remote players are resolved locally on both sides (no server authority: meant for playing with friends).
const SEND_MOVING = 50, SEND_IDLE = 1000, EXTRAP_MAX = 0.25;
const RAD = { car: 2.1, heli: 3.4, walker: 0.45 }, MODES = ['car', 'heli', 'walker'], ICON = { car: '🚗', heli: '🚁', walker: '🚶' }, iconOf = (mode, veh) => mode === 'car' ? VEHICLES[veh]?.icon || ICON.car : ICON[mode] || '';

export function tint(group, color, from) {   // recolour materials whose ORIGINAL colour is in 'from' (original remembered so it can be re-tinted)
  const c = new THREE.Color(color);
  group.traverse(o => { const m = o.isMesh && o.material; if (!m?.color) return; const b = m.userData.base ??= m.color.getHex(); if (from.includes(b)) m.color.copy(c); });
}
export const BASE = { car: [0xc8321e], heli: [0xd9d9d9], walker: [0x2f6fb0] };
/** passenger seat in a vehicle's local frame: [x, y, z, scale]. A small walker figure sits there (unverified look, tune by eye). */
const seatOf = (mode, veh) => mode === 'heli' ? [0.42, 0.3, -0.5, 0.55] : VEHICLES[veh]?.bike ? [0, 0.35, 0.5, 0.8] : [0.4, 0.1, -0.05, 0.6];
function seat(fig, parent, mode, veh, color) {
  const [x, y, z, k] = seatOf(mode, veh); if (fig.parent !== parent) { fig.removeFromParent(); parent.add(fig); }
  fig.position.set(x, y, z); fig.scale.setScalar(k); if (fig.userData.col !== color) { fig.userData.col = color; tint(fig, color, BASE.walker); } fig.visible = true;
}
function nameTag(text, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48; const g = cv.getContext('2d');
  g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(244, g.measureText(text).width + 22); g.fillStyle = 'rgba(8,16,26,.72)'; g.beginPath(); g.roundRect((256 - w) / 2, 6, w, 36, 10); g.fill();
  g.fillStyle = color; g.fillRect((256 - w) / 2 + 6, 20, 5, 8); g.fillStyle = '#fff'; g.fillText(text, 132, 25);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(4.8, 0.9, 1); s.renderOrder = 20; return s;
}
function bubble(text) {   // speech bubble sprite: word-wrapped, max 4 lines
  const cv = document.createElement('canvas'), g = cv.getContext('2d'); cv.width = 512; cv.height = 160; g.font = '600 26px system-ui, sans-serif';
  const lines = []; let cur = ''; for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > 460 && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].slice(0, 30) + '…'; }
  const h = lines.length * 32 + 20, w = Math.min(500, Math.max(...lines.map(l => g.measureText(l).width)) + 28), y0 = 160 - h - 6;
  g.fillStyle = 'rgba(255,255,255,.93)'; g.beginPath(); g.roundRect((512 - w) / 2, y0, w, h, 12); g.fill();
  g.fillStyle = '#111'; g.font = '600 26px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; lines.forEach((l, i) => g.fillText(l, 256, y0 + 26 + i * 32));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(6.4, 2, 1); sp.center.set(0.5, 0); sp.renderOrder = 21; return sp;
}
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const _v = new THREE.Vector3();

export class Net {
  constructor({ scene, world, getActive, setLocalColor }) {
    this.scene = scene; this.world = world; this.getActive = getActive; this.setLocalColor = setLocalColor;
    this.ws = null; this.id = 0; this.remotes = new Map(); this.lastSend = 0; this.sent = null; this.stillSent = 0; this.wantOnline = false; this.retry = 0; this.retryT = null;
    this.offset = 0; this.bestRtt = 1e9; this.rtt = 0; this.jitter = 0; this.pingT = 0; this.tick = 50; this.out = new DataView(new ArrayBuffer(18));
    this.stats = { tx: 0, rx: 0, txMsgs: 0, rxMsgs: 0 };
    this.name = 'Jugador'; this.color = '#e0482f'; this.rideId = 0; this.localPax = 0; this.figs = new Map(); this.localFig = null; this.onDismount = null;
    try { this.name = localStorage.getItem('chiclana.name') || this.name; this.color = localStorage.getItem('chiclana.color') || this.color; } catch {}
    this.ui(); this.chatUi();
  }
  ui() {
    const el = document.createElement('div'); el.id = 'online'; el.className = 'panel';
    el.style.cssText = 'right:12px;top:96px;width:236px;font-size:12px';
    el.innerHTML = '<div style="font-weight:600;color:#f2b84b;margin-bottom:6px">Multijugador <span id="onlineN" style="color:#9fb2c4;font-weight:400"></span></div>' +
      '<div style="display:flex;gap:6px"><input id="onName" maxlength="16" placeholder="Nombre" autocomplete="off" spellcheck="false" style="flex:1;min-width:0;box-sizing:border-box;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);border-radius:6px;color:#fff;padding:5px 7px;font:inherit">' +
      '<input id="onColor" type="color" style="width:34px;height:28px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:none"></div>' +
      '<button id="onBtn" style="margin-top:6px;width:100%;padding:5px;border-radius:6px;border:0;background:#f2b84b;color:#111;font:600 12px system-ui;cursor:pointer">Conectar</button>' +
      '<div id="onMsg" style="margin-top:5px;color:#9fb2c4;min-height:1.3em"></div><div id="onList" style="margin-top:2px;max-height:150px;overflow:auto"></div>';
    document.body.appendChild(el);
    this.el = { name: el.querySelector('#onName'), color: el.querySelector('#onColor'), btn: el.querySelector('#onBtn'), msg: el.querySelector('#onMsg'), n: el.querySelector('#onlineN'), list: el.querySelector('#onList') };
    this.el.name.value = this.name; this.el.color.value = this.color;
    for (const i of [this.el.name, this.el.color]) for (const ev of ['keydown', 'keyup']) i.addEventListener(ev, e => e.stopPropagation());
    this.el.btn.onclick = () => this.wantOnline ? this.leave() : this.join();
    let metaT = 0; this.el.color.oninput = () => { this.color = this.el.color.value; this.setLocalColor?.(this.color); clearTimeout(metaT); metaT = setTimeout(() => this.json({ t: 'meta', name: this.name, color: this.color }), 400); };
    this.setLocalColor?.(this.color);
  }
  /** proximity chat: Y opens the box, Enter sends, Esc cancels. The server only relays to players within its radius (60 m); nothing is stored. */
  chatUi() {
    const log = this.chatLog = document.createElement('div'); log.className = 'panel';
    log.style.cssText = 'left:14px;bottom:62px;width:320px;max-height:150px;overflow:hidden;font-size:13px;display:none;pointer-events:none;z-index:15';
    const inp = this.chatIn = document.createElement('input'); inp.maxLength = 200; inp.placeholder = 'Chat cercano (Enter envía, Esc cierra)'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.style.cssText = 'position:fixed;left:14px;bottom:62px;width:320px;box-sizing:border-box;display:none;z-index:30;background:rgba(8,16,26,.9);border:1px solid #f2b84b;border-radius:6px;color:#fff;padding:7px 9px;font:13px system-ui';
    document.body.append(log, inp);
    for (const ev of ['keydown', 'keyup']) inp.addEventListener(ev, e => e.stopPropagation());
    inp.addEventListener('keydown', e => {
      if (e.code === 'Escape') this.closeChat();
      else if (e.code === 'Enter') { const t = inp.value.trim(); if (t && this.ws?.readyState === 1) this.json({ t: 'chat', x: t.slice(0, 200) }); this.closeChat(); }
    });
    inp.addEventListener('blur', () => this.closeChat());
  }
  openChat() { if (!this.id) return false; this.chatIn.style.display = 'block'; this.chatIn.value = ''; this.chatIn.focus(); return true; }
  closeChat() { this.chatIn.style.display = 'none'; this.chatIn.blur(); }
  chat(id, text) {
    const r = this.remotes.get(id), name = id === this.id ? this.name : r?.name, color = id === this.id ? this.color : r?.color;
    if (!name) return; text = String(text).slice(0, 200);
    const row = document.createElement('div'), b = document.createElement('b'); b.style.color = color; b.textContent = name + ': '; row.append(b, document.createTextNode(text));   // textContent only: never HTML
    this.chatLog.append(row); while (this.chatLog.children.length > 6) this.chatLog.firstChild.remove();
    this.chatLog.style.display = 'block'; clearTimeout(this.chatHide); this.chatHide = setTimeout(() => { this.chatLog.style.display = 'none'; }, 12000);
    if (r) { if (r.bub) { r.bub.removeFromParent(); r.bub.material.map.dispose(); r.bub.material.dispose(); } r.bub = bubble(text); r.bubT = performance.now() + 6000; this.scene.add(r.bub); }
  }
  msg(t) { this.el.msg.textContent = t; }
  json(o) { if (this.ws?.readyState === 1) { const s = JSON.stringify(o); this.ws.send(s); this.stats.tx += s.length + 6; this.stats.txMsgs++; } }

  join(name, color) {
    if (!/^(localhost|127.0.0.1)$/.test(location.hostname)) return this.msg('Multijugador: solo con el servidor local (ver README)');
    if (name) this.el.name.value = name; if (color) this.el.color.value = color;
    this.name = this.el.name.value.trim().slice(0, 16) || 'Jugador'; this.color = this.el.color.value;
    try { localStorage.setItem('chiclana.name', this.name); localStorage.setItem('chiclana.color', this.color); } catch {}
    this.setLocalColor?.(this.color); this.wantOnline = true; this.retry = 0; this.connect();
  }
  connect() {
    clearTimeout(this.retryT);
    let ws; try { ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws'); } catch { return this.lost('No se pudo conectar'); }
    ws.binaryType = 'arraybuffer'; this.ws = ws; this.msg(this.retry ? `Reconectando (${this.retry})…` : 'Conectando…'); this.el.btn.textContent = 'Salir';
    this.bestRtt = 1e9; this.sent = null; this.kicked = null;
    ws.onopen = () => { this.json({ t: 'join', name: this.name, color: this.color, mode: ['car', 'heli', 'walker'].includes(this.getActive().mode) ? this.getActive().mode : 'walker', v: 2 }); this.ping(); };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { this.stats.rx += e.data.length + 2; let m; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); }
      else { this.stats.rx += e.data.byteLength + 2; this.onBatch(new DataView(e.data)); }
      this.stats.rxMsgs++;
    };
    ws.onclose = () => { if (this.ws === ws) this.lost(this.kicked ? 'Expulsado: ' + this.kicked : null); };
    ws.onerror = () => {};
  }
  /** connection dropped: clear the room and, unless the server kicked us or the user left, retry with back-off (1, 2, 4, 8, 15 s...) */
  lost(reason) {
    this.ws = null; this.id = 0; for (const id of [...this.remotes.keys()]) this.remove(id);
    this.el.n.textContent = ''; this.roster();
    if (!this.wantOnline) return;
    if (this.kicked || this.retry >= 12) { this.wantOnline = false; this.el.btn.textContent = 'Conectar'; this.msg(reason || 'Conexión perdida'); return; }
    const wait = Math.min(15000, 1000 * 2 ** this.retry++) * (0.8 + Math.random() * 0.4);
    this.msg(`Conexión perdida. Reintentando en ${Math.round(wait / 1000)} s…`); this.retryT = setTimeout(() => this.connect(), wait);
  }
  leave() {
    this.wantOnline = false; clearTimeout(this.retryT); const ws = this.ws; this.ws = null; try { ws?.close(); } catch {}
    for (const id of [...this.remotes.keys()]) this.remove(id);
    this.el.btn.textContent = 'Conectar'; this.el.n.textContent = ''; this.msg('Desconectado'); this.id = 0; this.roster();
  }
  ping() { this.pingT = performance.now(); this.json({ t: 'ping', c: this.pingT }); }
  /** server clock (ms) for "now" */
  serverNow() { return performance.now() + this.offset; }

  onMsg(m) {
    if (m.t === 'welcome') {
      this.id = m.id; this.retry = 0; this.tick = 1000 / (m.hz || 20); this.offset = (m.s || 0) - performance.now(); this.msg('Conectado: ' + this.name);
      for (const p of m.players) if (p.id !== this.id) this.add(p, p.s);
      this.syncPax();
    }
    else if (m.t === 'chat') this.chat(Number(m.id), m.x);
    else if (m.t === 'ride') this.setRide(Number(m.id) || 0, Number(m.to) || 0);
    else if (m.t === 'join') this.add(m.p);
    else if (m.t === 'leave') this.remove(m.id);
    else if (m.t === 'kick') this.kicked = String(m.why || 'expulsado').slice(0, 40);
    else if (m.t === 'pong') {
      const now = performance.now(), rtt = now - m.c; if (!(rtt >= 0 && rtt < 10000)) return;
      this.jitter = this.jitter * 0.8 + Math.abs(rtt - (this.rtt || rtt)) * 0.2; this.rtt = rtt;
      if (rtt <= this.bestRtt * 1.2 + 5) { this.bestRtt = Math.min(this.bestRtt, rtt); const off = m.s + rtt / 2 - now; this.offset += (off - this.offset) * (this.bestRtt === rtt ? 1 : 0.2); }   // the fastest round trips give the best clock estimate
      else this.bestRtt *= 1.02;                                   // let the reference drift up slowly so a changed route is eventually accepted
    }
    else if (m.t === 'meta') {
      const r = this.remotes.get(m.p.id);
      if (r && (r.name !== m.p.name || r.color !== m.p.color)) { const buf = r.buf; this.remove(m.p.id); this.add(m.p); const n = this.remotes.get(m.p.id); if (n) n.buf = buf; }
    }
    else if (m.t === 'state') { const t = this.serverNow(); for (const s of m.p) this.snap(s[0], s[1], t, s[2], s[3], s[4], s[5], s[6], s[7], s[8]); }   // v1 server: no timestamps
    this.roster();
  }
  onBatch(d) {
    if (d.byteLength < 6 || d.getUint8(0) !== 2) return;
    const t = d.getUint32(1, true), n = d.getUint8(5); if (d.byteLength < 6 + n * 18) return;
    for (let i = 0, o = 6; i < n; i++, o += 18)
      this.snap(d.getUint8(o), MODES[d.getUint8(o + 1) & 3] || 'heli', t, d.getInt32(o + 2, true) / 100, d.getUint16(o + 10, true) / 20 - 200, d.getInt32(o + 6, true) / 100,
        d.getUint16(o + 12, true) / 65536 * 2 * Math.PI, d.getInt16(o + 14, true) / 100, d.getInt8(o + 16) / 40, d.getInt8(o + 17) / 40, d.getUint8(o + 1) >> 2);
  }
  /** store one snapshot [server ms, x, y, z, yaw, speed, pitch, roll] of a remote player */
  snap(id, mode, t, x, y, z, yaw, sp, pitch, roll, veh = 0) {
    const r = this.remotes.get(id); if (!r || id === this.id) return;
    if (r.mode !== mode || (mode === 'car' && r.veh !== veh)) { r.veh = veh; this.setMode(r, mode); this.roster(); }
    const b = r.buf, last = b[b.length - 1];
    if (last && t <= last[0]) return;                                                     // out of order
    if (last && Math.hypot(x - last[1], z - last[3]) > 60) { b.length = 0; r.seen = false; }   // teleport: do not sweep across the map
    b.push([t, x, y, z, yaw, sp, pitch, roll]); if (b.length > 24) b.shift();
  }
  add(p, s) {
    if (this.remotes.has(p.id)) return;
    const r = { id: p.id, name: p.name, color: p.color, mode: null, veh: p.veh || 0, buf: [], obj: null, ride: p.ride || 0, pax: 0, tag: nameTag(p.name, p.color), pos: new THREE.Vector3(), yaw: 0, sp: 0, pitch: 0, roll: 0, vel: new THREE.Vector3(), seen: false };
    this.scene.add(r.tag); r.tag.visible = false; this.remotes.set(p.id, r); this.setMode(r, p.mode || 'heli');
    if (s) r.buf.push([this.serverNow() - 1000, ...s]);
  }
  setMode(r, mode) {
    if (r.obj) this.scene.remove(r.obj.group);
    r.mode = mode; const o = r.obj = mode === 'car' ? new Car(this.world, r.veh) : mode === 'walker' ? new Walker(this.world) : new Heli(this.world);
    tint(o.group, r.color, BASE[mode]);
    o.group.visible = r.seen && !r.ride; this.scene.add(o.group); this.syncPax();
  }
  remove(id) {
    const r = this.remotes.get(id); if (!r) return;
    if (r.obj) this.scene.remove(r.obj.group); this.scene.remove(r.tag); if (r.bub) { r.bub.removeFromParent(); r.bub.material.map.dispose(); r.bub.material.dispose(); } r.tag.material.map.dispose(); r.tag.material.dispose(); this.remotes.delete(id);
    if (this.rideId === id) { this.rideId = 0; this.onDismount?.(true); }
    this.syncPax();
  }
  /** ride request / notice: `id` now rides with `to` (0 = got off). Server is the authority; we also set our own state optimistically in board(). */
  setRide(id, to) {
    if (id === this.id) { if (this.rideId !== to) { this.rideId = to; if (!to) this.onDismount?.(true); } }
    else { const r = this.remotes.get(id); if (r) { r.ride = to; if (r.obj) r.obj.group.visible = r.seen && !to; r.tag.visible = r.seen && !to; } }
    this.syncPax();
  }
  /** who sits in whose vehicle: remote drivers get a figure in their passenger seat (also when the passenger is us) */
  syncPax() {
    for (const r of this.remotes.values()) r.pax = 0; this.localPax = 0;
    const link = (rider, driver) => { if (driver === this.id) this.localPax = rider; else { const d = this.remotes.get(driver); if (d) d.pax = rider; } };
    for (const r of this.remotes.values()) if (r.ride) link(r.id, r.ride);
    if (this.rideId) link(this.id, this.rideId);
    const colorOf = id => id === this.id ? this.color : this.remotes.get(id)?.color || '#888888';
    for (const r of this.remotes.values()) {
      let f = this.figs.get(r.id);
      if (!r.pax || !r.obj) { if (f) f.visible = false; continue; }
      if (!f) this.figs.set(r.id, f = new Walker(this.world).group);
      seat(f, r.obj.group, r.mode, r.veh, colorOf(r.pax));
    }
    for (const [id, f] of this.figs) if (!this.remotes.has(id)) { f.removeFromParent(); this.figs.delete(id); }
  }
  /** nearest remote vehicle with a free seat, or null */
  nearestRemote(x, y, z) {
    let best = null, bd = 1e9;
    for (const r of this.remotes.values()) {
      if (!r.seen || r.ride || r.pax || r.mode === 'walker') continue;
      const d = Math.hypot(r.pos.x - x, r.pos.z - z); if (d < (r.mode === 'heli' ? 8 : 5) && Math.abs(r.pos.y - y) < 5 && d < bd) { best = r; bd = d; }
    }
    return best;
  }
  /** ask to ride with remote `id` (or leave with 0) */
  board(id) { this.rideId = id; this.json({ t: 'ride', to: id }); this.syncPax(); }

  roster() {
    const n = this.remotes.size + (this.id ? 1 : 0); this.el.n.textContent = n ? `(${n}) · ${Math.round(this.rtt)} ms` : '';
    if (!this.id) { this.el.list.innerHTML = ''; return; }
    const a = this.getActive(), row = (c, name, ic, extra) => `<div style="display:flex;gap:6px;align-items:center;padding:1px 0"><span style="width:9px;height:9px;border-radius:50%;background:${esc(c)};flex:none"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><span style="color:#9fb2c4">${ic} ${extra}</span></div>`;
    let h = row(this.color, this.name + ' (tú)', iconOf(a.mode, a.obj.type), '');
    for (const r of this.remotes.values()) { const d = r.seen ? Math.hypot(r.pos.x - a.obj.pos.x, r.pos.z - a.obj.pos.z) : null; h += row(r.color, r.name, iconOf(r.mode, r.veh), d == null ? '' : d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'); }
    this.el.list.innerHTML = h;
  }

  /** send the local pose if it changed (binary, 18 bytes) */
  sendPose(a, mode, now) {
    const s = this.sent, x = a.pos.x, y = a.pos.y, z = a.pos.z, yaw = a.psi, moved = !s || s.mode !== mode || s.veh !== (a.type || 0) || Math.abs(x - s.x) > 0.02 || Math.abs(z - s.z) > 0.02 || Math.abs(y - s.y) > 0.03 || Math.abs(wrapPi(yaw - s.yaw)) > 0.004;
    // standing still after moving: repeat the final pose once straight away (two equal snapshots = zero velocity, so nobody extrapolates us past where we stopped)
    if (moved) this.stillSent = 0;
    if (now - this.lastSend < (moved || this.stillSent < 1 ? SEND_MOVING : SEND_IDLE)) return;
    if (!moved) this.stillSent++;
    this.lastSend = now; this.sent = { mode, veh: a.type || 0, x, y, z, yaw };
    const d = this.out, c = (v, a2, b) => v < a2 ? a2 : v > b ? b : v, TAU = 2 * Math.PI;
    d.setUint8(0, 1); d.setUint8(1, Math.max(0, MODES.indexOf(mode)) | (mode === 'car' ? ((a.type || 0) & 15) << 2 : 0)); d.setInt32(2, Math.round(c(x, -40000, 40000) * 100), true); d.setInt32(6, Math.round(c(z, -40000, 40000) * 100), true);
    d.setUint16(10, Math.round((c(y, -200, 3000) + 200) * 20), true); d.setUint16(12, Math.round((((yaw % TAU) + TAU) % TAU) / TAU * 65536) & 65535, true);
    d.setInt16(14, Math.round(c(a.speed ?? a.vf ?? 0, -150, 150) * 100), true); d.setInt8(16, Math.round(c(a.pitch || 0, -3.1, 3.1) * 40)); d.setInt8(17, Math.round(c(a.roll || 0, -3.1, 3.1) * 40));
    this.ws.send(d.buffer); this.stats.tx += 24; this.stats.txMsgs++;
  }

  /** call every frame after the local vehicle updated */
  update(dt) {
    const on = this.ws && this.ws.readyState === 1 && this.id, { obj: a, mode } = this.getActive();
    // our own vehicle shows the passenger that rides with us
    if (!this.localFig) this.localFig = new Walker(this.world).group;
    if (on && this.localPax && (mode === 'car' || mode === 'heli')) seat(this.localFig, a.group, mode, a.type, this.remotes.get(this.localPax)?.color || '#888888'); else this.localFig.visible = false;
    if (!on) return;
    const now = performance.now();
    if (mode !== 'rider') this.sendPose(a, mode, now);
    if (now - this.pingT > 2000) { this.ping(); this.roster(); }
    // render time on the server clock: two ticks back plus the measured jitter (more buffer on a bad link, less on a good one)
    const delay = Math.min(300, this.tick * 2 + this.jitter * 2 + 10), t = this.serverNow() - delay;
    for (const r of this.remotes.values()) {
      const b = r.buf; if (!b.length) continue;
      let i = b.length - 1; while (i > 0 && b[i - 1][0] > t) i--;
      const s1 = b[i], s0 = i > 0 ? b[i - 1] : s1; let x, y, z, yaw;
      if (t <= s1[0] && s1[0] > s0[0]) {                                   // inside the buffer: interpolate
        const f = Math.max(0, (t - s0[0]) / (s1[0] - s0[0]));
        x = s0[1] + (s1[1] - s0[1]) * f; y = s0[2] + (s1[2] - s0[2]) * f; z = s0[3] + (s1[3] - s0[3]) * f; yaw = s0[4] + wrapPi(s1[4] - s0[4]) * f;
      } else {                                                             // newest snapshot is older than the render time: extrapolate briefly, then hold
        x = s1[1]; y = s1[2]; z = s1[3]; yaw = s1[4];
        const gap = s1[0] - s0[0], ahead = Math.min(EXTRAP_MAX, (t - s1[0]) / 1000);
        if (ahead > 0 && gap > 0 && gap < 250 && t - s1[0] < 450) { /* after 0.45 s without news: back to the last known pose */ const k = ahead * 1000 / gap; x += (s1[1] - s0[1]) * k; y += (s1[2] - s0[2]) * k; z += (s1[3] - s0[3]) * k; yaw += wrapPi(s1[4] - s0[4]) * k; }
      }
      const px = r.pos.x, pz = r.pos.z;
      if (!r.seen) { r.pos.set(x, y, z); r.yaw = yaw; r.seen = true; r.obj.group.visible = true; r.tag.visible = true; r.vel.set(0, 0, 0); }
      else { const k = 1 - Math.exp(-dt * 25); r.pos.lerp(_v.set(x, y, z), k); r.yaw += wrapPi(yaw - r.yaw) * k;        // light smoothing hides the corrections after an extrapolation
        r.vel.set((r.pos.x - px) / Math.max(dt, 1e-3), 0, (r.pos.z - pz) / Math.max(dt, 1e-3)); if (r.vel.lengthSq() > 6400) r.vel.set(0, 0, 0); }
      r.sp = s1[5]; r.pitch = s1[6]; r.roll = s1[7];
      r.obj.group.visible = r.seen && !r.ride; r.tag.visible = r.seen && !r.ride;
      this.pose(r, dt, now);
      r.tag.position.set(r.pos.x, r.pos.y + (r.mode === 'walker' ? 2.3 : r.mode === 'car' ? 2.9 : 5.4), r.pos.z);
      if (r.bub) { if (now > r.bubT || r.ride) { r.bub.removeFromParent(); r.bub.material.map.dispose(); r.bub.material.dispose(); r.bub = null; } else r.bub.position.set(r.pos.x, r.tag.position.y + 0.55, r.pos.z); }
      if (mode !== 'rider' && !r.ride) this.collide(a, mode, r);
    }
  }
  pose(r, dt, now) {
    const o = r.obj, g = o.group; g.position.copy(r.pos); g.rotation.set(0, r.yaw, 0);
    if (r.mode === 'walker') {
      const k = Math.min(1, Math.abs(r.sp) / 5) * 0.8, s = Math.sin(now / 1000 * (3 + Math.abs(r.sp) * 1.6)) * k;
      if (o.legs) { o.legs[0].rotation.x = s; o.legs[1].rotation.x = -s; }
      if (o.arms) { o.arms[0].rotation.x = -s * 0.9; o.arms[1].rotation.x = s * 0.9; }
    } else if (r.mode === 'heli') {
      if (o.model) o.model.rotation.set(r.pitch, 0, r.roll, 'YXZ');
      if (o.rotor) o.rotor.rotation.y += 28 * dt; if (o.tail) o.tail.rotation.x += 40 * dt;
    } else if (o.wheels) { if (o.model) o.model.rotation.set(r.pitch, 0, r.roll, 'YXZ'); for (const w of o.wheels) (w.w || w).rotation.x -= r.sp * dt / (o.wr || 0.36); }
  }

  /** local player vs one remote: circle overlap + impulse bounce; walkers are pushed, no damage */
  collide(a, mode, r) {
    if (!r.seen || (mode === 'heli') !== (r.mode === 'heli')) return;      // helis only collide with helis
    const dx = a.pos.x - r.pos.x, dz = a.pos.z - r.pos.z, dy = a.pos.y - r.pos.y, R = RAD[mode] + RAD[r.mode], d2 = dx * dx + dz * dz;
    if (d2 >= R * R || Math.abs(dy) > (mode === 'heli' ? 4 : 2.5)) return;
    const d = Math.sqrt(d2) || 0.001, nx = d2 > 1e-6 ? dx / d : 1, nz = d2 > 1e-6 ? dz / d : 0, over = R - d;
    const share = mode === r.mode ? 0.5 : mode === 'walker' ? 1 : 0.15;
    a.pos.x += nx * over * share; a.pos.z += nz * over * share;
    if (mode === 'walker') { const vn = (a.vx || 0) * nx + (a.vz || 0) * nz; if (vn < 0) { a.vx -= vn * nx; a.vz -= vn * nz; } return; }
    const fx = -Math.sin(a.psi), fz = -Math.cos(a.psi), rx = -fz, rz = fx;
    const lvx = mode === 'car' ? a.vx : fx * (a.vf || 0) + rx * (a.vs || 0), lvz = mode === 'car' ? a.vz : fz * (a.vf || 0) + rz * (a.vs || 0);
    const vn = (lvx - r.vel.x) * nx + (lvz - r.vel.z) * nz;
    if (vn >= 0) return;
    const e = mode === r.mode ? 0.45 : 0.25, j = -(1 + e) * vn * (r.mode === 'walker' ? 0.15 : 0.5);
    if (mode === 'car') { a.vx += j * nx; a.vz += j * nz; }
    else { a.vf = (a.vf || 0) + j * (nx * fx + nz * fz); a.vs = (a.vs || 0) + j * (nx * rx + nz * rz); }
  }
}
