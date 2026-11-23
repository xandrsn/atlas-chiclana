import * as THREE from 'three';
import { toLocal } from './geo.js';
import { props } from './props.js';
import { venusModel } from './venus.js';

// Procedural landmarks from data/poi.json (OSM / Wikidata / Commons, see scripts/poi_build.mjs) + hand-designed Plaza Mayor.
// Models are generic per category (statue on a pedestal, obelisk, fountain, belfry, tower, cross, windmill, lighthouse): they mark the
// real position but are NOT scans of the real monuments. Built lazily when the camera comes within BUILD metres.
const BUILD = 900;
const M = {
  stone: new THREE.MeshLambertMaterial({ color: 0xcfc8b6 }), stoneD: new THREE.MeshLambertMaterial({ color: 0x9a9384 }), white: new THREE.MeshLambertMaterial({ color: 0xf1eee6 }),
  bronze: new THREE.MeshLambertMaterial({ color: 0x5b4b36 }), roof: new THREE.MeshLambertMaterial({ color: 0xa65436 }), water: new THREE.MeshLambertMaterial({ color: 0x7fd0e8, transparent: true, opacity: 0.8 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), iron: new THREE.MeshLambertMaterial({ color: 0x2c2f33 }), leaf: new THREE.MeshLambertMaterial({ color: 0x4f8a3a }), orange: new THREE.MeshLambertMaterial({ color: 0xe48a1c }),
  lampG: new THREE.MeshBasicMaterial({ color: 0xfff1c0 }), red: new THREE.MeshLambertMaterial({ color: 0xb5251c }),
};
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); return m; };
const cyl = (r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), mat); m.position.set(x, y + h / 2, z); return m; };
const sph = (r, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat); m.position.set(x, y, z); return m; };
const cone = (r, h, mat, x, y, z, seg = 4) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat); m.position.set(x, y + h / 2, z); if (seg === 4) m.rotation.y = Math.PI / 4; return m; };

