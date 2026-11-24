// v2 entry point: config from data/*.json, renderer, baked-cell streaming, fixed-step car, chase camera, perf panel.
// URL: /v2/?map=chiclana|madrid  ?spawn=<id>  ?q=bajo|medio|alto  ?perf  ?hour=19  ?clock=0 (stopped game clock)  ?mode=fly (camera flight for benchmarks)
import * as THREE from 'three';
import { Cells } from './stream/cells.js';
import { makeMaterials, makeSky, TimeCycle, blobShadow } from './render/world.js';
import { SunShadows } from './render/shadow.js';
import { Car, fixedStep } from './sim/car.js';
import { Ground, groundFn, CAR, FOOT } from './sim/ground.js';
import { onKey, onAction, setControls } from './input/keys.js';
import { makePlay } from './sim/play.js';
import { vehicleName } from './sim/vehicles.js';
import { Pause, frameClock } from './ui/pause.js';
import { Perf } from './ui/perf.js';
import { showLoading, setProgress, hideLoading } from './ui/loading.js';
import { mapPicker } from './ui/mappick.js';
import { t, translate, onLang } from './ui/i18n.js';
import { showTutorial, tutorialSeen } from './ui/tutorial.js';
import { makeTransit, spawnFor } from './ui/transit.js';
import { Crowd } from './peds/crowd.js';
import { withWalls } from './sim/walls.js';
import { Events } from './events/events.js';

THREE.ColorManagement.enabled = false;   // vertex colours are authored as display (sRGB) bytes and go straight to the screen
const qs = new URLSearchParams(location.search), $ = id => document.getElementById(id);
showLoading(); translate(document.body); setProgress(0, t('Leyendo configuración…'));
const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const [cfg, qual, tc, ctl, maps] = await Promise.all([get('/data/v2.json'), get('/data/quality.json'), get('/data/timecyc.json'), get('/data/controls.json'), get('/data/maps.json')]);
setControls(ctl, () => document.pointerLockElement === $('c'));
let qKey = qs.get('q'); try { qKey ||= localStorage.getItem('v2.q'); } catch {} if (!qual.presets[qKey]) qKey = qual.default;
for (const k in maps.maps) if (maps.enabled && !maps.enabled.includes(k)) delete maps.maps[k];   // data/maps.json "enabled": temporarily playable maps (picker and ?map= follow it)
const mapId = maps.maps[qs.get('map')] ? qs.get('map') : maps.default;   // ?map=madrid ; another map = reload (one map in memory)
const Q = qual.presets[qKey], base = `/data/cells/${mapId}/`;
setProgress(0.05, t('Cargando índice de celdas…')); const index = await get(base + 'index.json');
const go = (map, spawn) => { showLoading(); setProgress(0, t('Viajando…')); const u = new URLSearchParams(location.search); u.set('map', map); u.set('spawn', spawn); location.search = u; };
const pick = () => mapPicker({ maps, map: mapId, spawn: qs.get('spawn') || index.defaultSpawn, get, go });   // map + spawn selector (ui/mappick.js)
document.querySelector('.v2l-foot')?.prepend(pick());
const levels = await get(base + 'levels.json').catch(() => null);   // footbridges, car parks (scripts/bake/plugins/bridges.mjs, underground.mjs); none = terrain + decks
const transit = await get('/data/transit.json').catch(() => null);   // metro / Cercanías / tranvía (scripts/transit_data.mjs, ui/transit.js); none = no transport screens

const canvas = $('c'), renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setPixelRatio(Math.min(devicePixelRatio, Q.maxPixelRatio) * Q.pixelRatio);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(cfg.camera.fov, 1, 0.5, Q.drawDist * 1.02);
const resize = () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }; addEventListener('resize', resize); resize();

setProgress(0.1, t('Preparando el render…'));
const mats = makeMaterials(renderer), time = new TimeCycle(tc, scene, mats, Q); scene.add(makeSky(mats)); await mats.ready;   // texture atlases (3 MB); a failed one leaves flat colours
const cells = new Cells(scene, index, base, Q, mats);
cells.ground = new Ground(cells, levels);   // layered ground of the sim (sim/ground.js): the mover's y picks the layer (on / under bridges, in the car park)
const shadows = new SunShadows(scene, mats, (x, z) => cells.heightAt(x, z), Q.shadow);
const car = new Car(cfg.car, groundFn(cells.ground, CAR));
const S = index.spawns[qs.get('spawn')] || spawnFor(transit, mapId, qs.get('spawn')) || index.spawns[index.defaultSpawn]; car.place(S.x, S.z, S.h);   // ?spawn=<id of data/zones/<map>.json or a rail stop of data/transit.json>
// map limit (index.limit, baked): even-odd point-in-polygon; outside = back to the last inside position, stopped; warning near the edge
const LIM = index.limit, inLim = (x, z) => { let c = false; for (const r of LIM.rings) for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) if ((r[a + 1] > z) !== (r[b + 1] > z) && x < r[b] + (z - r[b + 1]) * (r[a] - r[b]) / (r[a + 1] - r[b + 1])) c = !c; return c; };
const warnEl = Object.assign(document.body.appendChild(document.createElement('div')), { textContent: t('Fuera del mapa') });
warnEl.style.cssText = 'position:fixed;top:12%;left:50%;transform:translateX(-50%);padding:8px 18px;background:#000a;color:#ffd27a;font:600 18px system-ui;border-radius:6px;display:none;pointer-events:none';
let limIn = { x: S.x, z: S.z }, limT = 0;

