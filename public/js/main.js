import * as THREE from 'three';
import { Minimap } from './minimap.js';
import { toLocal, toLonLat, clamp, angDiff } from './geo.js';
import { Heightfield, Mask, Terrain } from './terrain.js';
import { Buildings } from './buildings.js';
import { installProps } from './props.js';
import { Car, Heli, Chute, VEHICLES, topKmh } from './vehicles.js';
import { Parked } from './parked.js';
import { Walker } from './walker.js';
import { Tram } from './tram.js';
import { makeCorridor } from './corridor.js';
import { Npcs, loadNpcData } from './npcs.js';
import { Sea, analyzeSea, SEA_LEVEL } from './sea.js';
import { Traffic } from './traffic.js';
import { Monuments } from './monuments.js';
import { Plazas } from './plazas.js';
import { Landmarks } from './landmarks.js';
import { PlazaMayor, flattenPlaza } from './plazamayor.js';
import { Places } from './places.js';
import { VenueSpecs } from './venues3d.js';
import { Football } from './football.js';
import { Courts } from './courts.js';
import { Furniture } from './furniture.js';
import { Parks } from './parks.js';
import { Stairs } from './stairs.js';
import { Sancti } from './sancti.js';
import { World } from './world.js';
import { Underground } from './underground.js';
import { Net, tint, BASE } from './net.js';
import { Diag } from './diag.js';
import { PerfPanel } from './perfpanel.js';
import { PlacesIndex } from './placesIndex.js';
import { batchStatic } from './batch.js';
import { MAP } from './maps.js';
import { GameAudio } from './audio.js';
import { Ragdolls } from './ragdoll.js';

const $ = id => document.getElementById(id);
const BOOT = window.__boot = [];
const setStatus = (t, p) => { BOOT.push([Math.round(performance.now()), t]); $('status').textContent = t; if (p != null) $('bar').firstElementChild.style.width = (p * 100).toFixed(0) + '%'; };

// sRGB triples used both for the scene and for the hand-written terrain shader (which works in raw sRGB)
const HORIZON = [0.74, 0.82, 0.88], ZENITH = [0.22, 0.43, 0.72];
const FOG_DENSITY = 1 / 3800;   // dense enough that nothing beyond ~7 km is visible -> the cost no longer depends on where the camera looks