// ------------------------------------------------------------------ generic models (origin at ground, y up)
function statue(h) {
  const g = new THREE.Group(); const hh = 1.6 + h * 1.2;
  g.add(box(2.6, 0.4, 2.6, M.stoneD), box(1.8, hh, 1.8, M.stone, 0, 0.4));
  const y = 0.4 + hh;
  g.add(cyl(0.34, 0.3, 1.0, M.bronze, 0, y, 0, 8), sph(0.3, M.bronze, 0, y + 1.3, 0), cyl(0.22, 0.12, 0.7, M.bronze, 0, y + 1.0 - 0.05, 0, 8));
  const arm = cyl(0.08, 0.08, 0.9, M.bronze, 0.42, y + 0.55, 0, 6); arm.rotation.z = -0.5 * (0.4 + h); g.add(arm);
  const arm2 = cyl(0.08, 0.08, 0.8, M.bronze, -0.4, y + 0.6, 0, 6); arm2.rotation.z = 0.2; g.add(arm2);
  return g;
}
function obelisk(h) {
  const g = new THREE.Group(), H = 5 + h * 5;
  g.add(box(3.2, 0.3, 3.2, M.stoneD), box(2.4, 0.4, 2.4, M.stone, 0, 0.3), box(1.5, 1.0, 1.5, M.stoneD, 0, 0.7));
  const o = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, H, 4), M.stone); o.rotation.y = Math.PI / 4; o.position.y = 1.7 + H / 2; g.add(o);
  g.add(cone(0.4, 0.8, M.stone, 0, 1.7 + H, 0));
  return g;
}
function memorialBlock() { const g = new THREE.Group(); g.add(box(4, 0.3, 1.4, M.stoneD), box(3.4, 1.8, 0.7, M.stone, 0, 0.3), box(3.0, 0.4, 0.9, M.stoneD, 0, 2.1)); return g; }
function fountain(big) {
  const g = new THREE.Group(), R = big ? 2.6 : 1.5;
  g.add(cyl(R, R, 0.6, M.stone, 0, 0, 0, 20), cyl(R - 0.25, R - 0.25, 0.05, M.water, 0, 0.58, 0, 20), cyl(0.22, 0.3, 1.5, M.stone, 0, 0.3, 0, 10), cyl(0.8, 0.5, 0.2, M.stone, 0, 1.6, 0, 14));
  g.userData.jet = cone(0.14, 1.1, M.water, 0, 1.8, 0, 8); g.add(g.userData.jet);
  if (big) { g.add(cyl(1.3, 1.3, 0.35, M.stone, 0, 0.6, 0, 16)); }
  return g;
}
function cross() { const g = new THREE.Group(); g.add(box(1.8, 0.35, 1.8, M.stoneD), box(1.1, 0.4, 1.1, M.stone, 0, 0.35), box(0.4, 3.0, 0.4, M.stone, 0, 0.75), box(1.4, 0.38, 0.38, M.stone, 0, 2.4)); return g; }
function belfry(h) {   // church belfry/espadaña: placed beside the (Catastro) building mass
  const g = new THREE.Group(), H = 16 + h * 8;
  g.add(box(4.4, H, 4.4, M.white), box(4.8, 0.5, 4.8, M.stone, 0, H), box(3.0, 3.2, 3.0, M.white, 0, H + 0.5), cone(2.6, 4.2, M.roof, 0, H + 3.7));
  for (const a of [0, 1, 2, 3]) { const d = (a % 2 ? 1 : 0), s = a < 2 ? 1 : -1; g.add(box(d ? 0.05 : 1.0, 1.8, d ? 1.0 : 0.05, M.iron, d ? s * 1.52 : 0, H + 1.0, d ? 0 : s * 1.52)); }
  g.add(cyl(0.05, 0.05, 1.8, M.iron, 0, H + 7.9, 0, 4), box(1.0, 0.1, 0.1, M.iron, 0, H + 9.0));
  return g;
}
function chapelGable() { const g = new THREE.Group(); g.add(box(0.5, 4.2, 1.6, M.white), box(0.6, 0.5, 1.9, M.stone, 0, 4.2), cone(0.9, 1.1, M.roof, 0, 4.7, 0, 4), box(0.12, 0.9, 0.12, M.iron, 0, 5.7), box(0.5, 0.1, 0.1, M.iron, 0, 6.3)); return g; }
function tower(h, clock) {
  const g = new THREE.Group(), H = 9 + h * 5; g.add(box(3.6, H, 3.6, M.stone), box(4.0, 0.4, 4.0, M.stoneD, 0, H), cone(2.7, 3.2, M.roof, 0, H + 0.4));
  if (clock) for (const [x, z, r] of [[0, 1.82, 0], [0, -1.82, 0], [1.82, 0, 1], [-1.82, 0, 1]]) { const c = cyl(0.8, 0.8, 0.08, M.white, x, H - 2.2, z, 16); c.rotation.x = Math.PI / 2; if (r) { c.rotation.x = 0; c.rotation.z = Math.PI / 2; } g.add(c); }
  return g;
}
function fort(h) {   // round battlemented stone tower
  const g = new THREE.Group(), H = 9 + h * 4; g.add(cyl(4.2, 3.4, H, M.stone, 0, 0, 0, 14), cyl(4.3, 4.3, 0.6, M.stoneD, 0, H, 0, 14));
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; g.add(box(0.9, 0.9, 0.9, M.stone, Math.cos(a) * 3.9, H + 0.6, Math.sin(a) * 3.9)); }
  return g;
}
function windmill() { const g = new THREE.Group(); g.add(cyl(2.8, 1.9, 7, M.white, 0, 0, 0, 10), cone(2.4, 2.2, M.roof, 0, 7, 0, 10)); const bl = new THREE.Group(); bl.position.set(0, 6.5, 2.2); for (let i = 0; i < 4; i++) { const b = box(0.5, 4.6, 0.06, M.wood, 0, 0.3); const p = new THREE.Group(); p.rotation.z = i * Math.PI / 2; p.add(b); bl.add(p); } g.userData.blades = bl; g.add(bl); return g; }
function lighthouse() { const g = new THREE.Group(); g.add(cyl(3.2, 2.0, 16, M.white, 0, 0, 0, 12), cyl(2.6, 2.6, 0.5, M.stoneD, 0, 16, 0, 12), cyl(1.4, 1.4, 2.2, M.lampG, 0, 16.5, 0, 10), cone(1.8, 1.8, M.red, 0, 18.7, 0, 12)); return g; }

const KIND = (p) => {
  const n = (p.name || '') + ' ' + (p.kind || ''), c = p.cat;
  if (/molino/i.test(n)) return 'windmill'; if (/faro|lighthouse/i.test(n)) return 'lighthouse';
  if (c === 'statue') return 'statue'; if (c === 'cross') return 'cross'; if (c === 'fountain') return /sin nombre/.test(n) || !p.name ? 'fountain' : 'fountainBig';
  if (c === 'monument') return /obelisk|monolito|memorial/i.test(n) ? (/monolito|obelisk/i.test(n) ? 'obelisk' : 'memorial') : hash(p.ref || p.name || '') < 0.5 ? 'obelisk' : 'memorial';
  if (c === 'fortification') return /reloj|clock/i.test(n) ? 'clock' : /faro/i.test(n) ? 'lighthouse' : 'fort';
  if (c === 'religious') return /iglesia|parroquia|church/i.test(n) ? 'belfry' : /capilla|ermita|chapel/i.test(n) ? 'gable' : null;
  if (c === 'landmark' && /torre|reloj/i.test(n)) return 'clock';
  return null;
};