// protagonist on foot + enterable vehicles + third-person camera (sim/play.js); pause menu + pointer lock (ui/pause.js)
const pause = new Pause(canvas, { presets: qual.presets, current: qKey }), clock = frameClock();
pause.el.querySelector('.v2p-main').append(pick()); pause.onTutorial = () => showTutorial(pause);
const play = await makePlay({ scene, cells, mats, car, walker: cfg.walker, time, get, paused: () => pause.paused, map: mapId, Q });
// where a parked dozer may stand (traffic/ambient.js park): the first spot on rings around the lot centre with no helipad (any lot spot, shown or not) within 14 m, no wall and no parked car under the machine
play.ambient.yardSpot = (x, z, hw, hl, h) => {
  if (Math.hypot(x - play.current.x, z - play.current.z) < 60) return undefined;   // parked by the player, not a yard: stays where it is
  for (let r = 0; r <= 80; r += 4) for (let k = 0; k < (r ? 12 : 1); k++) {
    const px = x + Math.cos(k * Math.PI / 6) * r, pz = z + Math.sin(k * Math.PI / 6) * r, t = cells.ground.terrain(px, pz); if (!t) continue;
    if (!play.pads?.spots.some(s => Math.hypot(s.x - px, s.z - pz) < 14) && !play.ambient.hit(px, pz, Math.max(hw, hl) + 1, t.y, true) && !play.solid.hits(px, pz, h, hw + 1, hl + 1, t.y + 1, t.y + 1.6)) return [px, pz, t.y];
  }
  return null;
};
get(base + 'props.json').then(p => play.debris.setProps(p)).catch(() => {});   // knockable street furniture (scripts/bake_cells.mjs); none = trees only
// ambient pedestrians (peds/crowd.js) on data/peds/<map>.json (scripts/peds_data.mjs), walking on the walker's own ground + walls; loaded in the background
const pedsDb = await get('/data/peds.json'), crowd = new Crowd({ scene, db: pedsDb, data: null, walk: withWalls(groundFn(cells.ground, FOOT), play.solid, () => [0.25, 0.25]), Q });
get(`/data/peds/${mapId}.json`).then(d => crowd.setData(d)).catch(() => {});   // no file: nobody walks
// switchable events (data/events.json, events/events.js): all off by default; the pause menu has the switches. Built live, 3 draw calls each while active.
const events = new Events({ scene, cat: await get('/data/events.json').catch(() => ({ events: [] })), map: mapId, origin: maps.maps[mapId].origin, cells, db: pedsDb, walk: crowd.walk, Q, closed: play.ambient.closed, get, crowd });
pause.eventsPanel(events);
const spawnOnFoot = () => { play.spawn(); if (S.foot) { play.player.place(S.foot.x, S.foot.z, S.foot.h); play.cam.reset(S.foot.h); } };   // S.foot: exact spawn (data/zones) puts the player by the door, the car stays parked
spawnOnFoot();

let mode = qs.get('mode') === 'fly' ? 'fly' : 'car', auto = qs.has('auto') || mode === 'fly', wp = 0, flyD = 0;
const loop = [[-650, -650], [650, -650], [650, 650], [-650, 650]].map(([a, b]) => [S.x + a, S.z + b]);
const autopilot = () => {   // benchmark driver: laps the slice through the waypoints (crosses many cell borders)
  const [tx, tz] = loop[wp]; if (Math.hypot(tx - car.x, tz - car.z) < 30) wp = (wp + 1) % loop.length;
  let d = Math.atan2(-(tx - car.x), -(tz - car.z)) - car.h; d = Math.atan2(Math.sin(d), Math.cos(d));
  return { throttle: 1, steer: Math.max(-1, Math.min(1, d * 2)), brake: 0 };
};
const flyPos = d => { const L = loop.length, seg = 1300; d %= seg * L; const k = Math.floor(d / seg), t = d / seg - k, [ax, az] = loop[k], [bx, bz] = loop[(k + 1) % L]; return [ax + (bx - ax) * t, az + (bz - az) * t]; };
onAction('camera', () => { mode = mode === 'car' ? 'fly' : 'car'; });
onKey('KeyT', () => time.skip(1));   // jump the game clock one hour
let clockTxt = '', vehTxt = ''; onLang(() => { clockTxt = ''; });