// ---------------------------------------------------------------- quality presets
const QUALITY = {
  alta:  { name: 'Alta',  pr: Math.min(devicePixelRatio, 1.25), split: 1.2, maxTex: 1100, maxDist: 6000, bld: { r0: 500, r1: 2000, r2: 5000 }, world: { roadR: 600, treeR: 350, carR: 220, wallR: 400, treeMax: 1400, treeCap: 1200 }, lod: 1 },
  media: { name: 'Media', pr: 1,                               split: 1.0, maxTex: 750, maxDist: 5000, bld: { r0: 350, r1: 1400, r2: 3500 }, world: { roadR: 420, treeR: 220, carR: 140, wallR: 280, treeMax: 800, treeCap: 700 }, lod: 0.7 },
  baja:  { name: 'Baja',  pr: 0.75,                            split: 0.8, maxTex: 450, maxDist: 3500, bld: { r0: 200, r1: 800,  r2: 2500 }, world: { roadR: 260, treeR: 120, carR: 90, wallR: 150, treeMax: 300, treeCap: 300 }, lod: 0.4 },
  minima: { name: 'Mínima', pr: 0.6,                           split: 0.55, maxTex: 220, maxDist: 2500, bld: { r0: 150, r1: 500, r2: 1500 }, world: { roadR: 160, treeR: 40, carR: 50, wallR: 40, treeMax: 60, treeCap: 60 }, lod: 0.2, lite: true },
};
const LITE = new URLSearchParams(location.search).has('lite');
let qKey = LITE ? 'minima' : (localStorage.getItem('chiclana.q') || 'alta'); if (!QUALITY[qKey]) qKey = 'alta';
let resScale = 1;

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 1.0, 9000);
const diag = new Diag(renderer);
scene.background = new THREE.Color().setRGB(...HORIZON, THREE.SRGBColorSpace);
scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...HORIZON, THREE.SRGBColorSpace), FOG_DENSITY);
function applyRes() { renderer.setPixelRatio(QUALITY[qKey].pr * resScale); renderer.setSize(innerWidth, innerHeight); }
applyRes();
addEventListener('resize', () => { applyRes(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x8a8068, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.position.set(0.5, 0.8, 0.35); scene.add(sun);

const sky = new THREE.Mesh(new THREE.SphereGeometry(24000, 24, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { hor: { value: new THREE.Vector3(...HORIZON) }, zen: { value: new THREE.Vector3(...ZENITH) } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 hor; uniform vec3 zen; varying vec3 vD; void main(){ float h = clamp(normalize(vD).y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, zen, pow(h, 0.55)), 1.0); }',
}));
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

// ---------------------------------------------------------------- load
setStatus('Descargando límites municipales…', 0.02);
const boundary = await (await fetch('/data/boundary.json')).json();
const SEA_MARGIN = 3500;    // metres of open sea (and islets) kept playable beyond the municipal limit
if (MAP.sea) { const b = boundary.bounds; boundary.bounds = [b[0] - 0.05, b[1] - 0.035, b[2], b[3]]; }   // open sea margin (Chiclana only)
const hf = new Heightfield(boundary.bounds);
await hf.load(p => setStatus(`Cargando relieve… ${(p * 100) | 0}%`, 0.05 + p * 0.35));
setStatus('Construyendo máscara del término municipal…', 0.42);
const sancti = new Sancti(hf); try { await sancti.load(); } catch (e) { console.warn('sancti', e); }
let plazaSpec = null;   // Plaza Mayor: level the DEM under the square before terrain/buildings/roads read it
try { plazaSpec = await (await fetch('/data/plaza_mayor_spec.json')).json(); window.__plazaFlat = flattenPlaza(hf, plazaSpec); } catch (e) { console.warn('plaza flatten', e); }
let osmPre = null;   // Madrid: level the DEM under the carriageways (roadlevel.js) before anything reads it
if (MAP.id === 'madrid') try { osmPre = await (await fetch('/data/osm.json')).json(); window.__roadLevel = (await import('./roadlevel.js')).levelRoads(hf, osmPre); } catch (e) { console.warn('road level', e); }
let ug = null;   // underground ways + car parks (carves the DEM, so before the terrain exists)
try { const r = await fetch('/data/underground.json'); if (r.ok) { ug = new Underground(scene, hf, await r.json()); ug.carve(); window.__ug = ug; } } catch (e) { console.warn('underground', e); }
const seaInfo = analyzeSea(hf);
const zNorth = toLocal(-6.1, 36.395)[1];   // do not open the San Fernando marshes to the north
const mask = new Mask(boundary, { margin: SEA_MARGIN, unlock: (x, z) => z > zNorth && (hf.height(x, z) <= SEA_LEVEL + 2.5 || seaInfo.isSmallLand(x, z)) });

const terrain = new Terrain(scene, hf, mask, { color: HORIZON, density: FOG_DENSITY });
if (ug) ug.terrain = terrain;   // tunnel footprint hole in the ground while the camera is underground
const SUN = terrain.shared.sunDir.value;
const sea = new Sea(scene, hf, mask, seaInfo, { color: HORIZON, density: FOG_DENSITY }, SUN);

let buildings = null;
try {
  setStatus('Cargando edificios del Catastro…', 0.5);
  const r = await fetch('/data/buildings.bin');
  if (r.ok) {
    const buf = await r.arrayBuffer();
    setStatus('Colocando 100 000 edificios sobre el relieve…', 0.6);
    await new Promise(r => setTimeout(r, 30));
    const rr = await fetch('/data/roofs.bin');
    const roofs = rr.ok ? new Uint8Array(await rr.arrayBuffer()) : null;
    let facades = null; try { const fr = await fetch('/data/facades.bin'); if (fr.ok) facades = new Uint8Array(await fr.arrayBuffer()); } catch {}
    buildings = new Buildings(scene, hf, buf, roofs, facades);
  }
} catch (e) { console.warn('no buildings', e); }
let tramData = null, npcs = null, streets = null, traffic = null, monuments = null, plazas = null, landmarks = null, venueSpecs = null, plazaMayor = null, placeEng = null, football = null, courts = null, parks = null, parked = null, pitches = [];
try {
  setStatus('Construyendo calles, aceras y puentes…', 0.72);
  const osm = osmPre || await (await fetch('/data/osm.json')).json();
  setStatus('Cargando vegetación detectada…', 0.76);
  const veg = {};
  try {
    const ub = await (await fetch('/data/urban.bin')).arrayBuffer(); terrain.setUrban(ub); try { terrain.setLand(await (await fetch('/data/landclass.bin')).arrayBuffer()); } catch (e) { console.warn('no landclass', e); }
    const f = new Float32Array(ub, 0, 2); veg.grassOrigin = [f[0], f[1]];
    // trees: prefer the compact per-cell pack (scripts/pack_world.mjs, ~6 MB) over the raw 32 MB list
    try { const tr = await fetch('/data/trees_cells.bin'); if (tr.ok) { const ab = await tr.arrayBuffer(); if (new Uint32Array(ab, 0, 1)[0] === 0x31435254) veg.treeCells = ab; } } catch {}
    if (!veg.treeCells) veg.trees = new Float32Array(await (await fetch('/data/trees.bin')).arrayBuffer());
    veg.grass = new Uint16Array(await (await fetch('/data/grass.bin')).arrayBuffer());
    try { veg.land = await (await fetch('/data/landclass.bin')).arrayBuffer(); } catch {}
    try { veg.walls = new Float32Array(await (await fetch('/data/walls.bin')).arrayBuffer()); } catch {}
    try {   // pools.bin v2: 'POOL', n, then records [u8 m,pad3, f32 cx,cz,rgbPacked,area, m*(x,z)] -> {x,z, rgb:[0..1], pts:Float32Array}
      const ab = await (await fetch('/data/pools.bin')).arrayBuffer(), dv = new DataView(ab), list = [];
      if (dv.getUint32(0, true) === 0x4c4f4f50) for (let o = 8, n = dv.getUint32(4, true), q = 0; q < n; q++) {
        const m = dv.getUint8(o); o += 4; const f = new Float32Array(ab.slice(o, o + (4 + 2 * m) * 4)); o += (4 + 2 * m) * 4; const rgb = f[2] | 0;
        list.push({ x: f[0], z: f[1], rgb: [(rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255], pts: f.subarray(4) });
      }
      veg.pools = list;
    } catch {}
  } catch (e) { console.warn('no vegetation data', e); }
  if (MAP.id !== 'madrid') try { tramData = await (await fetch('/data/tram/tram.json')).json(); } catch (e) { console.warn('tram data', e); }
  streets = new World(scene, hf, buildings, osm, sea.inlandMaterial(), veg);
  if (ug) { streets.ug = ug; if (buildings) buildings.ug = ug; }
  if (tramData) streets.keep = makeCorridor(tramData);
  if (MAP.id === 'madrid') streets.keep = (x, z) => !mask.inside(x, z);   // Madrid: no pavement / trees / walls / lamps beyond the M-30 ring, where the ground fades into the haze   // nothing (pavement, trees, walls, lamps) on the tram corridor
  traffic = new Traffic(scene, streets);
  try { npcs = new Npcs(scene, streets, await loadNpcData()); } catch (e) { console.warn('npcs', e); }
  try { monuments = new Monuments(scene, hf, await (await fetch('/data/poi.json')).json(), await (await fetch('/data/plaza_mayor.json')).json()); } catch (e) { console.warn('no monuments', e); }
  try { plazas = new Plazas(scene, hf, await (await fetch('/data/plazas.json')).json()); } catch (e) { console.warn('no plazas', e); }
  try { landmarks = new Landmarks(scene, hf, buildings, await (await fetch('/data/landmarks_osm.json')).json()); } catch (e) { console.warn('no landmarks', e); }
  if (MAP.id !== 'madrid') try { plazaMayor = new PlazaMayor(scene, hf, buildings, plazaSpec || await (await fetch('/data/plaza_mayor_spec.json')).json(), osm); window.__plazaMayor = plazaMayor; } catch (e) { console.warn('no plaza mayor', e); }
  try { placeEng = new Places(scene, hf, buildings, osm); window.__placeEng = placeEng; } catch (e) { console.warn('no places', e); }
  try { venueSpecs = new VenueSpecs(scene, hf, buildings, await (await fetch(MAP.base + 'venue_specs.json')).json(), landmarks); window.__venueSpecs = venueSpecs; } catch (e) { console.warn('no venue specs', e); }
  try { const fj = await (await fetch('/data/football.json')).json(); football = new Football(scene, hf, buildings, fj); pitches = football.items.map(i => i.f); window.__football = football; } catch (e) { console.warn('no football', e); }
  try { courts = new Courts(scene, hf, await (await fetch('/data/courts.json')).json()); } catch (e) { console.warn('no courts', e); }
  try { new Furniture(scene, hf, await (await fetch('/data/promenade_raw.json')).json()); } catch (e) { console.warn('no furniture', e); }
  try { parks = new Parks(scene, hf, await (await fetch('/data/parks_all.json')).json()); } catch (e) { console.warn('no parks', e); }
  if (MAP.id === 'madrid') try { const { Bernabeu } = await import('./bernabeu.js'); const bd = await (await fetch('/data/bernabeu_osm.json')).json(); window.__bernabeu = new Bernabeu(scene, hf, buildings, bd); const { Events } = await import('./events.js'); window.__events = new Events(scene, hf, await (await fetch('/data/events.json')).json(), window.__bernabeu, (x, z) => travelTo(x, z)); window.__events.set('partido', true); } catch (e) { console.warn('no bernabeu', e); }
  if (MAP.id === 'madrid') try { const r = await fetch('/data/metro.json'); if (r.ok) { const { Metro } = await import('./metro.js'); window.__metro = new Metro(scene, hf, await r.json(), await (await fetch('/data/boundary.json')).json(), (x, z) => travelTo(x, z)); if (ug) ug.pit = (x, z) => window.__metro.pit(x, z); } } catch (e) { console.warn('no metro', e); }
  try { window.__stairs = new Stairs(scene, hf, osm); } catch (e) { console.warn('no stairs', e); }
} catch (e) { console.warn('no streets', e); }
try { sancti.attach(scene, streets, buildings); } catch (e) { console.warn('sancti attach', e); }
installProps(buildings);   // plaza / monument solids -> buildings.hit
const world = { hf, buildings, mask, roads: streets, surf: (x, z, y, foot) => streets ? streets.surf(x, z, y, foot) : hf.height(x, z) };
if (streets) parked = new Parked(scene, world, pitches);   // needs world.roads / world.surf / world.buildings

// ---------------------------------------------------------------- per-mode view distance (V switches car -> heli -> walker)
// on foot: short range, high detail near; car: in between; heli: far but cheap (few facades, no small props). Every number is a multiple/cap of the quality preset
// and eases towards its target after a V switch, so nothing pops.
// ---- settings (gear button, bottom right). Stored in localStorage.
const OPT = { mouse: 1, pad: 1, smooth: 1, dead: 0.15, invY: false, view: 1, traffic: 1, npcs: 1, mph: false, hint: true, vol: 0.7, mute: false };
try { Object.assign(OPT, JSON.parse(localStorage.getItem('chiclana.opts') || '{}')); } catch {}
for (const k of ['mouse', 'pad', 'smooth', 'dead', 'view']) if (!(OPT[k] > 0)) OPT[k] = k === 'dead' ? 0.15 : 1;
if (!(OPT.traffic >= 0)) OPT.traffic = 1;
if (!(OPT.vol >= 0)) OPT.vol = 0.7;
const audio = new GameAudio(OPT, MAP.id === 'madrid' ? [{ x: toLocal(-3.68835, 40.45309)[0], z: toLocal(-3.68835, 40.45309)[1] }] : [{ x: -3855.4, z: -2443.3 }, { x: -2819.9, z: -1167.1 }]);   // stadiums with a match loop: Chiclana CF (Municipal, Huerta Mata) / Bernabéu
let viewMode = 'heli', vt = {}, view = {};
function viewTarget() {
  const q = QUALITY[qKey], w = q.world, b = q.bld, m = viewMode, L = q.lite ? 0.8 : 1;
  const P = {
    walker: { fog: 1 / 850, maxDist: Math.min(q.maxDist, 1800), split: q.split * 1.3, r0: Math.min(b.r0, 420), r1: Math.min(b.r1, 900), r2: Math.min(b.r2, 1400), roadR: Math.min(w.roadR, 460), treeR: Math.min(w.treeR, 420), carR: Math.min(w.carR, 260), wallR: Math.min(w.wallR, 300), treeMax: w.treeMax, treeCap: w.treeCap },
    car:    { fog: 1 / 2200, maxDist: Math.min(q.maxDist, 3800), split: q.split, r0: b.r0 * 0.8, r1: Math.min(b.r1, 1900), r2: Math.min(b.r2, 3300), roadR: w.roadR, treeR: w.treeR, carR: w.carR, wallR: w.wallR, treeMax: w.treeMax, treeCap: w.treeCap },
    heli:   { fog: 1 / (3400 * L + 600 * (1 - L)), maxDist: q.maxDist * 1.1, split: q.split * 0.7, r0: b.r0 * 0.3, r1: b.r1 * 0.9, r2: Math.min(b.r2 * 1.4, 7500), roadR: Math.min(w.roadR * 1.2, 1100), treeR: Math.min(w.treeR, 140), carR: 40, wallR: 30, treeMax: Math.round(w.treeMax * 0.4), treeCap: Math.round(w.treeCap * 0.4) },
  }[m];
  if (MAP.id === 'madrid') { P.r0 *= 0.6; P.treeCap *= 2; P.treeMax *= 2;if (m === 'heli') P.treeR = Math.min(w.roadR, 600); }   // Madrid: 860 k detected trees, denser cells; from the air the parks (Retiro, Casa de Campo edge) must not go bald
  if (OPT.view !== 1) { for (const k of ['maxDist', 'r0', 'r1', 'r2', 'roadR', 'treeR', 'carR', 'wallR']) P[k] *= OPT.view; P.fog /= OPT.view; }   // setting: view distance
  vt = P;
}
function applyView() {
  const v = view;
  scene.fog.density = v.fog; terrain.shared.fogDensity.value = v.fog; sea.shared.fogDensity.value = v.fog;
  terrain.settings.maxDist = v.maxDist; terrain.settings.split = v.split;
  if (buildings) Object.assign(buildings.settings, { r0: v.r0, r1: v.r1, r2: v.r2 });
  if (streets) Object.assign(streets.settings, { roadR: v.roadR, treeR: v.treeR, carR: v.carR, wallR: v.wallR, treeMax: Math.round(v.treeMax), treeCap: Math.round(v.treeCap) });
}
function easeView(dt) {
  let moved = false; const k = 1 - Math.exp(-dt * 1.6);
  for (const key in vt) { const a = view[key], b = vt[key]; if (a === undefined) { view[key] = b; continue; } const d = b - a; if (Math.abs(d) > Math.abs(b) * 0.004) { view[key] = a + d * k; moved = true; } else view[key] = b; }
  if (moved) { applyView(); if (streets && (this_t = (this_t || 0) + dt) > 0.4) { this_t = 0; streets.dirty = true; } }
}
let this_t = 0;
function applyQuality() {
  const q = QUALITY[qKey];
  window.__lodK = q.lod; terrain.shared.lite.value = q.lite ? 1 : 0; sea.shared.lite.value = q.lite ? 1 : 0;
  terrain.settings.maxTex = q.maxTex;
  viewTarget(); view = { ...vt };   // quality change: jump straight to the per-mode targets
  applyView(); if (streets) streets.dirty = true;
  resScale = 1; applyRes();
  try { localStorage.setItem('chiclana.q', qKey); } catch {}
}
applyQuality();

// ---------------------------------------------------------------- vehicles
const PLAZA = toLocal(...MAP.start);
const car = new Car(world), heli = new Heli(world), walker = new Walker(world), chute = new Chute(world);
scene.add(car.group, heli.group, walker.group, chute.group);
let tram = null; if (MAP.id !== 'madrid') try { tram = new Tram(scene, world, walker, tramData || await (await fetch('/data/tram/tram.json')).json()); } catch (e) { console.warn('tram', e); }
const rag = streets ? new Ragdolls(scene, streets, audio) : null;   // knock-downs (NPCs / player on foot) and breakable trees
car.group.visible = heli.group.visible = false;   // the player starts on foot; vehicles appear when boarded
const carHome = () => { const r = streets?.nearestRoad(PLAZA[0], PLAZA[1]); r ? car.place(r.x, r.z, r.psi) : car.place(PLAZA[0] + 30, PLAZA[1] + 20, 0); };
carHome();
const heliHome = () => heli.place(PLAZA[0], hf.height(...PLAZA) + 120, PLAZA[1], Math.PI * 0.75);
heliHome();
// modes: walker | car | heli | chute (free fall / parachute, walker body drawn at chute.pos) | rider (passenger in another player's vehicle, `puppet` follows it)
const puppet = { pos: new THREE.Vector3(), psi: 0, speed: 0, velocityKmh: 0, group: new THREE.Group(), update() {} };
let acc = 0, active = walker, mode = 'walker', curVeh = null, rideDrv = null;
const MODES = { car, heli, walker, chute, rider: puppet };
const net = new Net({ scene, world, getActive: () => mode === 'chute' ? { obj: walker, mode: 'walker' } : { obj: active, mode },
  setLocalColor: c => { for (const k of ['car', 'heli', 'walker']) tint(MODES[k].group, c, BASE[k]); if (curVeh) curVeh.color = c; } });
try { const t = +localStorage.getItem('chiclana.veh'); if (t >= 0 && t < VEHICLES.length) { car.setType(t); tint(car.group, net.color, BASE.car); } } catch {}

// ---- go to address: exact "street number" match against the Catastro address database
let addrDb = null;
const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const TYPES = { CALLE: 'CL', AVENIDA: 'AV', AVDA: 'AV', PLAZA: 'PZ', PASEO: 'PS', CAMINO: 'CM', CARRETERA: 'CR', URBANIZACION: 'UR', PASAJE: 'PJ', RONDA: 'RD', TRAVESIA: 'TR', CALLEJON: 'CJ', BARRIADA: 'BO', POLIGONO: 'PG', SENDA: 'SD', VIA: 'VI', GLORIETA: 'GL' };
async function loadAddr() {
  if (addrDb) return addrDb;
  const list = await (await fetch('/data/addresses.json')).json(); addrDb = new Map();
  for (const st of list) {
    const [type, ...rest] = st.n.split(' '), nm = norm(rest.join(' '));
    addrDb.set(norm(st.n), st); if (!addrDb.has(nm)) addrDb.set(nm, st);
  }
  $('streetList').innerHTML = list.map(st => `<option value="${st.n.split(' ').slice(1).join(' ')}">`).join('');
  return addrDb;
}
function gotoAddress(text) {
  const m = norm(text).match(/^(.*?)[ ,]+(\d+\s?[A-Z]?)$/), msg = $('gotoMsg'), bad = t => { msg.textContent = t; msg.className = 'err'; return false; };
  if (!m) return bad('Escribe calle y número');
  let name = m[1], num = m[2].replace(/\s/g, '');
  const w = name.split(' '); if (TYPES[w[0]]) name = TYPES[w[0]] + ' ' + w.slice(1).join(' ');
  const st = addrDb.get(name); if (!st) return bad(`No existe la calle «${m[1]}»`);
  const pt = st.a[num]; if (!pt) return bad(`${st.n}: no existe el número ${num}`);
  const [x, z] = pt; if (mode === 'chute' || mode === 'rider') toFoot();
  if (mode === 'car') { const r = streets?.nearestRoad(x, z, 80); r ? car.place(r.x, r.z, r.psi) : car.place(x, z, 0); }
  else if (mode === 'walker') walker.place(x, z, walker.psi);
  else heli.place(x, hf.height(x, z) + 60, z, Math.PI * 0.75);
  camSnap = true; msg.textContent = `${st.n} ${num} ✓`; msg.className = ''; return true;
}
// ---- venues (OSM): bars, restaurants, schools, town hall, hotels... searchable by name (accent/case-insensitive, fuzzy by tokens)
let venues = null, sugList = [], sugSel = -1;
const ICON = { bar: '🍺', restaurante: '🍽️', 'cafetería': '☕', 'comida rápida': '🍔', 'heladería': '🍦', discoteca: '🎶', colegio: '🏫', instituto: '🎓', ayuntamiento: '🏛️', hotel: '🏨', iglesia: '⛪', farmacia: '💊', supermercado: '🛒', bodega: '🍷', museo: '🖼️', mercado: '🧺' };
async function loadVenues() {
  if (venues) return venues;
  try { venues = (await (await fetch('/data/venues.json')).json()).map(v => ({ ...v, k: norm(v.n + ' ' + v.t + ' ' + (v.c || '') + ' ' + (v.a || '')) })); } catch { venues = []; }
  return venues;
}
function searchVenues(text) {
  const q = norm(text).split(' ').filter(w => w.length > 0); if (!venues || !q.length || norm(text).length < 2) return [];
  const sc = [];
  for (const v of venues) { let s = 0, ok = true; for (const w of q) { const i = v.k.indexOf(w); if (i < 0) { ok = false; break; } s += (i === 0 || v.k[i - 1] === ' ' ? 2 : 1) - i * 0.001; } if (ok) sc.push([s - v.n.length * 0.002, v]); }
  return sc.sort((a, b) => b[0] - a[0]).slice(0, 8).map(a => a[1]);
}
function renderSug() {
  const el = $('gotoSug'); el.innerHTML = '';
  sugList.forEach((v, i) => { const d = document.createElement('div'); if (i === sugSel) d.className = 'sel'; d.innerHTML = `<span>${ICON[v.t] || '📍'} </span><span style="flex:1"></span><i></i>`; d.children[1].textContent = v.n; d.children[2].textContent = v.t + (v.a ? ' · ' + v.a : ''); d.addEventListener('mousedown', e => { e.preventDefault(); gotoVenue(v); }); el.appendChild(d); });
}
function travelTo(x, z) {   // teleport the active vehicle/walker next to local (x,z); shared by the venue search and the places index
  if (mode === 'chute' || mode === 'rider') toFoot();
  const r = streets?.nearestRoad(x, z, 70), sx = r ? r.x : x, sz = r ? r.z : z;     // stand on the nearest street, facing the place
  const psi = Math.atan2(-(x - sx), -(z - sz));
  if (mode === 'car') { r ? car.place(r.x, r.z, r.psi) : car.place(x, z, 0); }
  else if (mode === 'walker') walker.place(sx, sz, Math.hypot(x - sx, z - sz) > 1 ? psi : walker.psi);
  else heli.place(x, hf.height(x, z) + 60, z, Math.PI * 0.75);
  camSnap = true;
}
function gotoVenue(v) {
  const [x, z] = toLocal(v.lon, v.lat), msg = $('gotoMsg');
  travelTo(x, z);
  msg.textContent = `${v.n} (${v.t}) ✓`; msg.className = ''; $('gotoSug').innerHTML = ''; sugList = []; setTimeout(() => openGoto(false), 600);
}
const gotoEl = $('goto'), gotoIn = $('gotoIn');
function openGoto(v) { gotoEl.style.display = v ? 'block' : 'none'; if (v) { for (const k in keys) keys[k] = false; gotoIn.value = ''; $('gotoMsg').className = ''; $('gotoSug').innerHTML = ''; sugList = []; sugSel = -1; gotoIn.focus(); loadAddr(); loadVenues(); } else gotoIn.blur(); }
gotoIn.addEventListener('input', async () => { await loadVenues(); sugList = searchVenues(gotoIn.value); sugSel = -1; renderSug(); });
gotoIn.addEventListener('keydown', async e => {
  e.stopPropagation();
  if (e.code === 'Escape') openGoto(false);
  else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { if (sugList.length) { e.preventDefault(); sugSel = (sugSel + (e.code === 'ArrowDown' ? 1 : -1) + sugList.length) % sugList.length; renderSug(); } }
  else if (e.code === 'Enter') {
    await Promise.all([loadAddr(), loadVenues()]);
    if (sugSel >= 0 && sugList[sugSel]) return gotoVenue(sugList[sugSel]);
    if (/\d/.test(gotoIn.value) && gotoAddress(gotoIn.value)) return setTimeout(() => openGoto(false), 600);
    const l = searchVenues(gotoIn.value); if (l.length) return gotoVenue(l[0]);
    if (!/\d/.test(gotoIn.value)) gotoAddress(gotoIn.value);
  }
});
gotoIn.addEventListener('keyup', e => e.stopPropagation());

const places = new PlacesIndex({ getPos: () => active.pos, travel: (x, z, label) => { travelTo(x, z); $('gotoMsg').textContent = label + ' ✓'; }, onOpen: () => { for (const k in keys) keys[k] = false; if (gotoEl.style.display !== 'none') openGoto(false); } });
window.__places = places;

const keys = {}; let hTaps = 0, hLast = 0, vTaps = 0, vLast = 0, debugUi = false;
addEventListener('keydown', e => {
  if (e.target === gotoIn) return;
  if (e.code === 'KeyY' && !e.repeat && net.id) { e.preventDefault(); net.openChat(); return; }   // proximity chat (Enter is the go-to box)
  if (e.code === 'Enter' && !e.repeat) { e.preventDefault(); openGoto(true); return; }
  keys[e.code] = true; if (ARROW[e.code]) { keys[ARROW[e.code]] = true; e.preventDefault(); }   // arrows = WASD
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyT' && tram) tram.wantRoof = true;           // climb onto / off a tram roof
  if (e.code === 'KeyE') { if (tram) tram.want = true; interact(); }                           // board / leave
  if (e.code === 'KeyH') { const n = performance.now(); hTaps = n - hLast < 650 ? hTaps + 1 : 1; hLast = n; if (hTaps >= 3) { hTaps = 0; secretHeli(); } }   // secret: H H H = a helicopter next to you
  if (e.code === 'KeyV') { vTaps = performance.now() - vLast < 650 ? vTaps + 1 : 1; vLast = performance.now(); if (vTaps >= 3) { vTaps = 0; debugUi = !debugUi; vehEl.querySelector('#vehGrid').style.display = debugUi ? '' : 'none'; } switchVehicle(); }   // debug: V cycles vehicles, V V V shows the old selector
  if (e.code === 'KeyC') cycleCamera();
  if (e.code === 'KeyR') resetHome();
  if (e.code === 'Escape') toggleOpts(false);
});
const ARROW = { ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD' };
addEventListener('keyup', e => { if (e.target !== gotoIn) { keys[e.code] = false; if (ARROW[e.code]) keys[ARROW[e.code]] = false; } });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const MOTO = Math.max(0, VEHICLES.findIndex(v => v.id === 'moto'));
function walkerHome() { const r = streets?.nearestRoad(PLAZA[0], PLAZA[1], 200); r ? walker.place(r.x, r.z, r.psi) : walker.place(PLAZA[0] + 6, PLAZA[1] + 6, Math.PI * 0.75); return r; }   // on the street (the old fixed point was inside a building)
function resetHome() {
  if (mode === 'rider') { rideDrv = null; net.board(0); setMode('walker'); } else if (mode === 'chute') setMode('walker');
  if (mode === 'car') carHome(); else if (mode === 'walker') walkerHome(); else heliHome(); camSnap = true;
}
function setMode(next) {
  mode = next; active = MODES[next]; acc = 0;
  viewMode = next === 'rider' ? (rideDrv?.mode === 'heli' ? 'heli' : 'car') : next === 'chute' ? 'heli' : next; viewTarget();
  walker.group.visible = next === 'walker' || next === 'chute'; car.group.visible = next === 'car'; heli.group.visible = next === 'heli'; chute.group.visible = next === 'chute';
  if (next !== 'walker' && next !== 'chute') walker.fp = false;
  camSnap = true; syncVehUi();
}
/** pick what to drive (debug selector / V): 'walker' | 'heli' | index into VEHICLES. Continues from where the previous one was (cars snap to the nearest road). */
function selectVehicle(sel) {
  const next = sel === 'heli' || sel === 'walker' ? sel : 'car';
  if (next === mode && (next !== 'car' || sel === car.type)) return;
  if (mode === 'rider') { rideDrv = null; net.board(0); }
  const p = active.pos.clone(), psi = active.psi;
  if (next === 'car') { car.setType(sel); tint(car.group, net.color, BASE.car); try { localStorage.setItem('chiclana.veh', sel); } catch {} }
  if (next !== mode) {
    if (next === 'heli') heli.place(p.x, p.y + 25, p.z, psi);
    else if (next === 'walker') walker.place(p.x, p.z, psi);
    else { const r = streets?.nearestRoad(p.x, p.z, 120); r ? car.place(r.x, r.z, r.psi) : car.place(p.x, p.z, psi); }
    curVeh = null; setMode(next);
  }
  syncVehUi();
}
// ---- on foot <-> vehicles. E (gamepad Y) boards the nearest parked vehicle / another player's vehicle and gets out again.
function toFoot() { if (mode === 'rider') { rideDrv = null; net.board(0); } const p = active.pos.clone(); walker.place(p.x, p.z, active.psi); walker.pos.y = Math.max(walker.pos.y, p.y); setMode('walker'); }
function enter(e) {
  parked.take(e);
  if (e.kind === 'heli') { heli.place(e.x, e.y, e.z, e.psi); tint(heli.group, e.color, BASE.heli); curVeh = { kind: 'heli', color: e.color }; setMode('heli'); }
  else { car.setType(e.type); tint(car.group, e.color, BASE.car); car.place(e.x, e.z, e.psi); curVeh = { kind: 'car', type: e.type, color: e.color }; setMode('car'); }
}
function exitCar() {
  if (Math.abs(car.speed) * 3.6 > 30) return toast('Frena para bajar');
  const fx = -Math.sin(car.psi), fz = -Math.cos(car.psi), half = car.spec.W / 2 + 0.9; let spot = null;
  for (const [sx, sz] of [[fz, -fx], [-fz, fx], [-fx, -fz], [fx, fz]]) {   // left door, right door, behind, in front
    const x = car.pos.x + sx * half, z = car.pos.z + sz * half; if (!walker.blocked(x, z, walker.groundAt(x, z, car.pos.y))) { spot = [x, z]; break; }
  }
  spot ||= [car.pos.x + fz * half, car.pos.z - fx * half];
  parked.drop('car', car.type, car.pos.x, car.pos.y, car.pos.z, car.psi, curVeh?.color ?? net.color);
  walker.place(spot[0], spot[1], car.psi); curVeh = null; setMode('walker');
}
function exitHeli() {
  const hp = heli.pos, g = walker.groundAt(hp.x, hp.z, hp.y), fx = -Math.sin(heli.psi), fz = -Math.cos(heli.psi), rx = -fz, rz = fx, col = curVeh?.color ?? 0xd9482b;
  if (hp.y - g < 3.5) {   // on the ground: step out on the left, clear of the rotor disc
    parked.drop('heli', 0, hp.x, hp.y, hp.z, heli.psi, col);
    walker.place(hp.x - rx * 6.5, hp.z - rz * 6.5, heli.psi); curVeh = null; setMode('walker');
  } else {                // in the air: jump (the helicopter comes down by itself)
    parked.drop('heli', 0, hp.x, hp.y, hp.z, heli.psi, col, true);
    chute.start(hp.x - rx * 2, hp.y, hp.z - rz * 2, heli.psi, fx * heli.vf + rx * heli.vs, fz * heli.vf + rz * heli.vs, heli.vy);
    curVeh = null; setMode('chute');
  }
}
function leaveRide(forced) {
  const d = rideDrv, p = puppet.pos.clone(), psi = puppet.psi; rideDrv = null; if (!forced) net.board(0);
  if (p.y - walker.groundAt(p.x, p.z, p.y) > 4) { chute.start(p.x, p.y, p.z, psi, d?.vel.x || 0, d?.vel.z || 0, 0); setMode('chute'); return; }   // the driver got out / left in the air
  const fx = -Math.sin(psi), fz = -Math.cos(psi); walker.place(p.x + fz * 2.4, p.z - fx * 2.4, psi); setMode('walker');
}
net.onDismount = forced => { if (mode === 'rider') leaveRide(true); };
function boardRemote(r) { rideDrv = r; net.board(r.id); puppet.pos.copy(r.pos); puppet.psi = r.yaw; setMode('rider'); }
function interact() {
  if (tram?.rider) return;
  if (mode === 'car') return exitCar();
  if (mode === 'heli') return exitHeli();
  if (mode === 'rider') return leaveRide();
  if (mode !== 'walker') return;
  const p = walker.pos, e = parked?.nearest(p.x, p.z), rm = net.nearestRemote(p.x, p.y, p.z);
  const de = e ? Math.hypot(e.x - p.x, e.z - p.z) : 1e9, dr = rm ? Math.hypot(rm.pos.x - p.x, rm.pos.z - p.z) : 1e9;
  if (rm && dr < de) boardRemote(rm); else if (e) enter(e);
}
/** H H H: a helicopter lands next to the player (first free spot of four around them) */
function secretHeli() {
  if (mode !== 'walker' || !parked) return;
  const p = walker.pos, fx = -Math.sin(walker.psi), fz = -Math.cos(walker.psi);
  for (const [sx, sz] of [[fx, fz], [fz, -fx], [-fz, fx], [-fx, -fz]]) for (const d of [10, 16]) {
    const x = p.x + sx * d, z = p.z + sz * d, y = walker.groundAt(x, z, p.y);
    if (buildings?.hit(x, z, y + 2) || buildings?.hit(x + 4, z, y + 2) || buildings?.hit(x - 4, z, y + 2) || buildings?.hit(x, z + 4, y + 2) || buildings?.hit(x, z - 4, y + 2)) continue;
    parked.drop('heli', 0, x, y + 0.1, z, walker.psi, [0xd9482b, 0x1f4f8f, 0xf2b84b][(Math.random() * 3) | 0]); return toast('🚁 Helicóptero aparcado a tu lado');
  }
  toast('Sin sitio para el helicóptero aquí');
}
const promptEl = document.createElement('div'); promptEl.className = 'panel';
promptEl.style.cssText = 'left:50%;bottom:14%;transform:translateX(-50%);padding:7px 14px;font-size:14px;display:none;pointer-events:none;z-index:6;white-space:nowrap';
document.body.appendChild(promptEl);
let toastT = 0, promptTxt = '';
function toast(t) { toastT = performance.now() + 2200; setPrompt(t); }
function setPrompt(t) { if (t === promptTxt) return; promptTxt = t; promptEl.innerHTML = t; promptEl.style.display = t ? 'block' : 'none'; }
function updatePrompt() {
  if (performance.now() < toastT) return;
  let t = '';
  if (mode === 'walker') {
    const p = walker.pos, e = parked?.nearest(p.x, p.z), rm = net.nearestRemote(p.x, p.y, p.z);
    if (rm && (!e || Math.hypot(rm.pos.x - p.x, rm.pos.z - p.z) < Math.hypot(e.x - p.x, e.z - p.z))) t = `<kbd>E</kbd> Subir de pasajero con ${esc(rm.name)}`;
    else if (e) t = `<kbd>E</kbd> Subir al ${e.kind === 'heli' ? 'helicóptero' : VEHICLES[e.type].name.toLowerCase() + ' (hasta ' + Math.round(topKmh(VEHICLES[e.type]) * (OPT.mph ? 0.6214 : 1)) + (OPT.mph ? ' mph)' : ' km/h)')}`;
  } else if (mode === 'car' || mode === 'rider') t = '<kbd>E</kbd> Bajar';
  else if (mode === 'heli') t = heli.pos.y - walker.groundAt(heli.pos.x, heli.pos.z, heli.pos.y) < 3.5 ? '<kbd>E</kbd> Bajar' : '<kbd>E</kbd> Saltar en paracaídas';
  else if (mode === 'chute' && !chute.open) t = '<kbd>Espacio</kbd> abrir el paracaídas';
  setPrompt(t);
}
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function switchVehicle() { selectVehicle(mode === 'car' ? 'heli' : mode === 'heli' ? 'walker' : car.type); }   // V (debug): car -> heli -> on foot
function cycleCamera() {   // C: first/third person on foot, near/normal/far elsewhere
  if (mode === 'walker') { walker.fp = !walker.fp; walker.sync(); } else zoom = zoom < 0.8 ? 1.7 : zoom > 1.3 ? 1 : 0.6;
  camSnap = true; syncVehUi();
}

// ---- vehicle selector (bottom right) + settings button + context key hint
const vehEl = document.createElement('div'); vehEl.id = 'veh'; vehEl.className = 'panel';
{
  const items = [['walker', '🚶', 'A pie'], ['heli', '🚁', 'Helicóptero'], ...VEHICLES.map((v, i) => [i, v.icon, v.name])];
  vehEl.innerHTML = '<button id="gear" title="Ajustes">⚙</button><div id="vehGrid">' + items.map(([k, ic, nm]) => `<button data-sel="${k}" title="${nm}"><span>${ic}</span><small>${nm}</small></button>`).join('') + '</div>';
  document.body.appendChild(vehEl);
  vehEl.querySelector('#vehGrid').style.display = 'none';   // debug only (V V V)
  vehEl.addEventListener('mousedown', e => e.preventDefault());   // no focus: Space must not "click" the last button
  vehEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'gear') return toggleOpts();
    const k = b.dataset.sel; selectVehicle(k === 'walker' || k === 'heli' ? k : +k);
  });
}
const HINT = {
  car: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> conducir · <kbd>Espacio</kbd> freno de mano · <kbd>Shift</kbd> nitro',
  heli: '<kbd>W</kbd><kbd>S</kbd> avanzar · <kbd>A</kbd><kbd>D</kbd> girar · <kbd>Espacio</kbd> subir · <kbd>X</kbd> bajar · <kbd>Shift</kbd> turbo',
  walker: '<kbd>W</kbd><kbd>S</kbd> andar · <kbd>A</kbd><kbd>D</kbd> girar · <kbd>Shift</kbd> correr · <kbd>Espacio</kbd> saltar · <kbd>E</kbd> subir a un vehículo cercano',
  chute: '<kbd>Espacio</kbd> abrir paracaídas · <kbd>W</kbd> planear rápido · <kbd>S</kbd> frenar · <kbd>A</kbd><kbd>D</kbd> girar',
  rider: 'Vas de pasajero · <kbd>E</kbd> bajar',
};
const helpEl = $('help'); let hintKey = '';
helpEl.addEventListener('click', e => { if (e.target.id === 'hintX') { OPT.hint = false; saveOpts(); applyHint(); } });
function applyHint() {
  helpEl.style.display = OPT.hint ? 'block' : 'none';
  const k = mode + (mode === 'walker' && walker.fp) + OPT.hint; if (k === hintKey) return; hintKey = k;
  helpEl.innerHTML = '<span id="hintX" title="Ocultar (se vuelve a activar en Ajustes)">✕</span><div>' + HINT[mode] + '</div><div><kbd>C</kbd> ' + (mode === 'walker' ? '1ª/3ª persona' : 'cámara') + ' · <kbd>E</kbd> subir/bajar' + ' · <kbd>R</kbd> volver a la Plaza Mayor · <kbd>Enter</kbd> ir a una dirección · <kbd>I</kbd> sitios · arrastrar = girar cámara</div>';
}
function syncVehUi() {
  for (const b of vehEl.querySelectorAll('[data-sel]')) { const k = b.dataset.sel; b.classList.toggle('on', mode === 'car' ? +k === car.type && k !== 'walker' && k !== 'heli' : k === mode); }
  applyHint();
}

// ---------------------------------------------------------------- camera
let orbitYaw = 0, orbitPitch = 0, zoom = 1, dragging = false, camYaw = 0, camSnap = true;

// ---- settings panel
const saveOpts = () => { try { localStorage.setItem('chiclana.opts', JSON.stringify(OPT)); } catch {} };
const optEl = document.createElement('div'); optEl.className = 'panel'; optEl.id = 'opts';
optEl.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%);width:330px;max-height:86vh;overflow:auto;display:none;z-index:20;font-size:13px';
{
  const row = (label, key, min, max, step) => `<label style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:7px 0"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${OPT[key]}" style="flex:1"><b data-v="${key}" style="width:34px;text-align:right;font-weight:500">${(+OPT[key]).toFixed(2)}</b></label>`;
  const chk = (label, key) => `<label style="display:flex;gap:8px;align-items:center;margin:7px 0"><input type="checkbox" data-k="${key}" ${OPT[key] ? 'checked' : ''}> ${label}</label>`;
  optEl.innerHTML = '<div style="display:flex;justify-content:space-between;font-weight:600;color:#f2b84b;margin-bottom:6px"><span>Ajustes</span><span id="optX" style="cursor:pointer">✕</span></div>'
    + '<div style="color:#9fb2c4;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Control</div>' + row('Sensibilidad ratón', 'mouse', 0.2, 3, 0.05) + row('Sensibilidad mando', 'pad', 0.2, 3, 0.05) + row('Suavizado de cámara', 'smooth', 0.3, 3, 0.05) + row('Zona muerta del mando', 'dead', 0.02, 0.4, 0.01) + chk('Invertir eje vertical', 'invY')
    + '<div style="color:#9fb2c4;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-top:8px">Gráficos y mundo</div>'
    + `<label style="display:flex;justify-content:space-between;align-items:center;margin:7px 0"><span>Calidad gráfica</span><select id="qSel" style="background:#13202e;color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:3px 6px">${Object.keys(QUALITY).map(k => `<option value="${k}">${QUALITY[k].name}</option>`).join('')}</select></label>`
    + row('Distancia de visión', 'view', 0.5, 1.5, 0.05) + row('Densidad de tráfico', 'traffic', 0, 1.5, 0.1) + row('Densidad de peatones', 'npcs', 0, 1.5, 0.1)
    + '<div style="color:#9fb2c4;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-top:8px">Sonido</div>' + row('Volumen general', 'vol', 0, 1, 0.05) + chk('Silenciar', 'mute')
    + '<div style="color:#9fb2c4;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-top:8px">Interfaz</div>' + chk('Velocidad en mph', 'mph') + chk('Mostrar ayuda de teclas', 'hint')
    + '<div style="color:#9fb2c4;font-size:12px;margin-top:8px;line-height:1.6"><b style="color:#e8f0f7">Controles</b> (iguales en todo): <kbd>W A S D</kbd> / flechas mover · <kbd>Espacio</kbd> freno de mano / saltar / subir · <kbd>Shift</kbd> nitro / correr / turbo · <kbd>X</kbd> bajar (heli) · <kbd>C</kbd> cámara · <kbd>R</kbd> reiniciar · <kbd>E</kbd> subir / bajar de un vehículo (o de pasajero con otro jugador; en el aire = paracaídas, <kbd>Espacio</kbd> lo abre) · <kbd>Enter</kbd> dirección · <kbd>I</kbd> sitios · arrastrar ratón = cámara · rueda = zoom. Empiezas a pie: acércate a un coche, moto o a un helicóptero (campos de fútbol).</div>'
    + '<div id="padInfo" style="color:#9fb2c4;font-size:12px;margin-top:6px">Mando: conéctalo y pulsa un botón (stick izq. mover/girar, gatillos acelerar/frenar, A freno de mano/saltar, X nitro/correr, Y subir/bajar, Start reiniciar)</div>';
  document.body.appendChild(optEl);
  const qSel = optEl.querySelector('#qSel'); qSel.value = qKey;
  qSel.addEventListener('change', () => { qKey = qSel.value; autoQ = false; applyQuality(); });
  optEl.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    OPT[k] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value; const v = optEl.querySelector(`[data-v="${k}"]`); if (v) v.textContent = (+OPT[k]).toFixed(2);
    saveOpts(); if (k === 'view') viewTarget(); if (k === 'hint') applyHint();
  });
  optEl.querySelector('#optX').onclick = () => toggleOpts(false);
  for (const ev of ['keydown', 'keyup']) optEl.addEventListener(ev, e => { if (e.code !== 'Escape') e.stopPropagation(); });
}
const toggleOpts = v => { const on = v ?? optEl.style.display === 'none'; optEl.style.display = on ? 'block' : 'none'; if (on) optEl.querySelector('#qSel').value = qKey; };
// ---- start: on foot in the street by the Plaza Mayor, with two vehicles parked a few steps away
{
  const r = walkerHome(); setMode('walker');
  if (parked && r) {
    const fx = -Math.sin(r.psi), fz = -Math.cos(r.psi), at = (d, side) => [r.x + fx * d + fz * side, r.z + fz * d - fx * side];
    let [x, z] = at(8, 1.8); parked.drop('car', 0, x, world.surf(x, z, null), z, r.psi, 0xb5251c);
    [x, z] = at(-6, -1.6); parked.drop('car', MOTO, x, world.surf(x, z, null), z, r.psi + 0.3, 0x1f4f8f);
  }
}
syncVehUi();