// (Plaza Mayor: see plazamayor.js)

// ------------------------------------------------------------------ manager
export class Monuments {
  constructor(scene, hf, pois, plazaData) {
    this.scene = scene; this.hf = hf; this.items = []; this.t = 0;
    for (const p of pois) { const kind = KIND(p); if (!kind) continue; if (p.x > -3740 && p.x < -3575 && p.z > -1900 && p.z < -1795) continue;   // Plaza Mayor / Iglesia Mayor / Torre del Reloj: plazamayor.js
     const y = Math.max(hf.height(p.x, p.z), p.ref === 'venus-al-sol' ? 1.2 : 0); if (y < 0.4) continue; this.items.push({ p, kind, y, g: null, R: kind === 'belfry' || kind === 'clock' || kind === 'lighthouse' || kind === 'fort' ? 1400 : 600 }); }
    this.plaza = null; this.plazaData = plazaData; this.placeXZ = [];
    // generic belfry/gable POI models are replaced by the researched place when one exists nearby (data/places)
    fetch('/data/places_all.json').then(r => r.ok ? r.json() : null).then(a => { for (const q of a?.places || []) if (Number.isFinite(q.lon)) this.placeXZ.push([...toLocal(q.lon, q.lat), (q.radius || 90) + 40]); }).catch(() => {});
  }
  build(it) {
    const { p, kind } = it, h = hash(p.ref || p.name || String(p.x)); let g;
    switch (kind) {
      case 'statue': g = p.ref === 'venus-al-sol' ? venusModel() : statue(h); break; case 'obelisk': g = obelisk(h); break; case 'memorial': g = memorialBlock(); break; case 'fountain': g = fountain(false); break; case 'fountainBig': g = fountain(true); break;
      case 'cross': g = cross(); break; case 'belfry': g = belfry(h); g.position.set(0, 0, 0); break; case 'gable': g = chapelGable(); break; case 'clock': g = tower(h, true); break; case 'fort': g = fort(h); break; case 'windmill': g = windmill(); break; case 'lighthouse': g = lighthouse(); break;
    }
    const off = kind === 'belfry' ? 9 : 0;   // belfries stand beside the footprint so they don't sink into the Catastro building
    g.position.set(p.x + off, it.y, p.z); g.rotation.y = p.ref === 'venus-al-sol' ? Math.PI : h * Math.PI * 2; g.userData.kind = kind; this.scene.add(g); it.g = g; this.solid(it, g.position.x, g.position.z, g.rotation.y);
  }
  solid(it, x, z, rot) {   // collision footprint per kind (absolute top = ground + height)
    const { kind, p } = it, y = it.y, venus = p.ref === 'venus-al-sol';
    const C = { statue: [venus ? 1.4 : 1.0, 3.5], obelisk: [1.0, 9], fountain: [2.0, 2], fountainBig: [3.6, 2.5], cross: [1.0, 3.2], belfry: [1.6, 22], clock: [2.2, 20], fort: [3.2, 12], windmill: [2.8, 9], lighthouse: [3.2, 18] }[kind];
    if (C) props.circle(x, z, C[0], y + C[1]);
    else if (kind === 'memorial') props.box(x, z, 2.0, 0.7, rot, y + 2.6);
    else if (kind === 'gable') props.box(x, z, 0.3, 0.8, rot, y + 6);
  }
  update(dt, cam) {
    this.t += dt;
    for (const it of this.items) {
      const d = Math.hypot(it.p.x - cam.x, it.p.z - cam.z);
      if (!it.g && d < BUILD && !((it.kind === 'belfry' || it.kind === 'gable') && this.placeXZ.some(([x, z, r]) => Math.hypot(it.p.x - x, it.p.z - z) < r))) this.build(it);
      if (it.g) { it.g.visible = d < it.R * (window.__lodK ?? 1); if (it.g.visible) { const j = it.g.userData.jet; if (j) j.scale.y = 0.85 + 0.2 * Math.sin(this.t * 3 + it.p.x); const b = it.g.userData.blades; if (b) b.rotation.z = this.t * 0.6; } }
    }
  }
}
