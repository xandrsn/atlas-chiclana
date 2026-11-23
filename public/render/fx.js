// Shared particle pool for crashes: sparks, smoke, glass shards, body chunks (bumper, hood, rubble). ONE InstancedMesh of unit cubes for
// everything (1 draw call, none while empty: count 0), coloured per instance. Plain typed arrays + THREE matrices; no per-particle objects.
import * as THREE from 'three';

const CAP = 420;
export const SPARK = 0, SMOKE = 1, CHUNK = 2;

export class Fx {
  /** ground(x, z, y) -> terrain height under the point (chunks bounce on it) */
  constructor(scene, ground = () => 0, cap = CAP) {
    this.cap = cap; this.ground = ground; this.n = 0; this.light = [1, 1, 1];
    this.P = new Float32Array(cap * 3); this.V = new Float32Array(cap * 3); this.R = new Float32Array(cap * 3); this.W = new Float32Array(cap * 3);
    this.S = new Float32Array(cap * 3); this.T = new Float32Array(cap * 2); this.K = new Uint8Array(cap); this.C = new Float32Array(cap * 3);
    this.im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), cap);
    this.im.setColorAt(0, new THREE.Color()); this.im.count = 0; this.im.frustumCulled = false; this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.im);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }
  /** one particle; col '#rrggbb' | [r, g, b] | THREE.Color; sz: edge (m) or [x, y, z]; ttl seconds. The oldest is replaced when full. */
  add(kind, x, y, z, vx, vy, vz, sz, col, ttl, spin = 6) {
    const i = this.n < this.cap ? this.n++ : (this.next = ((this.next ?? -1) + 1) % this.cap), r = Math.random;
    this.P.set([x, y, z], i * 3); this.V.set([vx, vy, vz], i * 3); this.R.set([r() * 6, r() * 6, r() * 6], i * 3);
    this.W.set(kind === SMOKE ? [0, 0.4, 0] : [(r() - 0.5) * spin, (r() - 0.5) * spin, (r() - 0.5) * spin], i * 3);
    this.S.set(Array.isArray(sz) ? sz : [sz, sz, sz], i * 3); this.T[i * 2] = 0; this.T[i * 2 + 1] = ttl; this.K[i] = kind;
    if (Array.isArray(col)) this._c.setRGB(...col); else this._c.set(col);
    this.C.set([this._c.r, this._c.g, this._c.b], i * 3);
  }
  /** n sparks at a contact point, thrown along (dx, dz) with the given speed */
  sparks(x, y, z, dx, dz, speed, n = 6) {
    for (let k = 0; k < n; k++) { const r = Math.random; this.add(SPARK, x, y, z, dx * speed * (0.3 + r()) + (r() - 0.5) * 3, 1 + r() * 3, dz * speed * (0.3 + r()) + (r() - 0.5) * 3, 0.05 + r() * 0.04, r() < 0.5 ? '#ffd45a' : '#ff8a2a', 0.25 + r() * 0.3, 0); }
  }
  smoke(x, y, z, dark = 0.5, size = 1) { const g = 0.75 - dark * 0.55, r = Math.random; this.add(SMOKE, x, y, z, (r() - 0.5) * 0.6, 1 + r(), (r() - 0.5) * 0.6, (0.25 + r() * 0.2) * size, [g * this.light[0], g * this.light[1], g * this.light[2]], 1.6 + r()); }
  shards(x, y, z, n = 8, col = '#bcd3de') { for (let k = 0; k < n; k++) { const r = Math.random; this.add(CHUNK, x + (r() - 0.5) * 0.5, y + r() * 0.3, z + (r() - 0.5) * 0.5, (r() - 0.5) * 5, 1 + r() * 3, (r() - 0.5) * 5, [0.06 + r() * 0.06, 0.02, 0.06 + r() * 0.06], col, 2.5 + r() * 2); } }
  /** a loose body part / rubble: size [x, y, z], velocity, colour */
  chunk(x, y, z, vx, vy, vz, sz, col, ttl = 14) { this._c.set(col); this.add(CHUNK, x, y, z, vx, vy, vz, sz, [this._c.r * this.light[0], this._c.g * this.light[1], this._c.b * this.light[2]], ttl, 8); }
  update(dt) {
    const { P, V, R, W, S, T, K, C } = this; let i = 0;
    while (i < this.n) {
      const t = T[i * 2] += dt, k = K[i], p = i * 3;
      if (t >= T[i * 2 + 1]) { this.kill(i); continue; }
      if (k === SMOKE) { V[p + 1] *= 1 - 0.6 * dt; V[p] *= 1 - dt; V[p + 2] *= 1 - dt; } else V[p + 1] -= 9.81 * dt;
      P[p] += V[p] * dt; P[p + 1] += V[p + 1] * dt; P[p + 2] += V[p + 2] * dt;
      if (k === CHUNK) {
        const gy = this.ground(P[p], P[p + 2], P[p + 1]) + S[p + 1] * 0.5;
        if (P[p + 1] < gy) { P[p + 1] = gy; V[p + 1] = V[p + 1] < -2 ? -V[p + 1] * 0.3 : 0; const f = Math.max(0, 1 - 4 * dt); V[p] *= f; V[p + 2] *= f; W[p] *= 0.6; W[p + 1] *= 0.6; W[p + 2] *= 0.6; }
      }
      R[p] += W[p] * dt; R[p + 1] += W[p + 1] * dt; R[p + 2] += W[p + 2] * dt;
      i++;
    }
    const im = this.im; im.count = this.n; im.visible = this.n > 0; if (!this.n) return;
    for (let j = 0; j < this.n; j++) {
      const p = j * 3, u = T[j * 2] / T[j * 2 + 1], k = K[j];
      const sc = k === SMOKE ? (0.5 + 2.2 * u) * (1 - u * u) : k === SPARK ? 1 - u : 1;   // smoke swells then fades out by shrinking; sparks shrink; chunks keep their size
      this._e.set(R[p], R[p + 1], R[p + 2]); this._q.setFromEuler(this._e); this._p.set(P[p], P[p + 1], P[p + 2]); this._s.set(S[p] * sc, S[p + 1] * sc, S[p + 2] * sc);
      im.setMatrixAt(j, this._m.compose(this._p, this._q, this._s)); this._c.setRGB(C[p], C[p + 1], C[p + 2]); im.setColorAt(j, this._c);
    }
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
  }
  kill(i) { const l = --this.n; if (i === l) return; for (const [a, w] of [[this.P, 3], [this.V, 3], [this.R, 3], [this.W, 3], [this.S, 3], [this.C, 3], [this.T, 2]]) a.copyWithin(i * w, l * w, l * w + w); this.K[i] = this.K[l]; }
}