// ---- gamepad (optional, standard mapping). Sticks/triggers are analogue (keys.pad, read by the vehicles); buttons act as the matching keys.
//   car:    left stick steer · RT throttle · LT brake/reverse · A handbrake · X/RB nitro · right stick camera
//   heli:   left stick forward/strafe · right stick yaw · RT up · LT down · X turbo
//   walker: left stick move/strafe · right stick turn/look · A jump · X run
//   Y next vehicle · Start back to Plaza Mayor · Back first/third person
const pad = keys.pad = { thr: 0, steer: 0, f: 0, s: 0, yaw: 0, up: 0 }, padPrev = {};
const PAD_KEYS = [[0, 'Space'], [1, 'KeyX'], [2, 'ShiftLeft'], [5, 'ShiftRight']];
function pollPad(dt) {
  keys.pad = pad;   // ("release every key" loops overwrite it)
  pad.thr = pad.steer = pad.f = pad.s = pad.yaw = pad.up = 0;
  let gp = null; try { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of l) if (g && g.connected && (!gp || g.mapping === 'standard')) gp = g; } catch {}
  if (!gp) return;
  const dz = v => { const a = Math.abs(v || 0); return a < OPT.dead ? 0 : Math.sign(v) * (a - OPT.dead) / (1 - OPT.dead); }, bt = i => gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0;
  const lx = dz(gp.axes[0]), ly = dz(gp.axes[1]), rx = dz(gp.axes[2]), ry = dz(gp.axes[3]), trig = bt(7) - bt(6), iy = OPT.invY ? -1 : 1;
  if (mode === 'car') { pad.steer = -lx; pad.thr = trig; orbitYaw -= rx * dt * 2.4 * OPT.pad; }
  else if (mode === 'heli') { pad.f = -ly; pad.s = lx; pad.yaw = -rx * OPT.pad; pad.up = trig; }
  else { pad.f = -ly; pad.s = lx; pad.yaw = -rx * OPT.pad; }
  if (mode !== 'heli') orbitPitch = clamp(orbitPitch + ry * dt * 1.6 * OPT.pad * iy, -0.5, 1.1);
  for (const [i, code] of PAD_KEYS) { const p = bt(i) > 0.5; if (p !== !!padPrev[i]) { padPrev[i] = p; keys[code] = p; } }
  const edge = i => { const p = bt(i) > 0.5, was = !!padPrev[i]; padPrev[i] = p; return p && !was; };
  if (edge(3)) interact();
  if (edge(9)) resetHome();
  if (edge(8) && mode === 'walker') { walker.fp = !walker.fp; walker.sync(); camSnap = true; }
}
addEventListener('gamepadconnected', e => { const el = document.getElementById('padInfo'); if (el) el.textContent = 'Mando: ' + e.gamepad.id.slice(0, 40); });
addEventListener('gamepaddisconnected', () => { const el = document.getElementById('padInfo'); if (el) el.textContent = ''; for (const [i, code] of PAD_KEYS) if (padPrev[i]) { keys[code] = false; padPrev[i] = false; } });
const camPos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3();
$('gl').addEventListener('pointerdown', e => { dragging = true; $('gl').setPointerCapture(e.pointerId); });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', e => {
  if (!dragging) return; const s = OPT.mouse, iy = OPT.invY ? -1 : 1;
  if (mode === 'walker' && walker.fp) walker.psi -= e.movementX * 0.004 * s;       // first person: the mouse turns the walker itself
  else orbitYaw -= e.movementX * 0.005 * s;
  orbitPitch = clamp(orbitPitch + e.movementY * 0.004 * s * iy, -0.5, 1.1);
});
addEventListener('wheel', e => { zoom = clamp(zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.35, 4); }, { passive: true });