const step = fixedStep(cfg.physicsHz);
let ready = false, focus = play.player, pending = null;
// transport (ui/transit.js): same map = the player jumps there behind the loading screen; another map = reload with ?map=&spawn= (other params kept)
const teleport = (x, z, h) => { pending = { x, z, h }; ready = false; showLoading(); setProgress(0.15, t('Viajando…')); play.player.place(x, z, h); };
const tr = transit && makeTransit({ T: transit, map: mapId, play, cells, pause, teleport, go });
const radar = import('./ui/radar.js').then(m => m.makeRadar({ map: mapId, play, cam, pause, index, transit }));   // HUD radar + map screen (own rAF)
const perf = new Perf(renderer, () => ({ cells: cells.stats, q: Q.label, draw: Q.drawDist, mode: mode + ({ car: ' · coche', heli: ' · helicóptero' }[play.inKind] || ' · a pie') + (auto ? ' (auto)' : ''), hour: time.h.toFixed(1), pos: `${focus.x.toFixed(0)}, ${focus.z.toFixed(0)}` }));
window.__v2 = { events, cells, car, crowd, perf, cam, renderer, Q, qKey, time, map: mapId, spawn: S, inLim, play, pause, transit: tr, radar, teleport, go, get mode() { return mode; }, set mode(m) { mode = m; if (m === 'car') play.enter(0); }, set auto(v) { auto = v; }, ready: 0 };

renderer.setAnimationLoop(now => {
  const dt = clock(now, pause.paused);   // 0 while paused: no physics steps, no clock, no animation, no catch-up on resume
  let fx = focus.x, fz = focus.z;
  if (mode === 'fly') { flyD += dt * 70; [fx, fz] = flyPos(flyD); }
  perf.time('stream', () => cells.update(fx, fz));
  if (!ready) {
    const s = cells.stats, f = cells.near(fx, fz, Math.min(Q.lodDist, 300)); setProgress(0.15 + 0.85 * f, t('Cargando celdas… {0} listas · {1} en camino', s.resident, s.inflight));
    if (pending) { if (f >= 1 && cells.ground.terrain(pending.x, pending.z)) { ready = true; const p = pending; pending = null; play.player.place(p.x, p.z, p.h); play.cam.reset(p.h); limIn = { x: p.x, z: p.z }; hideLoading(); } }   // its own cell must be in (the walker takes the top surface there)
    else if (f >= 1) { ready = true; car.place(car.x, car.z, car.h); if (!play.inCar) spawnOnFoot(); hideLoading(); if (!auto && !navigator.webdriver && !tutorialSeen()) showTutorial(pause); window.__v2.ready = performance.now(); console.log(`[v2] jugable en ${(window.__v2.ready / 1000).toFixed(2)} s`); }
  }
  let a = 1;
  if (ready) a = perf.time('sim', () => step(dt, h => play.step(h, auto && mode === 'car' && play.current === car ? autopilot() : null)));
  if (ready && (limT += dt) > 0.1) {   // 10 Hz is plenty at road speeds; rings are a few thousand points
    limT = 0; const o = play.current;
    warnEl.style.display = inLim(o.x, o.z) ? 'none' : '';   // no push-back: past the limit the map just ends (user, 2026-11-18)
  }
  perf.time('cam', () => {
    focus = play.frame(dt, a, cam, mode === 'fly');
    if (mode === 'fly') { const [ax, az] = flyPos(flyD + 200), g = cells.heightAt(fx, fz); cam.position.set(fx, g + 90, fz); cam.lookAt(ax, cells.heightAt(ax, az), az); }
  });
  if (ready) perf.time('traffic', () => play.traffic(dt, focus));
  if (ready) perf.time('peds', () => { crowd.light(time.s?.light); if (play.inKind === 'car' && crowd.knock(car)) car.v *= car.p.skid ? 1 : 0.95; crowd.update(dt, { x: focus.x, y: play.current.y, z: focus.z }, play.inCar ? [{ x: play.current.x, z: play.current.z, r: 2.5 }] : [{ x: play.player.x, z: play.player.z, r: 0.4 }], play.inKind === 'car' ? car : null); });
  if (ready) perf.time('events', () => events.update(dt, { x: focus.x, y: play.current.y, z: focus.z }, play.inCar ? [{ x: play.current.x, z: play.current.z, r: 2.5 }] : [{ x: play.player.x, z: play.player.z, r: 0.4 }], time.s?.light, time.mats.u.uNight.value));
  if (ready && tr) tr.update();
  time.update(dt); if (time.clock !== clockTxt) $('clock').textContent = (clockTxt = time.clock) + ' · ' + t(time.s.band);
  const veh = t(vehicleName(play.vehicle)); if (veh !== vehTxt) $('veh').textContent = vehTxt = veh;
  perf.time('render', () => { perf.beginGpu(); shadows.update(renderer, cam, dt); renderer.render(scene, cam); perf.endGpu(); });
  perf.frame(now);
});
