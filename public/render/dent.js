// Sheet-metal damage on a vehicle mesh (non-indexed geometry from vehicles/carmesh.js): dents push the vertices near the impact inwards,
// scuff the paint, crack and break the glass, tear off the bumper and the bonnet. Works on the mesh's own position / color / aPaint
// attributes (the geometry must belong to one mesh); a fresh Skin = the mint original. No renderer needed: runs in node on plain BufferAttributes.
const GLASS = -5, hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const CRACK = [0.56, 0.64, 0.68], BROKEN = [0.05, 0.06, 0.07];
const MAXD = 0.6;   // a vertex never ends further than this from where it was built

export class Skin {
  constructor(geo, spec) {
    this.geo = geo; this.spec = spec; const A = geo.attributes; this.pos = A.position; this.col = A.color; this.paint = A.aPaint; this.n = this.pos.count;
    this.o = Float32Array.from(this.pos.array); this.c0 = Float32Array.from(this.col.array); this.p0 = Float32Array.from(this.paint.array);
    this.dead = new Uint8Array(this.n); this.d = new Float32Array(this.n);
    this.dmg = 0; this.glass = 0; this.gone = { front: false, rear: false, hood: false };
    const D = spec.dims; this.hl = D.length / 2; this.hw = D.width / 2; this.sill = D.groundClearance; this.b = spec.body || {};
  }
  /** hit at local point (x: + = left, y up, z forward) pushed along the unit local direction (ix, iz); dv = closing speed (m/s).
   *  -> { parts: [{ part: 'bumper' | 'hood', z, y, w, l }], glass: 0 | 1 | 2 (stage just reached), dmg } */
  dent(lx, ly, lz, ix, iz, dv) {
    const out = { parts: [], glass: 0, dmg: this.dmg };
    if (dv < 1.2) return out;
    const R = 0.7 + Math.min(1.1, dv * 0.06), depth = Math.min(0.5, dv * 0.028), p = this.pos.array, o = this.o, c = this.col.array, pt = this.paint.array;
    for (let j = 0; j < this.n; j++) {
      if (this.dead[j]) continue;
      const a = j * 3, dx = p[a] - lx, dy = (p[a + 1] - ly) * 1.4, dz = p[a + 2] - lz, d = Math.hypot(dx, dy, dz); if (d >= R) continue;
      let f = 1 - d / R; f *= f; const k = depth * f * (0.6 + 0.8 * hash(j)), jx = (hash(j + 9.1) - 0.5) * k * 0.7, jy = (hash(j + 3.7) - 0.5) * k * 0.7;
      let nx = p[a] + ix * k + jx, ny = p[a + 1] + jy, nz = p[a + 2] + iz * k;
      const ex = nx - o[a], ey = ny - o[a + 1], ez = nz - o[a + 2], m = Math.hypot(ex, ey, ez);
      if (m > MAXD) { const s = MAXD / m; nx = o[a] + ex * s; ny = o[a + 1] + ey * s; nz = o[a + 2] + ez * s; }
      p[a] = nx; p[a + 1] = ny; p[a + 2] = nz;
      this.d[j] += k; const dark = 1 - Math.min(0.55, this.d[j] * 1.5);   // scuffed / dirty where it was hit
      if (this.p0[j] > 0) pt[j] = this.p0[j] * dark;
      else if (this.p0[j] === 0 && this.glass < 1) { c[a] = this.c0[a] * dark; c[a + 1] = this.c0[a + 1] * dark; c[a + 2] = this.c0[a + 2] * dark; }
    }
    this.pos.needsUpdate = true; this.paint.needsUpdate = true; this.col.needsUpdate = true;
    this.dmg += dv / 16; out.dmg = this.dmg;
    if (this.dmg > 0.3 && this.glass < 1) out.glass = this.setGlass(1);
    if (this.dmg > 0.75 && this.glass < 2) out.glass = this.setGlass(2);
    if (this.spec.kind === 'car') {
      const side = lz > 0 ? 'front' : 'rear';
      if (dv > 8 && !this.gone[side] && Math.abs(lz) > this.hl * 0.55) { this.gone[side] = true; this.cut(side); out.parts.push({ part: 'bumper', z: Math.sign(lz) * (this.hl - 0.1), y: this.sill + 0.1, w: this.hw * 2 }); }
      if (dv > 11 && !this.gone.hood && lz > this.hl * 0.2 && this.b.hood) { this.gone.hood = true; this.cut('hood'); out.parts.push({ part: 'hood', z: this.hl - this.b.hood / 2, y: Math.min(this.b.noseH, this.b.belt) + 0.05, w: this.hw * 2 - 0.2, l: this.b.hood }); }
    }
    return out;
  }
  /** glass: 1 = cracked (milky), 2 = broken out (black holes) */
  setGlass(s) {
    this.glass = s; const c = this.col.array, col = s === 1 ? CRACK : BROKEN;
    for (let j = 0; j < this.n; j++) if (this.p0[j] === GLASS && !this.dead[j]) { const sh = 0.8 + 0.4 * hash(j * 3.3); c[j * 3] = col[0] * sh; c[j * 3 + 1] = col[1] * sh; c[j * 3 + 2] = col[2] * sh; }
    this.col.needsUpdate = true; return s;
  }
  /** collapse the triangles (3 vertices each) lying wholly inside a region of the ORIGINAL body: front / rear bumper, bonnet */
  cut(part) {
    const { hl, sill, b } = this, o = this.o, zc1 = hl - (b.hood || 0.9), hy = Math.min(b.noseH ?? 0.8, b.belt ?? 1) - 0.03;
    const inR = j => { const y = o[j * 3 + 1], z = o[j * 3 + 2]; return part === 'front' ? z > hl - 0.14 && y < sill + 0.2 : part === 'rear' ? z < -hl + 0.14 && y < sill + 0.2 : z > zc1 - 0.02 && z < hl - 0.08 && y > hy; };
    const p = this.pos.array;
    for (let t = 0; t + 2 < this.n; t += 3) if (inR(t) && inR(t + 1) && inR(t + 2)) { for (let k = 1; k < 3; k++) p.copyWithin((t + k) * 3, t * 3, t * 3 + 3); this.dead[t] = this.dead[t + 1] = this.dead[t + 2] = 1; }
    this.pos.needsUpdate = true;
  }
  /** where the smoke comes out (local): the engine bay */
  vent() { return [0, this.b.belt ?? 0.9, this.hl - (this.b.hood ?? 1) * 0.5]; }
}