function updateCamera(dt) {
  if (!dragging) orbitYaw *= Math.exp(-dt * 1.8);
  { const f = mode === 'walker' ? 52 : 65; if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } }   // on foot: narrower lens so streets and facades read at real size
  if (mode === 'walker' && walker.fp) {   // first person: eyes at 1.65 m, orbit drag = look around
    const yaw = walker.psi + orbitYaw * 2, pitch = clamp(-orbitPitch * 1.2, -1.2, 1.0);
    camPos.set(vpos.x, vpos.y + 1.65, vpos.z); camera.position.copy(camPos);
    camera.lookAt(camPos.x - Math.sin(yaw) * Math.cos(pitch), camPos.y + Math.sin(pitch), camPos.z - Math.cos(yaw) * Math.cos(pitch));
    sky.position.copy(camPos); camSnap = false; return;
  }
  const cm = mode === 'rider' ? (rideDrv?.mode === 'heli' ? 'heli' : 'car') : mode, baseDist = cm === 'car' ? 9 : cm === 'walker' ? 3.6 : cm === 'chute' ? 10 : 17, h = cm === 'car' ? 1.6 : cm === 'walker' ? 1.5 : cm === 'chute' ? 1.8 : 2.6, target = vpos;
  if (camSnap) camYaw = active.psi;
  else camYaw += angDiff(active.psi, camYaw) * Math.min(1, dt * (cm === 'car' ? 4 : 2.5));
  const yaw = camYaw + orbitYaw, pitch = (cm === 'car' ? 0.22 : 0.3) + orbitPitch, dist = (baseDist + (cm === 'car' ? Math.min(4, Math.abs(active.speed) * 0.09) : 0)) * zoom;   // pull back at speed
  want.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + h + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  const ugU = !!ug?.under(active.pos.x, active.pos.z, active.pos.y);
  if (ugU) want.y = Math.min(want.y, ug.ceil(active.pos.x, active.pos.z, active.pos.y) - 0.35);   // underground: stay under the ceiling, the terrain clamp does not apply
  else want.y = Math.max(want.y, hf.height(want.x, want.z) + (mode === 'walker' ? 0.6 : 2.5));
  if (buildings) for (const f of [1, 0.75, 0.55, 0.38, 0.25, 0.15]) {      // pull the camera in when a facade is in the way
    const px = target.x + (want.x - target.x) * f, py = target.y + h + (want.y - target.y - h) * f + (ugU ? 0 : (1 - f) * 6), pz = target.z + (want.z - target.z) * f;
    if (!buildings.hit(px, pz, py) && !buildings.hit(px, pz, py + 1.2)) { want.set(px, py, pz); break; }
    if (f === 0.15) want.set(px, py, pz);
  }
  lookWant.set(target.x, target.y + h, target.z);
  if (camSnap) { camPos.copy(want); look.copy(lookWant); camSnap = false; }
  else { camPos.lerp(want, 1 - Math.exp(-dt * 7 / OPT.smooth)); look.lerp(lookWant, 1 - Math.exp(-dt * 12 / OPT.smooth)); }
  camera.position.copy(camPos); if (mode === 'car' && active.bump > 0) camera.position.y += (Math.random() - 0.5) * active.bump * 0.6; camera.lookAt(look);   // small shake on impacts
  sky.position.copy(camPos);
}

