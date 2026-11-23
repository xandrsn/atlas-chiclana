// Procedural low-poly light helicopters (own designs) for data/vehicles/<id>.json with kind "heli": cabin with a glass nose, skids, tail
// boom, fin and a static tail rotor; the main rotor is its own geometry (buildRotor) so it can spin as a child mesh.
// Frame as carmesh.js: x right, y up, z forward, origin on the ground under the mast. Same Builder / material / paint channel.
// Per model (JSON "body", all optional): cab = side profile [[z, y]...] of the cabin, glass = indices of its glass edges, mast = rotor
// height, boom = tail boom end z, stripe = colour of a band along the cabin, door = sliding-door seam (utility types).
import { Builder, LAMP } from '../lowpoly.js';

const GLASS = '#2b3742', TRIM = '#2c2c2e', SKID = '#3a3b3d', BLADE = '#26272a', LIGHT = '#fff3cc', TAIL = '#b3121a';
const CAB = [[-1.5, 0.55], [1.2, 0.55], [2.1, 0.95], [2.05, 1.65], [1.2, 2.2], [-1.25, 2.2], [-1.7, 1.55]];
const v = (x, y, z) => ({ x, y, z });

export const heliDims = spec => { const b = spec.body || {}; return { cab: b.cab || CAB, glass: b.glass || [2, 3], mast: b.mast ?? 2.74, boom: b.boom ?? -6.1 }; };

export function heli(B, spec, lod) {
  const paint = [spec.palette[0], true], hw = spec.dims.width / 2, sk = spec.dims.skidTrack / 2, b = spec.body || {}, D = heliDims(spec);
  const cab = D.cab, top = Math.max(...cab.map(p => p[1])), zs = cab.map(p => p[0]), zF = Math.max(...zs), zB = Math.min(...zs), sh = top - 0.6;
  // cabin: side profile [z, y] extruded across x (narrower towards the roof); the glass edges and (LOD 1) the caps' front are glass
  const chw = y => hw - Math.max(0, y - sh) * 0.35;
  B.style(...paint).prism(cab, chw, i => (D.glass.includes(i) ? [GLASS, LAMP.glass] : undefined));
  if (!lod) for (const sx of [-1, 1]) {   // side windows + door line (+ stripe)
    const x = sx * (chw(1.9) + 0.01), y0 = top * 0.57, y1 = top * 0.9, za = zF - 0.55, zm = (zF + zB) / 2;
    B.style(GLASS, LAMP.glass).quad(v(x, y0, za), v(x, y0, zm - 0.2), v(x, y1, zm - 0.2), v(x, y1, za - 0.5), v(0, 1.6, zm));
    B.style(GLASS, LAMP.glass).quad(v(x, y0 + 0.05, zm - 0.4), v(x, y0 + 0.05, zB + 0.45), v(x, y1 - 0.05, zB + 0.45), v(x, y1 - 0.05, zm - 0.4), v(0, 1.6, zm));
    if (b.stripe) B.style(b.stripe).quad(v(sx * (hw + 0.012), 0.85, zF - 0.6), v(sx * (hw + 0.012), 0.85, zB + 0.1), v(sx * (hw + 0.012), 1.0, zB + 0.1), v(sx * (hw + 0.012), 1.0, zF - 0.6), v(0, 0.9, zm));
    if (b.door) B.style(TRIM).quad(v(sx * (hw + 0.014), 0.62, zm - 0.42), v(sx * (hw + 0.014), 0.62, zm - 0.38), v(sx * (hw + 0.014), top - 0.15, zm - 0.38), v(sx * (hw + 0.014), top - 0.15, zm - 0.42), v(0, 1.2, zm));
  }
  const m = D.mast, bz = D.boom;
  B.style(...paint).box(-0.55, 0.55, top, m - 0.24, zB + 0.2, Math.min(0.7, zF - 1.3), undefined, 0.85, 0.9);   // engine cowling
  B.style(TRIM).box(-0.09, 0.09, m - 0.24, m - 0.02, -0.09, 0.09);                                             // mast
  B.style(...paint).box(-0.2, 0.2, top * 0.61, top * 0.82, bz, zB + 0.2, undefined, 0.7, 1);                    // tail boom
  B.style(...paint).box(-0.05, 0.05, top * 0.7, top * 1.25, bz - 0.2, bz + 0.55, undefined, 1, 0.6);           // fin
  B.style(...paint).box(-0.95, 0.95, top * 0.68, top * 0.71, bz + 0.6, bz + 1.05);                             // stabiliser
  const tr = top * 0.93;
  B.style(BLADE).box(0.06, 0.1, tr - 0.75, tr + 0.75, bz + 0.15, bz + 0.25);                                  // tail rotor (static, two blades)
  B.style(BLADE).box(0.06, 0.1, tr - 0.05, tr + 0.05, bz + 0.2 - 0.75, bz + 0.2 + 0.75);
  for (const sx of [-1, 1]) {                                                        // skids + struts
    B.style(SKID).box(sx * sk - 0.05, sx * sk + 0.05, 0, 0.09, zB - 0.2, zF - 0.5);
    B.style(SKID).box(sx * sk - 0.05, sx * sk + 0.05, 0.05, 0.22, zF - 0.5, zF - 0.15, undefined, 1, 0.4);
    for (const z of [-0.9, 0.9]) B.style(SKID).box(Math.min(sx * sk, sx * (hw - 0.2)) - 0.04, Math.max(sx * sk, sx * (hw - 0.2)) + 0.04, 0.05, 0.6, z - 0.05, z + 0.05);
  }
  B.style(LIGHT, LAMP.head).box(-0.1, 0.1, 0.62, 0.72, zF - 0.35, zF - 0.15);   // landing light
  B.style(TAIL, LAMP.tail).box(-0.05, 0.05, top * 1.25, top * 1.29, bz - 0.1, bz + 0.1);   // beacon
}

/** main rotor: blades through the hub, centred on the mast (spin it with mesh.rotation.y) */
export function buildRotor(spec) {
  const B = new Builder();
  rotor(B, spec);
  return B.geometry();
}
export function rotor(B, spec) {
  const r = spec.dims.rotor / 2, m = heliDims(spec).mast, n = spec.body?.blades ?? 2;
  for (let k = 0; k < n; k++) {   // blade k at angle k * PI / n (each box crosses the hub: 2 blades per box)
    if (k % 2 && n === 2) { B.style(BLADE).box(-0.16, 0.16, m, m + 0.04, -r, r); continue; }
    const a = k * Math.PI / n, c = Math.cos(a), s = Math.sin(a), P = (u, w, y) => v(c * u - s * w, y, s * u + c * w);
    B.style(BLADE); B.hexa([P(-r, -0.16, m), P(r, -0.16, m), P(-r, -0.16, m + 0.04), P(r, -0.16, m + 0.04), P(-r, 0.16, m), P(r, 0.16, m), P(-r, 0.16, m + 0.04), P(r, 0.16, m + 0.04)]);
  }
  B.style(TRIM).box(-0.22, 0.22, m - 0.04, m + 0.1, -0.22, 0.22);
}
