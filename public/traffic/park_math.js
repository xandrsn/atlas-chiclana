// Pure helpers shared by scripts/parking_data.mjs (bake) and the client (traffic/ambient.js). No THREE.

/** integer -> [0,1) deterministic hash */
export function hash(n) { let t = (n | 0) * 0x9e3779b1; t = Math.imul(t ^ (t >>> 15), 0x85ebca6b); t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; }

/** separating-axis test of two oriented slots [x, z, heading] of half length hl and half width hw (heading 0 = facing -z) */
export function slotsOverlap(a, b, hl, hw) {
  const ax = [[-Math.sin(a[2]), -Math.cos(a[2])], [Math.cos(a[2]), -Math.sin(a[2])]], bx = [[-Math.sin(b[2]), -Math.cos(b[2])], [Math.cos(b[2]), -Math.sin(b[2])]];
  const dx = b[0] - a[0], dz = b[1] - a[1], ext = [hl, hw];
  for (const n of [...ax, ...bx]) {
    const ra = ext[0] * Math.abs(ax[0][0] * n[0] + ax[0][1] * n[1]) + ext[1] * Math.abs(ax[1][0] * n[0] + ax[1][1] * n[1]);
    const rb = ext[0] * Math.abs(bx[0][0] * n[0] + bx[0][1] * n[1]) + ext[1] * Math.abs(bx[1][0] * n[0] + bx[1][1] * n[1]);
    if (Math.abs(dx * n[0] + dz * n[1]) >= ra + rb) return false;
  }
  return true;
}

/** point inside an oriented box (x, z, heading, half length, half width) grown by r */
export function inBox(px, pz, x, z, h, hl, hw, r = 0) {
  const dx = px - x, dz = pz - z, f = -Math.sin(h) * dx - Math.cos(h) * dz, s = Math.cos(h) * dx - Math.sin(h) * dz;
  return Math.abs(f) < hl + r && Math.abs(s) < hw + r;
}

/** weighted pick: items [{ w }], u in [0,1) */
export function pickWeighted(items, u) { let t = items.reduce((a, b) => a + b.w, 0) * u; for (const it of items) if ((t -= it.w) < 0) return it; return items[items.length - 1]; }