// ---------------------------------------------------------------- minimap (js/minimap.js)
const minimap = new Minimap({ canvas: $('minimap'), mask, net, sea: !!MAP.sea, madrid: MAP.id === 'madrid',
  getActive: () => ({ x: active.pos.x, z: active.pos.z, psi: active.psi, mode, speed: active.speed ?? active.velocityKmh / 3.6 }) });

// ---------------------------------------------------------------- street name (server -> Nominatim, cached)
let streetBusy = false, streetAt = { x: 1e9, z: 1e9 }, streetT = 0;
function updateStreet(now) {
  if (window.__metro) { if (now - streetT > 700) { streetT = now; window.__metro.hud(active.pos, $('street'), $('area')); } return; }   // Madrid: nearest metro station instead of the street name
  if (streetBusy || now - streetT < 1500) return;
  const dx = active.pos.x - streetAt.x, dz = active.pos.z - streetAt.z;
  if (dx * dx + dz * dz < 18 * 18) return;
  streetBusy = true; streetT = now; streetAt = { x: active.pos.x, z: active.pos.z };
  const [lon, lat] = toLonLat(streetAt.x, streetAt.z);
  fetch(`/api/street?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`).then(r => r.json()).then(s => {
    $('street').textContent = s.street ? s.street : (s.area ? '—' : 'Sin calle');
    $('area').textContent = s.area || '';
  }).catch(() => {}).finally(() => { streetBusy = false; });
}

