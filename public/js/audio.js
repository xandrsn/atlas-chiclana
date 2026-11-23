// Procedural audio (WebAudio, no files). One AudioContext created on the first user gesture; everything is oscillators + one shared noise buffer.
// main.js calls audio.update(dt, S) each frame; control values are only recomputed at ~20 Hz and ramped with setTargetAtTime (cheap).
// Sources: engines (car per type, moto, helicopter rotor), wind, footsteps by surface, sea / river, tram, stadium crowd (a match loops at the stadiums),
// city / country ambience, collision thuds.
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const MATCH = 600;   // seconds per match loop: kick-off whistle, chants, goals, half-time whistle at 300 s, full time at 600 s
const GOALS = [70, 185, 380, 520];

export class GameAudio {
  /** stadiums: [{x,z}] positions where the crowd sounds */
  constructor(OPT, stadiums = []) {
    this.OPT = OPT; this.stadiums = stadiums; this.ctx = null; this.t = 0; this.stepPh = 0; this.lastCrash = 0; this.sea = 0; this.river = 0; this.urban = 0.5; this.ev = {};
    const go = () => { this.start(); };
    // kept for the whole session: a first event that is not a user activation (touchstart / touch pointerdown, Escape, synthetic) leaves the context suspended, the next real gesture resumes it
    for (const e of ['pointerdown', 'pointerup', 'keydown', 'touchend']) addEventListener(e, go, { passive: true });
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC({ latencyHint: 'interactive' }); const o = this.out = { };
    o.master = c.createGain(); o.master.gain.value = 0; const comp = c.createDynamicsCompressor(); o.master.connect(comp); comp.connect(c.destination);
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); let b = 0;
    for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = (Math.random() * 2 - 1) * 0.6 + b * 6; }   // white + brown mix
    this.noiseBuf = nb;
    const noise = (type, f, q = 0.7) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random()); const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(o.master); return { s, fl, g }; };
    const osc = (type, f) => { const s = c.createOscillator(); s.type = type; s.frequency.value = f; s.start(); return s; };
    // engine: two detuned oscillators through a lowpass
    const eg = c.createGain(); eg.gain.value = 0; eg.connect(o.master); const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 600; ef.connect(eg);
    const e1 = osc('sawtooth', 50), e2 = osc('square', 25); const m1 = c.createGain(), m2 = c.createGain(); m1.gain.value = 0.5; m2.gain.value = 0.35; e1.connect(m1); e2.connect(m2); m1.connect(ef); m2.connect(ef);
    o.eng = { g: eg, f: ef, a: e1, b: e2 };
    // helicopter: blade chop (noise gated by a blade-rate LFO) + turbine whine + low rotor thrum
    const hg = c.createGain(); hg.gain.value = 0; hg.connect(o.master); const chop = c.createGain(); chop.gain.value = 0.5; chop.connect(hg);
    const hn = c.createBufferSource(); hn.buffer = nb; hn.loop = true; hn.start(0, Math.random()); const hf = c.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 220; hf.Q.value = 1.2; hn.connect(hf); hf.connect(chop);
    const lfo = osc('sine', 12), lfoG = c.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(chop.gain);
    const whine = osc('sawtooth', 900), wg = c.createGain(); wg.gain.value = 0.04; whine.connect(wg); wg.connect(hg); const thr = osc('sine', 40), tg = c.createGain(); tg.gain.value = 0.5; thr.connect(tg); tg.connect(hg);
    o.heli = { g: hg, lfo, whine, thr, hf };
    o.wind = noise('bandpass', 500, 0.5); o.sea = noise('lowpass', 500); o.river = noise('bandpass', 900, 0.8); o.city = noise('lowpass', 160); o.tramR = noise('lowpass', 220);
    o.crowd = noise('bandpass', 700, 0.6); o.chant = noise('bandpass', 330, 3); o.crowd2 = noise('highpass', 1800, 0.5);
    // chant voices: two sines gated at the chant rhythm
    o.cg = c.createGain(); o.cg.gain.value = 0; o.cg.connect(o.master); const cv1 = osc('sawtooth', 196), cv2 = osc('sawtooth', 294); const cf = c.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 900; cf.Q.value = 1.5;
    cv1.connect(cf); cv2.connect(cf); cf.connect(o.cg); o.cv = [cv1, cv2];
    document.addEventListener('visibilitychange', () => { if (document.hidden) c.suspend(); else c.resume(); });
    c.resume();
  }
  /** noise burst through a filter (steps, thuds, door beeps use oscillators below) */
  burst(type, f, q, dur, vol, at = 0) {
    const c = this.ctx, t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noiseBuf; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(fl); fl.connect(g); g.connect(this.out.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, vol, type = 'sine', at = 0) {
    const c = this.ctx, t = c.currentTime + at, s = c.createOscillator(); s.type = type; s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(g); g.connect(this.out.master); s.start(t); s.stop(t + dur + 0.05);
  }
  whistle(n = 1, long = 0.5) { for (let i = 0; i < n; i++) { this.tone(2750, 2850, long, 0.12, 'sine', i * (long + 0.18)); this.tone(3100, 3150, long, 0.05, 'sine', i * (long + 0.18)); } }
  thud(mag) { this.burst('lowpass', 180 + mag * 200, 0.7, 0.25 + mag * 0.3, 0.5 + mag * 0.5); this.tone(110, 40, 0.3, 0.5 * (0.4 + mag), 'sine'); if (mag > 0.25) this.burst('bandpass', 2200, 1.2, 0.18 + mag * 0.2, 0.25 * mag, 0.02); }
  step(kind, run) {
    const v = run ? 1.25 : 1, r = 0.85 + Math.random() * 0.3;
    switch (kind) {
      case 'grass': this.burst('bandpass', 1800 * r, 0.8, 0.1, 0.07 * v); break;
      case 'sand': this.burst('lowpass', 900 * r, 0.5, 0.16, 0.09 * v); break;
      case 'wood': this.burst('bandpass', 380 * r, 4, 0.09, 0.2 * v); this.tone(160 * r, 90, 0.07, 0.1 * v); break;
      case 'metal': this.burst('bandpass', 2600 * r, 6, 0.12, 0.12 * v); this.tone(900 * r, 800, 0.1, 0.05 * v, 'square'); break;
      case 'water': this.burst('lowpass', 700 * r, 0.6, 0.28, 0.14 * v); break;
      default: this.burst('bandpass', 1300 * r, 1.6, 0.05, 0.14 * v); this.burst('lowpass', 400, 0.7, 0.06, 0.1 * v);   // pavement
    }
  }
  surface(S) {
    const w = S.world.roads || S.world, p = S.walker.pos;   // waterLevel / lc / road live on the streets object (world.roads), not on main.js' world
    if (S.onTram) return 'metal';
    if (w.waterLevel && w.waterLevel(p.x, p.z) > p.y - 0.1) return 'water';
    const g = w.surf(p.x, p.z, p.y, true); if (p.y > g + 0.35) return 'wood';   // standing on a roof / deck / platform
    if (w.road?.(p.x, p.z, p.y + 0.9, 0.2, true)) return 'pavement';
    const lc = w.lc ? w.lc(p.x, p.z) : 255; return lc === 4 ? 'sand' : lc === 8 || lc === 255 ? 'pavement' : 'grass';
  }
  /** S: { mode, active, car, heli, walker, world, cam (THREE.Vector3), tram, fps } */
  update(dt, S) {
    const c = this.ctx; if (!c || c.state !== 'running') return; const o = this.out, now = c.currentTime, O = this.OPT;
    o.master.gain.setTargetAtTime(O.mute ? 0 : clamp(O.vol ?? 0.7, 0, 1) * 0.8, now, 0.08);
    // ---- discrete events (every frame; cheap checks)
    const car = S.car; if (car.crash && car.crash.t !== this.lastCrash) { this.lastCrash = car.crash.t; if (S.mode === 'car') this.thud(car.crash.mag); }
    if (S.mode === 'walker' && !S.walker.air) {
      const ph = S.walker.phase; if (S.walker.speed > 0.4) { const k = Math.floor(ph / Math.PI); if (k !== this.stepPh) { this.stepPh = k; this.step(this.surface(S), S.walker.speed > 4.5); } } else this.stepPh = Math.floor(ph / Math.PI);
    }
    this.t += dt; if (this.t < 0.05) return; const h = this.t; this.t = 0;
    const T = 0.1, P = S.mode === 'walker' ? S.walker.pos : S.active.pos, mode = S.mode;
    // ---- engines
    const inCar = mode === 'car' || mode === 'rider', inHeli = mode === 'heli';
    if (inCar) {
      const sp = mode === 'car' ? Math.abs(car.speed) : Math.abs(S.active.speed || 0), sp0 = car.spec, bike = sp0.bike;
      const typ = bike ? 1.9 : sp0.id === 'sport' ? 1.35 : sp0.id === 'van' || sp0.id === 'suv' ? 0.8 : 1;
      const rpm = mode === 'car' ? car.rpm : clamp(sp / 40, 0, 1), gear = mode === 'car' ? car.gear : 3, thr = mode === 'car' ? Math.abs(car.kThr) : 0.4;
      const f = (32 + 55 * rpm + gear * 7) * typ;
      o.eng.a.frequency.setTargetAtTime(f, now, T); o.eng.b.frequency.setTargetAtTime(f * 0.5, now, T);
      o.eng.f.frequency.setTargetAtTime((350 + 1400 * rpm + 900 * thr) * (bike ? 1.4 : 1), now, T);
      o.eng.g.gain.setTargetAtTime((0.1 + 0.2 * thr + 0.08 * rpm) * (sp0.id === 'van' ? 1.2 : 1) * (bike ? 0.8 : 1), now, T);
    } else o.eng.g.gain.setTargetAtTime(0, now, 0.15);
    if (inHeli) {
      const hl = S.heli, spin = clamp((hl.spin || 0) / 30, 0, 1), sp = clamp((hl.velocityKmh || 0) / 450, 0, 1);
      o.heli.lfo.frequency.setTargetAtTime(4 + 9 * spin, now, T); o.heli.thr.frequency.setTargetAtTime(30 + 25 * spin, now, T);
      o.heli.whine.frequency.setTargetAtTime(500 + 900 * spin, now, T); o.heli.hf.frequency.setTargetAtTime(160 + 160 * sp, now, T);
      o.heli.g.gain.setTargetAtTime(spin * (0.35 + 0.15 * sp), now, 0.2);
    } else o.heli.g.gain.setTargetAtTime(0, now, 0.2);
    // wind: speed (vehicles / skydiving), a bit with altitude
    const vk = mode === 'chute' ? Math.abs(S.walker.vy || 0) * 3.6 + 40 : (S.active.velocityKmh || 0);
    o.wind.g.gain.setTargetAtTime(mode === 'walker' ? clamp(0.02 + (S.walker.air ? 0.05 : 0), 0, 0.08) : clamp(vk / 500, 0, 0.35) ** 1.3, now, 0.2);
    o.wind.fl.frequency.setTargetAtTime(300 + clamp(vk, 0, 400) * 3, now, 0.2);
    // ---- environment (sampled every 0.5 s)
    this.env = (this.env || 0) - h;
    if (this.env <= 0) {
      this.env = 0.5; const w = S.world.roads || S.world, hf = S.world.hf, ry = (S.mode === 'heli' || S.mode === 'chute') ? P.y - hf.height(P.x, P.z) : 0; let sea = 0, riv = 0;
      for (const r of [25, 70, 150, 300]) for (let a = 0; a < 8; a++) {
        const x = P.x + Math.cos(a * 0.785) * r, z = P.z + Math.sin(a * 0.785) * r, g = hf.height(x, z);
        if (g < 0.25) sea = Math.max(sea, 1 / (1 + (r / 70) ** 2)); else if (w.waterLevel && w.waterLevel(x, z) > -1e8 && r <= 150) riv = Math.max(riv, 1 / (1 + (r / 30) ** 2));
      }
      if (w.waterLevel && w.waterLevel(P.x, P.z) > -1e8) { if (hf.height(P.x, P.z) < 0.25) sea = 1; else riv = 1; }
      const att = 1 / (1 + ry / 120); this.sea = sea * att; this.river = riv * att;
      const lc = w.lc ? w.lc(P.x, P.z) : 255; this.urban += ((lc === 8 || lc === 255 ? 1 : 0.25) - this.urban) * 0.5; this.urban *= att;
    }
    const swell = 0.5 + 0.5 * Math.sin(now * 0.45) * Math.sin(now * 0.17 + 1);   // slow wave cycle
    o.sea.g.gain.setTargetAtTime(this.sea * (0.1 + 0.22 * swell), now, 0.4); o.sea.fl.frequency.setTargetAtTime(350 + 700 * swell, now, 0.5);
    o.river.g.gain.setTargetAtTime(this.river * 0.12, now, 0.4);
    o.city.g.gain.setTargetAtTime(this.urban * 0.12 * (mode === 'car' ? 0.5 : 1), now, 0.5);
    if (mode === 'walker' && this.urban < 0.5 && Math.random() < h * 0.4) { const f = 2600 + Math.random() * 1600; this.tone(f, f * 1.25, 0.08, 0.025); this.tone(f * 1.1, f * 0.9, 0.07, 0.02, 'sine', 0.11); }   // birds
    if (mode === 'walker' && this.urban > 0.6 && Math.random() < h * 0.05) this.tone(420, 400, 0.35, 0.03, 'square');   // far-off horn
    this.tramSound(S, now, h);
    this.crowd(S, now, P);
  }
  tramSound(S, now, h) {
    const o = this.out, tr = S.tram; let near = 1e9;
    if (tr?.trams) {
      const Pz = this._tp || (this._tp = {}); this.tramPrev = this.tramPrev || new Map();
      for (const t of tr.trams) {
        const c = t.cur; tr.pose(c.s, c.w, 3, Pz); const d = Math.hypot(Pz.x - S.cam.x, Pz.z - S.cam.z), pv = this.tramPrev.get(t) || { x: Pz.x, z: Pz.z, doors: 0 };
        const sp = Math.hypot(Pz.x - pv.x, Pz.z - pv.z) / h; near = Math.min(near, d / (1 + Math.min(sp, 12) * 0.1));
        if (d < 120) { const k = 1 / (1 + (d / 40) ** 2); if (c.doors > 0.05 && pv.doors <= 0.05) { this.tone(1500, 1500, 0.18, 0.1 * k, 'square'); this.tone(1500, 1500, 0.18, 0.1 * k, 'square', 0.3); this.tone(1500, 1500, 0.18, 0.1 * k, 'square', 0.6); }
          if (c.doors < 0.95 && pv.doors >= 0.95 || (sp > 1 && pv.sp <= 1)) { this.tone(780, 780, 0.5, 0.12 * k, 'sine'); this.tone(1170, 1170, 0.4, 0.06 * k, 'sine'); } }   // bell when it pulls away / doors close
        t._sp = sp; this.tramPrev.set(t, { x: Pz.x, z: Pz.z, doors: c.doors, sp });
      }
    }
    const sp = Math.max(0, ...(tr?.trams || []).map(t => t._sp || 0)), k = near < 1e8 ? 1 / (1 + (near / 35) ** 2) : 0;
    o.tramR.g.gain.setTargetAtTime(k * clamp(sp / 8, 0, 1) * 0.3 + (S.onTram ? clamp(sp / 8, 0, 1) * 0.15 : 0), now, 0.3);
    o.tramR.fl.frequency.setTargetAtTime(120 + sp * 12, now, 0.3);
  }
  /** Stadium: a loop of MATCH s based on the clock; gain falls off with distance, lowpass closes as you move away */
  crowd(S, now, P) {
    const o = this.out; let d = 1e9;
    for (const s of this.stadiums) d = Math.min(d, Math.hypot(s.x - S.cam.x, s.z - S.cam.z));
    const clock = (Date.now() / 1000) % MATCH, playing = clock > 8 && !(clock > 300 && clock < 320) && clock < MATCH - 5;
    const att = d > 900 ? 0 : 1 / (1 + (d / 90) ** 2), inside = d < 70 ? 1 : 0;
    // surges: goal roars (12 s) and a periodic swell, chants in between
    let roar = 0, chant = 0; for (const g of GOALS) { const x = clock - g; if (x > 0 && x < 14) roar = Math.max(roar, Math.min(1, x / 1.2) * Math.exp(-x / 6)); }
    const base = playing ? 0.35 + 0.15 * Math.sin(now * 0.3) : clock <= 8 ? 0.4 : 0.2, cyc = clock % 45; chant = playing && cyc > 20 && cyc < 38 ? 1 : 0;
    const lvl = att * (base + roar * 0.9);
    o.crowd.g.gain.setTargetAtTime(lvl * 0.35, now, 0.3); o.crowd.fl.frequency.setTargetAtTime(500 + 500 * roar + 1500 * (1 - clamp(d / 500, 0, 1)) * 0.3, now, 0.3);
    o.crowd2.g.gain.setTargetAtTime(att * roar * 0.1 * (d < 250 ? 1 : 0.3), now, 0.2);
    const beat = (now * 2.2) % 1 < 0.55 ? 1 : 0.15;   // ~"o-lé o-lé" rhythm
    o.cg.gain.setTargetAtTime(att * chant * 0.05 * beat, now, 0.04); o.cv[0].frequency.setTargetAtTime(196 * (1 + 0.12 * (Math.floor(now * 2.2) % 4 > 1)), now, 0.05); o.cv[1].frequency.setTargetAtTime(294 * (1 + 0.12 * (Math.floor(now * 2.2) % 4 > 1)), now, 0.05);
    o.chant.g.gain.setTargetAtTime(att * chant * 0.12 * beat, now, 0.05);
    // whistles at kick-off, half-time, full time (only if you can hear the stadium)
    for (const [t, n, len] of [[8, 1, 0.9], [300, 2, 0.5], [320, 1, 0.9], [MATCH - 5, 3, 0.55]]) {
      if (clock >= t && clock < t + 1 && this.ev.w !== Math.floor(Date.now() / 1000 / MATCH) + ':' + t) { this.ev.w = Math.floor(Date.now() / 1000 / MATCH) + ':' + t; if (att > 0.01) this.whistle(n, len); }
    }
    this.dist = d; this.state = { clock, playing, att };
  }
}
