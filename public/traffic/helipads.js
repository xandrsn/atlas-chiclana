// Helicopters on the car parks. The player's helicopter and the parked ones share two InstancedMeshes (body, main rotor) over a "fleet"
// geometry of every helicopter model (traffic/ambient.js fleetGeometry; aSel picks the model, the instance colour paints it): 2 draw calls
// whatever the count. Instance 0 = the player's helicopter (spinning rotor), 1.. = parked ones (static rotor, lamps off).
// Spots: car-park clearings (data/parking lots of r >= 8 m, which scripts/parking_data.mjs keeps free of bays), ~60 % of them by hash,
// on flat ground with no building wall inside the rotor disc (checked once their ground is resident).
import * as THREE from 'three';
import { fleetGeometry } from './ambient.js';
import { buildVehicle } from '../vehicles/carmesh.js';
import { buildRotor } from '../vehicles/helimesh.js';
import { hash } from './park_math.js';

const CAP = 25, VIEW = 900;   // instances (the player's + 24 parked); parked helicopters are drawn within VIEW m

export class Helipads {
  /** helis: heli specs (catalogue order); lots: data/parking lots [[x, z, r]] */
  constructor({ scene, mat, helis, lots }) {
    this.helis = helis;
    const mk = (build, lit) => {
      const g = fleetGeometry(helis, 0, build, false);
      g.setAttribute('aSel', new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1));
      if (lit) g.setAttribute('aLights', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2).fill(-1), 2));
      const im = new THREE.InstancedMesh(g, mat, CAP); im.setColorAt(0, new THREE.Color()); im.count = 1; im.frustumCulled = false;   // instances spread over the map
      scene.add(im); return im;
    };
    this.body = mk(buildVehicle, true); this.rotor = mk(s => buildRotor(s), false);
    this.spots = (lots || []).filter(([x, z, r]) => r >= 8 && hash(Math.round(x) * 73 + Math.round(z) * 19) < 0.6).map(([x, z, r]) => {
      const u = hash(Math.round(x) * 31 + Math.round(z)), m = Math.min(helis.length - 1, Math.floor(u * helis.length)), pal = helis[m].palette;
      return { x, z, r, h: hash(Math.round(z) * 17 + 5) * 2 * Math.PI, m, col: new THREE.Color(pal[Math.floor(hash(Math.round(x) * 7 + Math.round(z) * 3) * pal.length)]), y: null, ok: null };
    });
    this.shown = []; this.t = 1;
    this.M = new THREE.Matrix4(); this.R = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1);
  }
  /** spot check once its ground is in: T(x, z) terrain y or null; wallTop(x, z) = max(ground, building wall) (camera/solid.js at) */
  resolve(s, T, wallTop) {
    const y = T(s.x, s.z); if (y == null) return;
    const R = this.helis[s.m].dims.rotor / 2 + 0.5, ring = [[0, 0], ...Array.from({ length: 12 }, (_, k) => [Math.cos(k * Math.PI / 6) * R, Math.sin(k * Math.PI / 6) * R])];
    const flat = [[6, 0], [-6, 0], [0, 6], [0, -6]].every(([a, b]) => Math.abs((T(s.x + a, s.z + b) ?? 1e9) - y) < 1);   // ~9 degrees: Madrid's car parks slope
    s.y = y; s.ok = flat && ring.every(([a, b]) => wallTop(s.x + a, s.z + b) < y + 2);
  }
  /** per frame: re-pick the parked helicopters near focus (twice a second); away = [x, z] of the player's helicopter (its own pad is free) */
  update(dt, focus, T, wallTop, away) {
    if ((this.t += dt) < 0.5) return; this.t = 0;
    const out = [];
    for (const s of this.spots) {
      const d = Math.hypot(s.x - focus.x, s.z - focus.z); if (d > VIEW) continue;
      if (s.ok == null) this.resolve(s, T, wallTop);
      if (s.ok && Math.hypot(s.x - away[0], s.z - away[1]) > 8) out.push([d, s]);
    }
    this.shown = out.sort((a, b) => a[0] - b[0]).slice(0, CAP - 1).map(o => o[1]);
    this.shown.forEach((s, k) => this.write(k + 1, s.x, s.y, s.z, s.h, 0, 0, s.h * 3, s.m, s.col, -1));
    this.body.count = this.rotor.count = this.shown.length + 1;
  }
  /** instance i: pose + model + colour; brake -1 = lamps off (parked) */
  write(i, x, y, z, h, pitch, roll, spin, m, col, brake) {
    const { M, R } = this; M.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(pitch, h + Math.PI, roll, 'YXZ')), this.one);
    for (const [im, mat] of [[this.body, M], [this.rotor, R.makeRotationY(spin).premultiply(M)]]) {
      mat.toArray(im.instanceMatrix.array, i * 16); im.setColorAt(i, col); im.geometry.attributes.aSel.array[i] = m + 1;
      im.instanceMatrix.needsUpdate = im.instanceColor.needsUpdate = im.geometry.attributes.aSel.needsUpdate = true;
    }
    const L = this.body.geometry.attributes.aLights; L.array[i * 2] = brake; L.array[i * 2 + 1] = 0; L.needsUpdate = true;
  }
  /** a parked helicopter within r of (x, z), or null */
  near(x, z, r) { let best = null; for (const s of this.shown) { const d = Math.hypot(s.x - x, s.z - z); if (d < r) { r = d; best = s; } } return best; }
  /** walkers / cars bump into the parked cabins (a disc; the tail boom is ignored) */
  hit(x, z, r) { for (const s of this.shown) if (Math.hypot(s.x - x, s.z - z) < 2.2 + r) return true; return false; }
}