// ---------------------------------------------------------------- go
setStatus('Cargando ortofotos de alrededor…', 0.85);
camera.position.set(walker.pos.x, walker.pos.y + 6, walker.pos.z + 10); camera.lookAt(walker.pos);
await terrain.preload(camera, p => setStatus(`Cargando mosaicos base… ${(p * 100) | 0}%`, 0.85 + p * 0.14));
$('loader').style.opacity = 0; setTimeout(() => $('loader').remove(), 700);

// ---------------------------------------------------------------- static batching of finished prop groups (plazas, places, monuments, venues)
// The content modules build one mesh per piece (Plaza Mayor alone: ~800 meshes for 24k triangles). Once a group exists it is merged into a few
// draw calls here, without touching the modules themselves. ?nobatch disables it.
const NOBATCH = new URLSearchParams(location.search).has('nobatch');
const batchStats = window.__batch = { groups: 0, before: 0, after: 0, ms: 0 };
function batchScan() {
  if (NOBATCH) return; const t0 = performance.now(), todo = [];
  const add = g => { if (g && g.isObject3D && g.parent && !g.userData.batched) todo.push(g); };
  add(plazaMayor?.group);
  if (placeEng?.items) for (const it of placeEng.items.values()) add(it.group);
  if (monuments?.items) for (const it of monuments.items) add(it.g);
  if (plazas?.items) for (const it of plazas.items) add(it.g);
  if (landmarks) { for (const it of landmarks.items || []) add(it.g); if (landmarks.vg) for (const g of landmarks.vg.values()) add(g); }
  if (venueSpecs?.items) for (const it of venueSpecs.items) add(it.g);
  for (const g of todo) {
    try { const r = batchStatic(g); if (r) { batchStats.groups++; batchStats.before += r.before; batchStats.after += r.after; } } catch (e) { console.warn('batch', g.name, e); }
    g.userData.batched = true;
    if (performance.now() - t0 > 5) break;   // spread big scenes over several frames
  }
  batchStats.ms += performance.now() - t0;
}

