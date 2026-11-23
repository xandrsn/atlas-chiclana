// Player glue: the on-foot protagonist (own look, built with peds/pedmesh.js), the enterable vehicles (the player's car, any model
// of data/vehicles/index.json, and the helicopter), F to get in / out, the third-person orbit camera, the ambient parked cars and
// traffic (traffic/ambient.js) and the debug cheats. boot.js calls step() inside the fixed 60 Hz loop and frame() once per rendered
// frame (dt = 0 while paused: everything freezes).
import * as THREE from 'three';
import { Player } from './player.js';
import { Avatar } from './avatar.js';
import { Board } from './board.js';
import { cutDoor } from '../vehicles/door.js';
import { inBox } from '../traffic/park_math.js';
import { groundFn, FOOT } from './ground.js';
import { Heli } from './heli.js';
import { substep } from './car.js';
import { withWalls } from './walls.js';
import { debugWalls } from './debugwalls.js';
import { loadCatalog, carParams, heliParams, camFor } from './vehicles.js';
import { OrbitCam, boomWorld } from '../camera/orbit.js';
import { Solid } from '../camera/solid.js';
import { resolvePed, buildPed, setPedAnim, makeLowpolyMaterial } from '../peds/pedmesh.js';
import { preloadPedGLBs } from '../peds/pedglb.js';
import { buildVehicle, setLights, preloadGLBs } from '../vehicles/carmesh.js';
import { Ambient } from '../traffic/ambient.js';
import { Debris } from '../render/debris.js';
import { Fx } from '../render/fx.js';
import { Wrecks, crashFx, smokeTick } from '../render/wrecks.js';
import { Skin } from '../render/dent.js';
import { PIVOT, GROUSERS, TRACK_LOOP, TRACK_PATH } from '../vehicles/dozermesh.js';
import { Helipads } from '../traffic/helipads.js';
import { Trams } from '../traffic/tram.js';
import { blobShadow } from '../render/world.js';
import { poll, actions, takeLook, onAction, onKey, controls } from '../input/keys.js';

