// "Super bulldozer" meshes (kind 'dozer', data/vehicles/hornaza-derribo.json), frame as carmesh.js (+z front, origin on the ground at the centre).
// part 'all' = the whole machine in one static geometry (parked ones in the traffic fleet, tests); 'body' = hull, cab and track frames only;
// 'blade' = the push blade with its arms, origin on the trunnion (a child mesh rotated about x: + = lowered); 'grouser' = one track shoe.
// sim/play.js animates the blade and 2 x GROUSERS shoes along TRACK_PATH while the dozer is the player's vehicle.
import * as THREE from 'three';
import { Builder, LAMP } from '../lowpoly.js';

const STEEL = '#55595e', DARK = '#26262a', GLASS = '#2b3742', HEAD = '#fff3cc', TAIL = '#b3121a', EDGE = '#8a8e93';
export const PIVOT = [0, 1.1, 0.75];   // blade trunnion (x, y, z)
export const GROUSERS = 28, TRACK_R = 0.55, TRACK_Z = 1.65;   // shoes per side; sprocket radius; sprocket centre z
const LOOP = 2 * (2 * TRACK_Z) + 2 * Math.PI * TRACK_R;
/** point of the track loop at distance s (m, any real): [y, z, tilt about x] of a shoe; the loop = bottom run, front arc, top run, rear arc */
export function TRACK_PATH(s) {
  s = ((s % LOOP) + LOOP) % LOOP; const run = 2 * TRACK_Z, arc = Math.PI * TRACK_R, r = TRACK_R;
  if (s < run) return [0.05, -TRACK_Z + s, 0];
  if (s < run + arc) { const a = (s - run) / r; return [r - r * Math.cos(a), TRACK_Z + r * Math.sin(a), a]; }
  if (s < 2 * run + arc) return [2 * r - 0.05, TRACK_Z - (s - run - arc), Math.PI];
  const a = (s - 2 * run - arc) / r; return [r + r * Math.cos(a), -TRACK_Z - r * Math.sin(a), Math.PI + a];
}
export const TRACK_LOOP = LOOP;

export function dozer(B, spec, lod, part = 'all') {
  const d = spec.dims, hw = d.width / 2, tr = d.track / 2, tw = d.wheelWidth, hi = lod === 0;
  const P = true, box = (...a) => B.box(...a);
  if (part === 'grouser') { B.style(STEEL).box(-tw / 2, tw / 2, -0.05, 0.05, -0.09, 0.09); return; }
  const blade = (oy, oz) => {
    const bx = (x0, x1, y0, y1, z0, z1, ...r) => box(x0, x1, y0 + oy, y1 + oy, z0 + oz, z1 + oz, ...r);
    B.style(STEEL);
    if (hi) for (const s of [-1, 1]) bx(s * 1.45 - 0.12, s * 1.45 + 0.12, -0.2, 0.15, 0.0, 1.75);   // push arms
    B.style('#e0a81c', P).box(-hw, hw, -1.0 + oy, 0.2 + oy, 1.7 + oz, 2.05 + oz, null, 1, 1);   // moulboard
    B.style('#e0a81c', P).box(-hw, hw, 0.0 + oy, 0.42 + oy, 1.55 + oz, 2.2 + oz, null, 1, 0.7);   // curled top lip
    B.style(EDGE).box(-hw, hw, -1.05 + oy, -0.82 + oy, 1.7 + oz, 2.18 + oz);   // cutting edge
  };
  if (part === 'blade') { blade(0, 0); return; }
  const dz = (x0, x1, y0, y1, z0, z1, ...r) => box(x0, x1, y0, y1, z0, z1, ...r);
  for (const s of [-1, 1]) {   // track frames, sprockets
    B.style(DARK); dz(s * tr - tw / 2, s * tr + tw / 2, 0, 1.1, -2.3, 2.3, null, 1, 0.8);
    if (hi) { B.style(STEEL); for (const z of [-TRACK_Z, TRACK_Z]) B.cylX(s * tr, TRACK_R, z, TRACK_R * 0.95, tw + 0.06, 8, null, s); }
  }
  B.style('#e0a81c', P).box(-1.0, 1.0, 0.7, 1.4, -2.5, 1.1);   // hull
  B.style('#e0a81c', P).box(-0.9, 0.9, 1.4, 2.0, -0.4, 1.1, null, 0.85, 0.9);   // engine hood
  B.style('#e0a81c', P).box(-0.95, 0.95, 1.4, 3.3, -2.3, -0.5, n => n === 'y+' ? null : undefined, 1, 1);   // cab
  B.style('#e0a81c', P).box(-1.05, 1.05, 3.3, 3.5, -2.4, -0.4);   // roof
  B.style(GLASS, LAMP.glass).box(-0.98, 0.98, 2.0, 3.2, -2.2, -0.55, n => n === 'y-' || n === 'y+' ? null : undefined);
  B.style(DARK).box(-0.95, 0.95, 0.7, 1.0, -2.95, -2.5);   // ripper / counterweight
  if (hi) {
    B.style(DARK).box(0.5, 0.64, 2.0, 3.35, 0.7, 0.84);   // exhaust stack
    for (const s of [-1, 1]) { B.style(HEAD, LAMP.head).box(s * 0.7 - 0.15, s * 0.7 + 0.15, 1.2, 1.4, 1.1, 1.14); B.style(TAIL, LAMP.tail).box(s * 0.7 - 0.15, s * 0.7 + 0.15, 1.0, 1.2, -2.54, -2.5); }
  }
  if (part === 'all') blade(PIVOT[1], PIVOT[2]);
}

/** geometry of one part of the dozer: 'all' | 'body' | 'blade' | 'grouser' */
export function buildDozer(spec, part = 'all', lod = 0) { const B = new Builder(); dozer(B, spec, lod, part); const g = B.geometry(); g.userData = { id: spec.id, lod, triangles: B.triangles ?? B.pos.length / 9 }; return g; }