// ---------------------------------------------------------------- dynamic resolution + automatic quality
// GPU cost is ~proportional to the pixel count, so the scale is solved for directly: scale' = scale * sqrt(budget / measured).
//  - with the GPU timer (EXT_disjoint_timer_query, see diag.js) the measured value is real GPU ms -> converges in a couple of steps, no hunting;
//  - without it, the frame time is used: scale down when slow, probe upwards slowly and remember the scale that last failed.
// If the game is still under 28 fps at the minimum scale for 5 s it steps the quality preset down once per 5 s (never up; G still cycles by hand).
const NODYN = new URLSearchParams(location.search).has('nodyn');
let dynBad = 0, dynCeil = 1, dynCeilT = 0, autoQ = !NODYN, dynLast = 0;
function dynRes(ms, now) {
  if (NODYN || document.hidden || ms > 400) return;                 // tab in background / long stall: not a rendering measurement
  const q = QUALITY[qKey], rmin = q.lite ? 0.7 : 0.45, g = diag.gpuMs; let want = resScale;
  if (diag.ext && g == null) return;                                // GPU timer available but no sample yet at this size
  if (g != null && g > 0.5) {                                        // GPU-time controller (budget 11 ms of GPU per frame)
    want = resScale * Math.sqrt(11 / g);
    if (ms > 22 && g < 9) want = Math.min(want, resScale);          // slow but the GPU is idle: CPU-bound, more pixels would not hurt but fewer will not help
  } else {
    if (now - dynCeilT > 20000) dynCeil = 1;
    if (ms > 21) { want = resScale * Math.sqrt(16.7 / ms); dynCeil = Math.max(rmin, resScale - 0.04); dynCeilT = now; }
    else if (ms < 17.5) want = Math.min(dynCeil, resScale + 0.03);
  }
  want = clamp(want, Math.max(rmin, resScale * 0.8), Math.min(1, resScale * 1.1));   // rate limit per step
  if (Math.abs(want - resScale) > 0.025) { resScale = Math.round(want * 40) / 40; applyRes(); diag.gpuMs = null; }   // restart the GPU average at the new size
  if (resScale <= rmin + 0.03 && ms > 36) dynBad += 0.6; else dynBad = Math.max(0, dynBad - 1.2);
  if (autoQ && dynBad > 5 && now - dynLast > 5000) {
    const next = ({ alta: 'media', media: 'baja', baja: 'minima' })[qKey];
    if (next) { qKey = next; applyQuality(); dynLast = now; dynBad = 0; console.log('[auto] calidad -> ' + QUALITY[qKey].name + ' (pulsa G para cambiarla a mano)'); }
  }
}