export async function makePlay({ scene, cells, mats, car, walker, time, get, paused, map, Q }) {
  const C = controls(), P = C.player;
  const [peds, specs, park, tramData, transit] = await Promise.all([get('/data/peds.json'), loadCatalog(get), get(`/data/parking/${map}.json`).catch(() => null),
    ...map === 'chiclana' ? [get('/data/tram/tram.json').catch(() => null), get('/data/transit.json').catch(() => null)] : []]);   // no parking data: no ambient cars
  await preloadGLBs();   // Blender vehicle models (assets/vehicles): before any buildVehicle, which stays sync
  await preloadPedGLBs();   // Blender pedestrian models (assets/peds): before any buildPed / Rig.geometry
  const recipe = resolvePed(peds, P.style, P.seed); recipe.top.color = P.top; recipe.acc = recipe.acc.filter(a => a.part !== 'tray');   // the protagonist's own outfit
  const pedMat = makeLowpolyMaterial({ anim: true }), vehMat = makeLowpolyMaterial();
  const avatar = new Avatar(recipe), ped = avatar.mesh, pShadow = blobShadow(mats, 0.45, 0.45);   // skinned rig (sim/avatar.js)
  const roads = specs.filter(s => s.kind !== 'heli'), helis = specs.filter(s => s.kind === 'heli');
  let hm = 0, hCol = new THREE.Color(helis[0]?.palette[0]);   // the player's helicopter: model index in helis, colour
  let model = Math.max(0, roads.findIndex(s => s.id === P.car));
  const carMesh = new THREE.InstancedMesh(buildVehicle(roads[model], 0), vehMat, 1), cShadow = blobShadow(mats, 1, 1);
  carMesh.setColorAt(0, new THREE.Color(P.carColor));
  scene.add(ped, pShadow, carMesh, cShadow);
  // crash damage (render/dent.js skin of the player's mesh, render/fx.js particles, render/wrecks.js hit cars) and the bulldozer's moving parts
  // a bike that goes down throws its rider (the player's own ped mesh, ballistic, then lies still)
  const rider = { on: false, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tilt: 0, w: 0, h: 0 };
  let skin = null; const smokeSt = {}, fx = new Fx(scene, (x, z, y) => cells.ground.terrain(x, z)?.y ?? y);
  const dzSpec = specs.find(s => s.kind === 'dozer'), dz = dzSpec && { ang: 0, s: 0, blade: new THREE.InstancedMesh(buildVehicle(dzSpec, 0, { part: 'blade' }), vehMat, 1), shoes: new THREE.InstancedMesh(buildVehicle(dzSpec, 0, { part: 'grouser' }), vehMat, GROUSERS * 2) };
  if (dz) {
    dz.blade.setColorAt(0, new THREE.Color('#e0a81c')); dz.shoes.setColorAt(0, new THREE.Color('#ffffff')); dz.blade.position.set(...PIVOT); dz.shoes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [dz.blade, dz.shoes]) { m.frustumCulled = false; m.visible = false; carMesh.add(m); }
  }
  let carColor = P.carColor, mult = C.speed || 1;   // the player's car paint; vehicle speed multiplier (pause menu: C.speed)
  // the driver of a traffic car the player takes gets out and walks off for a few seconds
  const drv = new THREE.InstancedMesh(buildPed(resolvePed(peds, peds.styles?.[1]?.id ?? P.style, 7), 0), pedMat, 1); drv.setColorAt(0, new THREE.Color(1, 1, 1)); drv.visible = false; drv.t = 0; scene.add(drv);

  const ground = groundFn(cells.ground, FOOT);   // layered (sim/ground.js): terrain, bridge decks, footbridges, car parks; the player's y picks the layer
  C.mouse.padLook = C.gamepad.lookSpeed;   // same object the pause menu edits (sensitivity / invert Y)
  const cam = new OrbitCam(C.camera, C.mouse), solid = new Solid(cells);
  const dbgWalls = debugWalls(scene, solid); dbgWalls.on = new URLSearchParams(location.search).has('debugwalls'); onKey('F4', () => { dbgWalls.on = !dbgWalls.on; });   // wall collision overlay
  const amb = new Ambient({ scene, mat: vehMat, specs, data: park, ground: cells.ground, Q });
  // Chiclana tram (traffic/tram.js): 2 trams on the real line, ridable (F by an open door), solid for the movers and the traffic
  const trams = tramData && new Trams({ scene, mat: vehMat, data: tramData, names: transit?.maps?.chiclana?.rail?.[0]?.stops.map(s => s.name), t0: Date.now() / 1000 });
  const TRAM = { kind: 'tram', dims: { length: 32, width: 2.6, height: 3.6 } };
  // speedometer (km/h) in a vehicle, next stop on the tram: radar style (ui/radar.js colours)
  const hud = document.createElement('div'); hud.hidden = true; hud.setAttribute('aria-live', 'off');
  hud.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:5;padding:4px 12px;background:#22223b;color:#fbf6ec;font:700 22px/1.3 Verdana,sans-serif;box-shadow:4px 4px 0 #c8553d;pointer-events:none';
  document.body.appendChild(hud);
  // ambient cars are solid for the player's car and the walker (a blocked ground sample = the movers' existing wall response)
  const pads = helis.length ? new Helipads({ scene, mat: vehMat, helis, lots: park?.lots }) : null;   // the player's + parked helicopters (traffic/helipads.js)
  const solidFor = (g, r, traffic = true) => (x, z, y, h) => { const o = g(x, z, y, h); return o && !o.blocked && (amb.hit(x, z, r(), o.y, traffic) || pads?.hit(x, z, r()) || trams?.hit(x, z, r())) ? { ...o, blocked: true } : o; };
  // building walls (camera/solid.js grid, sim/walls.js): the walker is a 0.6 m square, the car its model's footprint
  const player = new Player(walker, P, solidFor(withWalls(ground, solid, () => [0.3, 0.3]), () => 0.3));
  // the car meets moving traffic with an impulse (amb.bump), trees and street furniture fall over above a few m/s (render/debris.js)
  const debris = new Debris({ scene, cells, mats }), carG = solidFor(withWalls(car.ground, solid, () => [car.p.halfW ?? 0.85, car.p.halfL ?? 2.2]), () => car.p.halfW ?? 0.85, false);
  // the walker also meets the player's own car (not while getting in / out) and the street furniture / trees (no tunnelling through props)
  const board = new Board(player, avatar), pg = player.ground; let doorMesh = null;
  player.ground = (x, z, y) => {
    const o = pg(x, z, y); if (!o || o.blocked) return o; const gy = o.y ?? o;
    const hit = !inV && !board.busy && Math.abs(gy - car.y) < 1.5 && inBox(x, z, car.x, car.z, car.h, car.p.halfL ?? 2.2, car.p.halfW ?? 0.85, 0.3) || debris.hit(x, z, 0, 0.25, 0.25, 0, gy) === 0;
    return hit ? { ...(typeof o === 'object' ? o : { y: o }), blocked: true } : o;
  };
  const wrecks = new Wrecks({ scene, mat: vehMat, fx, specs: roads, groundAt: (x, z) => cells.ground.terrain(x, z)?.y ?? null, blocked: (x, z, h, hw, hl, y) => solid.hits(x, z, h, hw, hl, y + 1, y + 1.6), onDrop: w => w.origin && amb.release(w.origin) });
  amb.onBump = (o, J, k, mb) => { const w = wrecks.spawn(o); if (w) wrecks.hurt(w, J / mb, k.px, k.pz, k.nx, k.nz); return !!w; };   // a traffic car that gets hit leaves the fleet: a wreck with its own dents
  car.onHit = (c, e) => {
    const b = { x: c.x, y: c.y, z: c.z, h: c.h, hl: c.p.halfL ?? 2.2, hw: c.p.halfW ?? 0.85 };
    if (c.p.skid) {   // the bulldozer shrugs it off: a building facade sheds rubble and dust
      if (e.kind === 'wall' && e.dv > 4) { for (let k = 0; k < Math.min(9, e.dv); k++) fx.chunk(e.px + (Math.random() - 0.5) * 2, c.y + 1 + Math.random() * 2, e.pz + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, [0.12 + Math.random() * 0.18, 0.1 + Math.random() * 0.12, 0.12 + Math.random() * 0.18], Math.random() < 0.5 ? '#b3ada0' : '#8d867a'); for (let k = 0; k < 6; k++) fx.smoke(e.px, c.y + 1.5, e.pz, 0.2, 2.2); }
      return;
    }
    if (skin && e.kind !== 'land') crashFx(fx, skin, b, e, carColor);
    if (c.p.lean && e.dv > 5 && !c.tum) c.tumble((Math.random() < 0.5 ? -1 : 1) * 3);   // a bike goes down on any real knock
  };
  car.ground = (x, z, y, h = car.h) => {
    let o = carG(x, z, y, h);
    if (o?.blocked && o.layer === 'building' && car.p.skid && debris.tearWalls(solid, x, z, h, car.p.halfW ?? 0.85, car.p.halfL ?? 2.2, car.y)) o = carG(x, z, y, h);   // boundary walls and fences go down under the dozer
    if (!o || o.blocked) return o;
    const f = debris.hit(x, z, h, car.p.halfW ?? 0.85, car.p.halfL ?? 2.2, car.v, o.y ?? o, car.p.skid); if (!f) return { ...o, blocked: true };
    car.v *= f; return o;
  };

  // helicopter: lands on the terrain only (sim/heli.js), stops when a building wall is under its rotor disc (camera/solid.js grid, 8 points
  // on the disc edge + the mast); drawn as instance 0 of traffic/helipads.js
  const RING = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]).concat([[0, 0]]);
  const heliWall = (x, z) => { const r = helis[hm].dims.rotor / 2 * 0.85; let m = -Infinity; for (const [a, b] of RING) m = Math.max(m, solid.at(x + a * r, z + b * r)); return m; };
  const heli = pads && new Heli(heliParams(helis[0]), (x, z, y) => cells.ground.terrain(x, z)?.y ?? y, heliWall);
  const vehicles = [{ kind: 'car', sim: car, mesh: carMesh, shadow: cShadow, spec: roads[model] }];
  if (heli) {
    const hs = blobShadow(mats, 1, 1); scene.add(hs);
    vehicles.push({ kind: 'heli', sim: heli, shadow: hs, spec: helis[0] });
  }
  /** the player's helicopter becomes model m / colour col (taking a parked one: the old one is parked in its place) */
  const setHeli = (m, col) => { hm = m; hCol = col; const s = helis[m], v = vehicles[1]; heli.p = heliParams(s, mult); v.spec = s; v.shadow.scale.set(s.dims.width * 0.8, 1, s.dims.length * 0.45); };
  if (heli) setHeli(0, hCol);
  const setModel = (i, col) => {   // the player's road vehicle: geometry, handling, shadow, camera; col: its paint (default: the catalogue's)
    model = (i + roads.length) % roads.length; const s = roads[model], v = vehicles[0]; carColor = col ?? (s.id === P.car ? P.carColor : s.palette[0]);
    const isDz = s.kind === 'dozer'; carMesh.geometry.dispose(); carMesh.geometry = buildVehicle(s, 0, isDz ? { part: 'body' } : {}); carMesh.setColorAt(0, new THREE.Color(carColor)); carMesh.instanceColor.needsUpdate = true;
    const cut = isDz ? null : cutDoor(carMesh.geometry, s); if (cut) { carMesh.geometry.dispose(); carMesh.geometry = cut.body; }   // driver's door as its own piece (vehicles/door.js)
    if (doorMesh) { carMesh.remove(doorMesh); doorMesh.geometry.dispose(); doorMesh = null; }
    if (cut) { doorMesh = new THREE.InstancedMesh(cut.door, vehMat, 1); doorMesh.position.set(...cut.hinge); doorMesh.setColorAt(0, new THREE.Color(carColor)); doorMesh.frustumCulled = false; carMesh.add(doorMesh); }
    board.setDoor(doorMesh, cut);
    skin = new Skin(carMesh.geometry, s); car.tum = null; car.lift = 0; rider.on = false;
    if (dz) { dz.blade.visible = dz.shoes.visible = isDz; dz.blade.setColorAt(0, new THREE.Color(carColor)); dz.blade.instanceColor.needsUpdate = true; }
    car.p = carParams(s, mult); v.spec = s; cShadow.scale.set(s.dims.width * 0.62, 1, s.dims.length * 0.55);
    if (inV === v) cam.c = camFor(C.camera, s);
    console.log(`[v2] vehículo: ${s.make} ${s.model} (${s.archetype})`);
  };

  let inV = null;
  let sitT = 0;   // getting in: a short seated pose by the door, then the walker is hidden
  const enter = v => { inV = v; sitT = 0.35; cam.c = camFor(C.camera, v.spec); };
  const exit = () => {
    const s = inV.sim; if (Math.abs(s.v) > P.exitMaxSpeed || s.landed === false || inV.kind === 'tram' && s.cur.doors < 0.5) return;   // the helicopter: once on the ground; the tram: doors open
    const side = inV.kind === 'heli' || inV.kind === 'tram' ? 2.2 : 1.7, back = (inV.spec.dims?.length ?? 4.4) / 2 + 0.8, c = Math.cos(s.h), n = Math.sin(s.h);
    // driver's door (left side), else the right side, behind, in front: the first spot that is not in a wall; none (a tight alley): stay in
    const spot = [[-c * side, n * side], [c * side, -n * side], [n * back, c * back], [-n * back, -c * back]].map(([a, b]) => [s.x + a, s.z + b]).find(([x, z]) => { const g = player.ground(x, z, s.y); return !g?.blocked && (inV.kind !== 'tram' || Math.abs((g?.y ?? g) - s.y) < 1.5); });   // the tram: only onto a platform at its floor
    if (inV === vehicles[0] && board.out(inV, () => {})) { inV = null; ped.visible = true; cam.c = C.camera; return; }   // animated: open the door, step out, close it (sim/board.js)
    if (!spot) return;
    player.place(spot[0], spot[1], s.h, s.y); inV = null; ped.visible = pShadow.visible = true; cam.c = C.camera;
  };
  onAction('enter', () => {
    if (paused() || board.busy) return;
    if (inV) return exit();
    let best = null, bd = P.enterRadius;
    for (const v of vehicles) { const d = Math.hypot(v.sim.x - player.x, v.sim.z - player.z) - (v.kind === 'heli' ? 2 : 0); if (d < bd) { bd = d; best = v; } }
    const tr = trams?.near(player.x, player.z, 2.5);   // by a tram with its doors open: ride it
    if (tr && tr.cur.doors > 0.5) return enter({ kind: 'tram', sim: tr, spec: TRAM });
    const pk = pads?.near(player.x, player.z, bd + 2);   // a parked helicopter is nearer: swap it with the player's (which parks where it stands)
    if (pk) { const o = { x: heli.x, z: heli.z, y: heli.y, h: heli.h, m: hm, col: hCol }; setHeli(pk.m, pk.col); heli.place(pk.x, pk.z, pk.h); Object.assign(pk, o, { ok: true }); best = vehicles[1]; }
    const ac = !pk && amb.nearest(player.x, player.z, bd);   // a parked or passing ambient car is nearer: take it (the player's car stays parked where it is)
    if (ac) { takeCar(ac.o); best = vehicles[0]; }
    if (best && !board.in(best, () => enter(best))) enter(best);   // own car / bike standing still: walk to the door and get in
  });
  const takeCar = o => {
    const t = amb.take(o), i = roads.findIndex(s => s.id === t.spec); if (i < 0) return;
    amb.park(roads[model].id, carColor, car.x, car.y, car.z, car.h);
    setModel(i, t.color); car.place(t.x, t.z, t.h, t.y + 0.5); car.v = t.v;
    if (t.traffic) { const c = Math.cos(t.h), n = Math.sin(t.h); drv.position.set(t.x - c * 1.6, t.y, t.z + n * 1.6); drv.rotation.y = t.h + Math.PI / 2 + Math.PI; drv.dir = [-c, n]; drv.t = 4.5; drv.visible = true; }   // out of the driver's door, walking off to the left
  };
  onAction('flip', () => { if (!paused() && inV === vehicles[0] && car.tum) { car.unflip(); rider.on = false; if (inV) ped.visible = pShadow.visible = false; } });
  const nextModel = () => { if (inV?.kind !== 'heli') setModel(model + 1); };
  onKey('KeyN', nextModel);   // debug: cycle the catalogue
  for (const c of C.cheats) onAction('cheat:' + c.code, () => {
    if (c.hour != null) { time.h = c.hour; time.apply(); }
    if (c.vehicle === 'next') nextModel();
    if (c.vehicle === 'dozer' && dzSpec) { const o = inV ? inV.sim : player, x = o.x - Math.sin(o.h) * 14, z = o.z - Math.cos(o.h) * 14; amb.park(dzSpec.id, dzSpec.palette[0], x, cells.ground.terrain(x, z)?.y ?? o.y, z, o.h + Math.PI); }   // a dozer parked in front of you: F to get in
    if (c.vehicle === 'heli' && heli && inV?.sim !== heli) { const o = inV ? inV.sim : player; heli.place(o.x - Math.sin(o.h) * 12, o.z - Math.cos(o.h) * 12, o.h); }   // brings the helicopter in front of you
    console.log(`[v2] truco ${c.code}: ${c.label}`);
  });
  setModel(model);

  /** the helicopter's pad: the nearest car-park helipad (parking_data.mjs keeps them free) within 600 m, else a free spot by the spawn */
  const placeHeli = () => {
    if (!heli) return;
    const T = (x, z) => cells.ground.terrain(x, z)?.y, flat = (x, z) => { const y = T(x, z); return y != null && [[6, 0], [-6, 0], [0, 6], [0, -6]].every(([a, b]) => Math.abs((T(x + a, z + b) ?? 1e9) - y) < 0.6); };
    let best = null, bd = 600;
    for (const [x, z, r] of park?.lots || []) { const d = Math.hypot(x - car.x, z - car.z); if (r >= 7 && d < bd && flat(x, z)) { bd = d; best = [x, z]; } }
    const [x, z] = best || [car.x + Math.cos(car.h) * 14, car.z - Math.sin(car.h) * 14]; heli.place(x, z, car.h);
    for (const s of pads.spots) if (Math.hypot(s.x - x, s.z - z) < 8) s.ok = false;   // that pad is the player's
  };

  // shortcut: yards = the 2 biggest open lots >= 300 m apart (no industrial / construction landuse baked); the dozer is parked there once its ground is resident
  const yards = (park?.lots || []).filter(l => l[2] >= 14).sort((a, b) => b[2] - a[2]).reduce((o, l) => o.length < 2 && o.every(y => Math.hypot(y.x - l[0], y.z - l[1]) > 300) ? [...o, { x: l[0], z: l[1], h: (l[0] * 7 + l[1] * 3) % 6.28 }] : o, []);
  const throwRider = () => {
    const s = car, fx0 = -Math.sin(s.h), fz0 = -Math.cos(s.h), side = Math.random() < 0.5 ? -1 : 1, c = Math.cos(s.h), n = Math.sin(s.h);
    Object.assign(rider, { on: true, t: 0, x: s.x, y: s.y + 1, z: s.z, vx: fx0 * s.v * 0.8 - c * side * 2, vy: 2.5 + Math.abs(s.v) * 0.15, vz: fz0 * s.v * 0.8 + n * side * 2, tilt: 0, w: side * (4 + Math.abs(s.v) * 0.3), h: s.h });
  };
  const riderFrame = dt => {
    const r = rider; r.t += dt; ped.visible = pShadow.visible = true;
    if (dt) {
      const gy = cells.ground.terrain(r.x, r.z)?.y ?? r.y - 1; r.vy -= 9.81 * dt; r.x += r.vx * dt; r.z += r.vz * dt; r.y += r.vy * dt;
      if (r.y <= gy) { r.y = gy; r.vy = r.vy < -3 ? -r.vy * 0.3 : 0; r.w *= 0.5; const sp = Math.hypot(r.vx, r.vz), f = sp ? Math.max(0, sp - 8 * dt) / sp : 0; r.vx *= f; r.vz *= f; r.tilt += (Math.round((r.tilt - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2 - r.tilt) * Math.min(1, dt * 8); } else r.tilt += r.w * dt;
    }
    ped.position.set(r.x, r.y, r.z); ped.rotation.set(r.tilt, r.h + Math.PI, 0, 'YXZ'); pShadow.position.set(r.x, r.y + 0.06, r.z); setPedAnim(ped, 0, 9, 0);
    if (r.t > 12) { r.on = false; if (inV) ped.visible = pShadow.visible = false; }
  };
  const yardTick = () => { for (const y of yards) if (!y.done && dzSpec) { const g = cells.ground.terrain(y.x, y.z); if (g) { y.done = true; amb.park(dzSpec.id, dzSpec.palette[0], y.x, g.y, y.z, y.h); } } };

  const api = {
    player, cam, solid, dbgWalls, vehicles, wrecks, fx, yards, get skin() { return skin; }, rider, ambient: amb, debris, heli, pads, roads, get model() { return model; }, setModel,
    get inCar() { return !!inV; }, trams, takeCar, setHeli, get carColor() { return carColor; },
    /** a tram with open doors within reach (ui/transit.js hint) */
    tramNear: () => !inV && trams?.near(player.x, player.z, 2.5)?.cur.doors > 0.5, get current() { return inV ? inV.sim : player; }, get inKind() { return inV?.kind ?? null; },
    /** place the player next to the first vehicle (spawn / after the ground loaded) */
    spawn() { const s = car; player.place(s.x - Math.cos(s.h) * 2.5, s.z + Math.sin(s.h) * 2.5, s.h, s.y); cam.reset(s.h); placeHeli(); },
    enter: i => { if (!inV) enter(vehicles[i]); },
    exit: () => { if (inV) exit(); },
    /** fixed step; drive overrides the controls of the occupied vehicle (autopilot) */
    step(h, drive) {
      const a = actions(), T = (x, z) => cells.ground.terrain(x, z);
      if ((C.speed || 1) !== mult) { mult = C.speed || 1; car.p = carParams(roads[model], mult); if (heli) heli.p = heliParams(helis[hm], mult); }
      trams?.step(h);
      for (const v of vehicles) {
        const me = v === inV, s = v.sim;
        const i = v.kind === 'heli' ? (me ? { throttle: a.throttle, steer: a.steer, up: a.jump, down: a.run, on: true } : { throttle: 0, steer: 0, up: 0, down: 0, on: false })
          : me ? drive || { throttle: a.throttle, steer: a.steer, brake: a.brake } : { throttle: 0, steer: 0, brake: 0 };   // parked: coasts to a stop
        if (s === car && (me || Math.abs(s.v) > 0.3)) wrecks.catchParked(amb, car, h);   // a parked car in the way becomes a wreck the impulse model can shove
        substep(s, h, i);   // walls and parked cars are never jumped over at high speed
        if (s === car) { amb.bump(car); wrecks.bump(car); if (me && car.tum && car.p.lean && !rider.on) throwRider(); }   // traffic and wrecks: mass impulse on both
        // streaming: ground under it or ~1.2 s ahead not resident yet (no heights, no walls there): slow down until it is
        const d = Math.max(15, Math.abs(s.v) * 1.2) * Math.sign(s.v);
        if (s.v && (!T(s.x, s.z) || !T(s.x - Math.sin(s.h) * d, s.z - Math.cos(s.h) * d))) s.v *= 1 - Math.min(1, 2.5 * h);
      }
      wrecks.update(h, inV ? inV.sim : player); yardTick();
      if (!inV) { const [dx, dz] = cam.moveDir(a.mx, a.my), b = board.step(h); if (b !== null) player.step(h, b ?? { dx, dz, run: a.run, jump: a.jump }); }
    },
    /** ambient cars around the focus (separate so boot.js can time it) */
    traffic(dt, t) {
      const obs = inV ? [] : [{ x: player.x, z: player.z, r: 0.5 }], skip = [];
      for (const v of vehicles) { const s = v.sim, r = v.kind === 'heli' ? 6 : (car.p.halfL ?? 2.2); obs.push({ x: s.x, z: s.z, r: Math.min(r, 3) }); if (v !== inV) skip.push([s.x, s.z, r + 2.5]); }
      trams?.points(obs);
      if (!dt) return;
      amb.update(dt, t, obs, skip);
      if (pads) pads.update(dt, t, (x, z) => cells.ground.terrain(x, z)?.y, (x, z) => solid.at(x, z), [heli.x, heli.z]);
    },
    /** per rendered frame: poll input, place meshes at the interpolated poses, move the camera. Returns the focus point. */
    frame(dt, alpha, camera, flying) {
      const a = poll(), look = takeLook();
      pedMat.userData.time.value += dt; vehMat.userData.time.value += dt; debris.update(dt);
      if (time.s?.light) fx.light = time.s.light; fx.update(dt); smokeTick(fx, skin, { x: car.x, y: car.y, z: car.z, h: car.h }, smokeSt, dt);
      trams?.update(dt, alpha, inV ? inV.sim : player, (x, z) => cells.ground.terrain(x, z)?.y);
      if (drv.visible) {
        const p = drv.position, w = 1.4 * dt; p.x += drv.dir[0] * w; p.z += drv.dir[1] * w; p.y = cells.ground.at(p.x, p.z, p.y + 0.5, FOOT).y;
        setPedAnim(drv, 0, 1, 0); if ((drv.t -= dt) <= 0) drv.visible = false;
      }
      if (time.s?.light) { pedMat.color.setRGB(...time.s.light); vehMat.color.copy(pedMat.color); vehMat.userData.night.value = Math.min(1, Math.max(0, (0.85 - time.s.sunInt) / 0.67)); }   // same night curve as render/world.js
      const A = actions(), cv = car.v, mine = inV === vehicles[0];   // player's car lamps: brake lights, indicators while turning slowly, off when parked
      setLights(carMesh, 0, mine ? (A.brake || A.throttle * cv < -0.1 && Math.abs(cv) > 0.5 ? 1 : 0) : -1, mine && Math.abs(cv) < 12 && Math.abs(A.steer) > 0.3 ? (A.steer * Math.sign(cv || 1) > 0 ? 1 : 2) : 0);
      for (const v of vehicles) {
        const p = v.sim.pose(alpha);
        if (v.kind === 'heli') pads.write(0, p.x, p.y, p.z, p.h, p.pitch, p.roll, p.spin, hm, hCol, inV === v ? 0 : -1);
        else { v.mesh.position.set(p.x, p.y, p.z); v.mesh.rotation.set(p.pitch || 0, p.h + Math.PI, p.roll || 0, 'YXZ'); }
        const gy = v.kind === 'heli' ? v.sim.gy : p.y; v.shadow.position.set(p.x, gy + 0.06, p.z); v.shadow.rotation.y = p.h; v.shadow.visible = p.y - gy < 60;
      }
      if (dz?.blade.visible) {   // blade with the keys (E up / Q down), track shoes run with the ground speed (+ turning)
        dz.ang = Math.max(-0.35, Math.min(0.03, dz.ang - a.blade * 0.45 * dt)); dz.blade.rotation.x = dz.ang; dz.s -= car.v * dt;
        const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), tx = car.p.track / 2;
        for (let k = 0; k < GROUSERS * 2; k++) { const sd = k < GROUSERS ? 1 : -1, [y, z, tl] = TRACK_PATH(dz.s * 1 + (k % GROUSERS) * TRACK_LOOP / GROUSERS - 0); dz.shoes.setMatrixAt(k, M.compose(p.set(sd * tx, y, z), q.setFromEuler(e.set(tl, 0, 0)), one)); }
        dz.shoes.instanceMatrix.needsUpdate = true;
      }
      const pp = player.pose(alpha);
      ped.position.set(pp.x, pp.y, pp.z); ped.rotation.set(inV ? 0 : pp.fl, pp.h + Math.PI, inV ? 0 : pp.lean, 'YXZ'); pShadow.position.set(pp.x, player.gy + 0.06, pp.z);
      // 3 jump, 4 swim (sea / marsh water: terrain at the bake's water level, y < 0.3), 5 seated (getting in), else idle..walk..run
      const wet = !player.air && pp.y < 0.3 && (cells.ground.terrain(pp.x, pp.z)?.y ?? 1) < 0.3;
      const onBike = inV && board.kind(inV) === 'bike';
      if (inV && sitT > 0 && (sitT -= dt) <= 0) { ped.visible = onBike; pShadow.visible = false; }   // a closed car hides its driver; a bike shows its rider
      avatar.mat.color.copy(pedMat.color); const seated = board.frame(dt, inV, carMesh);   // getting in / out, riding: posed in the vehicle frame
      if (rider.on) { avatar.rig.air(avatar.anim.T, { vy: -2, fall: rider.t < 1.2 ? 1 : 0.15, t: avatar.t }); avatar.update(dt, ['thrown', 0.3]); riderFrame(dt); }
      else avatar.update(dt, seated ?? avatar.walker(player, wet));   // the skinned protagonist: gait / jump / falls / swim (sim/avatar.js)
      const t = inV ? { ...inV.sim.pose(alpha), v: inV.sim.v, car: true } : { ...pp, v: player.v, car: false };
      const txt = !inV ? '' : inV.kind === 'tram' ? `${trams.nextStop(inV.sim)}${inV.sim.cur.doors > 0.5 ? ' · F bajar' : ''}` : `${Math.round(Math.abs(inV.sim.v) * 3.6)} km/h`;
      if (hud.textContent !== txt) { hud.textContent = txt; hud.hidden = !txt; }
      if (inV?.kind !== 'heli' && inV?.kind !== 'tram') dbgWalls.update(dt, inV ? { ...t, y: inV.sim.y, hw: car.p.halfW ?? 0.85, hl: car.p.halfL ?? 2.2 } : { ...t, y: player.y, h: 0, hw: 0.3, hl: 0.3 });
      if (!flying) {
        // the boom collides with the exact walls and, below the ground (car park, tunnel), the mover's own layer, and stays under its roof (camera/orbit.js)
        t.ceil = (inV ? inV.sim.ceil : player.ceil) ?? Infinity;
        const o = cam.update(dt, look, { x: a.lookX, y: a.lookY }, t, boomWorld(cells.ground, solid, t, FOOT));
        camera.position.set(o.x, o.y, o.z); camera.lookAt(o.tx, o.ty, o.tz);
      }
      return t;
    },
  };
  return api;
}