// ---------------------------------------------------------------- fixed-step physics
// Vehicles and the walker always advance in 1/120 s steps, however long the frame took (the old code clamped dt to 50 ms, so below 20 fps the whole
// game ran in slow motion and collisions depended on the frame rate). The drawn pose is interpolated between the last two steps.
const FIXED = 1 / 120, MAX_STEPS = 30;   // up to 0.25 s of simulation per frame (= real time down to 4 fps)
const vpos = new THREE.Vector3(), ppos = new THREE.Vector3();   // vpos: interpolated position used for drawing and by the camera
function stepPhysics(rdt) {
  acc += rdt; let n = 0;
  while (acc >= FIXED && n < MAX_STEPS) { ppos.copy(active.pos); if (!(rag?.player && mode === 'walker')) active.update(FIXED, keys); tram?.step(FIXED, mode, keys); acc -= FIXED; n++; }   // knocked down: ragdoll.js moves the walker
  if (n === MAX_STEPS) acc = 0;
  if (ppos.distanceToSquared(active.pos) > 25) ppos.copy(active.pos);   // teleport (R, Enter, V): do not smear
  vpos.lerpVectors(ppos, active.pos, Math.min(1, acc / FIXED)); active.group.position.copy(vpos); tram?.draw(Math.min(1, acc / FIXED), camera.position);
}

let last = performance.now(), hudT = 0, mmT = 0, fpsT = performance.now(), fpsN = 0, fps = 60;
renderer.info.autoReset = false; let frameN = 0;
const perf = new PerfPanel(renderer, diag, () => ({ q: QUALITY[qKey].name, res: resScale, terrain: terrain.stats, bld: buildings?.stats, cells: streets?.stats }));
function frame(now) {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
  const D = diag, T = (n, fn) => D.time(n, fn);
  T('vehicle', () => {
    pollPad(dt);
    if (mode === 'rider') { const d = rideDrv; if (!d || !net.remotes.has(d.id)) leaveRide(true); else { puppet.pos.copy(d.pos); puppet.psi = d.yaw; puppet.speed = d.sp; puppet.velocityKmh = Math.abs(d.sp) * 3.6; } }
    stepPhysics(dt);
    if (mode === 'chute') { if (chute.landed) { const c = chute.pos; walker.place(c.x, c.z, chute.psi); walker.pos.y = Math.max(walker.pos.y, c.y); setMode('walker'); } else { walker.pos.copy(vpos); walker.psi = chute.psi; walker.air = true; walker.sync(); } }
    const col = streets?.col; if (col && mode !== 'car') col.player = mode === 'walker' ? { x: walker.pos.x, z: walker.pos.z, psi: walker.psi, speed: 0 } : null;   // traffic stops for a pedestrian too
    net.update(dt); updateCamera(dt);
    if (frameN % 3 === 0) updatePrompt();
  });
  easeView(dt);
  T('terrain', () => terrain.update(camera));
  if (ug) T('underground', () => ug.update(camera.position));
  T('bldgs', () => buildings?.update(camera.position, 4));
  frameN++; T('cells', () => streets?.update(camera.position, 3));
  T('sancti', () => sancti.update(camera.position));
  T('npcs', () => { if (npcs) { npcs.dens = OPT.npcs ?? 1; npcs.setVisible(npcs.dens > 0); npcs.update(dt, camera.position, active.pos, traffic?.cars); } });
  if (rag) T('ragdoll', () => rag.update(dt, { mode, car, heli, walker, traffic, tram, net, npcs, cam: camera.position }));
  T('traffic', () => {
    if (parked) { parked.update(camera.position, dt); if (traffic) traffic.extra = parked.dyn; }
    if (traffic) { traffic.dens = OPT.traffic; traffic.setVisible(OPT.traffic > 0); traffic.update(dt, camera.position); if (OPT.traffic <= 0 && parked && streets?.col && frameN % 2 === 0) streets.col.setDynamic(parked.dyn); }
  });
  if (audio.ctx) T('audio', () => audio.update(dt, { mode, active, car, heli, walker, world, cam: camera.position, tram, onTram: !!tram?.rider }));
  T('bernabeu', () => { window.__bernabeu?.update(dt, camera.position); window.__events?.update(dt, camera.position); window.__metro?.update(dt, active.pos, mode === 'walker'); });
  T('monum', () => { monuments?.update(dt, camera.position); plazas?.update(camera.position); landmarks?.update(camera.position); plazaMayor?.update(camera.position); placeEng?.update(camera.position); venueSpecs?.update(camera.position); football?.update(camera.position); courts?.update(camera.position); parks?.update(camera.position); if (frameN % 6 === 0) batchScan(); });
  sea.update(now / 1000);
  T('street', () => updateStreet(now));
  renderer.info.reset();
  diag.beginRender(); renderer.render(scene, camera); diag.endRender();
  { const ws = streets?.stats; diag.frame(now, { res: `${QUALITY[qKey].name} x${resScale.toFixed(2)}`, builds: ws?.builds, buildMean: ws?.builds ? ws.buildMs / ws.builds : null, hitch: ws?.maxBuild }); }

  fpsN++;
  if (now - fpsT > 600) {                        // dynamic resolution: trade pixels for frame rate
    const ms = (now - fpsT) / fpsN; fps = 1000 / ms; fpsN = 0; fpsT = now; dynRes(ms, now);
  }
  if (now - hudT > 250) {
    hudT = now;
    const [lon, lat] = toLonLat(active.pos.x, active.pos.z), b = buildings?.stats, t = terrain.stats, ri = renderer.info.render;
    $('mode').textContent = mode === 'rider' ? '🧍 Pasajero' : mode === 'chute' ? (chute.open ? '🪂 Paracaídas' : '🪂 Caída libre') : mode === 'car' ? car.spec.icon + ' ' + car.spec.name : mode === 'walker' ? '🚶 A pie' + (walker.fp ? ' (1ª persona)' : '') : '🚁 Helicóptero';
    $('spd').textContent = Math.round(active.velocityKmh * (OPT.mph ? 0.6214 : 1)); $('spdU').textContent = OPT.mph ? 'mph' : 'km/h';
    $('alt').textContent = Math.round(active.pos.y - hf.height(active.pos.x, active.pos.z)) + ' m';
    $('pos').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    $('lod').textContent = `${t.drawn} nodos · z${t.deepest} · cola ${t.queued}`;
    $('bld').textContent = b ? `${b.lod0}/${b.lod1}/${b.lod2}` : '—';
    $('gfx').textContent = `${QUALITY[qKey].name} · ${(QUALITY[qKey].pr * resScale).toFixed(2)}x · ${ri.calls} dc · ${(ri.triangles / 1000).toFixed(0)}k△`;
    $('fps').textContent = Math.round(fps);
  }
  if (now - mmT > 100) { mmT = now; T('minimap', () => minimap.draw(0.1)); }
  if (perf.on) perf.update(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__perf = {   // bench hooks (scripts/bench.mjs)
  reset() { diag.reset(); if (streets) { streets.stats.maxBuild = 0; this.b0 = streets.stats.builds || 0; } },
  /** visible meshes grouped by scene root (who owns the draw calls) */
  census() {
    const m = new Map(), vis = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    scene.traverse(o => { if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints) || !vis(o)) return; let r = o; while (r.parent && r.parent !== scene) r = r.parent;
      const k = r.name || r.userData.tag || (r.userData.kind ? 'monument' : '(' + r.type + ' sin nombre)'), e = m.get(k) || { n: 0, tri: 0, roots: new Set() }; e.n++; e.roots.add(r.id); const g = o.geometry; if (g) e.tri += ((g.index ? g.index.count : g.attributes.position?.count || 0) / 3) * (o.isInstancedMesh ? o.count : 1); m.set(k, e); });
    return [...m].sort((a, b) => b[1].n - a[1].n).slice(0, 16).map(([k, e]) => `${k}: ${e.n} dc, ${Math.round(e.tri / 1000)}k tri` + (e.roots.size > 1 ? ` (${e.roots.size} grupos)` : ''));
  },
  report() { const r = diag.report(), ws = streets?.stats; return { ...r, gpuMs: diag.gpuMs == null ? null : +diag.gpuMs.toFixed(2), frameMs: +diag.frameMs.toFixed(1), builds: ws ? (ws.builds || 0) - (this.b0 || 0) : 0, buildMax: ws ? +(ws.maxBuild || 0).toFixed(1) : 0 }; },
};
window.__sim = { audio, rag, get npcs() { return npcs; }, selectVehicle, interact, enter, setMode, secretHeli, parked, chute, puppet, VEHICLES, get curVeh() { return curVeh; }, get traffic() { return traffic; }, streets, sea, scene, camera, terrain, buildings, car, heli, walker, hf, mask, keys, renderer, net, get mode() { return mode; } };   // debugging handle
