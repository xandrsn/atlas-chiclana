// The driver's door of the player's car as a separate piece (only that car): the left-side faces of the body inside the front door
// outline (vehicles/carmesh.js seams: front door from the B-pillar seam to the windscreen base, stopped before the front wheel arch,
// up to the roof) are cut out of the body geometry (polygons clipped, attributes interpolated) and drawn as their own mesh that turns on
// its front hinge. The door gets a dark inner panel; the cabin behind the hole gets a dark lining (floor, far side, roof, dash) and the
// driver's seat, so an open door shows an interior, not the far side of the shell. Model frame: x + = left, y up, z forward.
import * as THREE from 'three';
import { Builder } from '../lowpoly.js';

const INTERIOR = '#232220', SEAT = '#3b3430';

/** door outline + seat of a closed car spec, or null (bikes, convertibles, pickups: no door piece) */
export function doorFrame(spec) {
  const d = spec.dims, b = spec.body;
  if (spec.kind !== 'car' || !b || b.open || b.bed) return null;
  const L = d.length, hw = d.width / 2, zc1 = L / 2 - b.hood, zc0 = -L / 2 + b.deck, roof = b.roof ?? d.height, sill = d.groundClearance;
  const four = b.windows.panes >= 2, rear = four ? (zc0 + zc1) / 2 + 0.1 : zc1 - b.wsRake - 0.6;
  const front = Math.min(zc1 - 0.05, d.wheelbase / 2 - d.wheelRadius * 1.25);
  const seat = { x: Math.min(0.38, hw - 0.42), y: Math.max(sill + 0.28, b.belt - 0.42), z: rear + 0.3 };
  if (L > 5.6 || front - rear < 0.5) return null;   // shortcut: buses and cab-forward vans keep the instant get-in (no door piece), until they get their own door layout
  return { hw, rear, front, top: roof - 0.04, sill, belt: b.belt, roof, seat, len: front - rear };
}

/** clip polygon (arrays of vertex attribute rows) to the half-space sign * (v[axis] - val) <= 0 */
function clip(poly, axis, val, sign) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = sign * (a[axis] - val), db = sign * (b[axis] - val);
    if (da <= 0) out.push(a);
    if (da < 0 && db > 0 || da > 0 && db < 0) { const t = da / (da - db); out.push(a.map((x, k) => x + (b[k] - x) * t)); }
  }
  return out;
}

/** body geometry -> { body (door faces removed + cabin lining + seat), door (pivot at the hinge: local x / z from the hinge) } or null */
export function cutDoor(geo, spec) {
  const F = doorFrame(spec); if (!F) return null;
  const names = ['position', ...Object.keys(geo.attributes).filter(n => n !== 'position')], sizes = names.map(n => geo.attributes[n].itemSize);   // position first: rows start x, y, z
  const row = i => { const r = []; names.forEach((n, k) => { const a = geo.attributes[n]; for (let c = 0; c < sizes[k]; c++) r.push(a.array[i * sizes[k] + c]); }); return r; };
  const body = [], door = [], push = (dst, poly) => { for (let i = 1; i + 1 < poly.length; i++) dst.push(poly[0].slice(), poly[i].slice(), poly[i + 1].slice()); };   // copies: rows are edited in place below
  const N = geo.attributes.position.count, ni = names.indexOf('normal'), no = sizes.slice(0, ni).reduce((a, b) => a + b, 0);
  for (let t = 0; t < N; t += 3) {
    const tri = [row(t), row(t + 1), row(t + 2)];
    // a left-side face (outward normal mostly +x, every corner on the left half): the part inside the door outline goes to the door
    if (!(tri[0][no] > 0.5 && tri.every(v => v[0] > F.hw * 0.55))) { push(body, tri); continue; }
    let rest = tri;
    for (const [axis, val, sign] of [[2, F.rear, 1], [2, F.front, -1], [1, F.top, -1]]) {   // outside pieces: z < rear, z > front, y > top
      const outside = clip(rest, axis, val, sign); if (outside.length >= 3) push(body, outside);
      rest = clip(rest, axis, val, -sign); if (rest.length < 3) break;
    }
    if (rest.length >= 3) push(door, rest);
  }
  // dark lining inside the cabin, facing in (seen through the door opening), and the driver's seat
  const B = new Builder(), v = (x, y, z) => new THREE.Vector3(x, y, z), x0 = -F.hw + 0.12, x1 = F.hw - 0.1, y0 = F.sill + 0.12, y1 = F.roof - 0.06, z0 = F.rear - 0.7, z1 = F.front + 0.05;
  B.style(INTERIOR);
  B.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), v(0, y0 - 1, (z0 + z1) / 2));   // floor
  B.quad(v(x0, y0, z0), v(x0, y1, z0), v(x0, y1, z1), v(x0, y0, z1), v(x0 - 1, (y0 + y1) / 2, (z0 + z1) / 2));   // far side
  B.quad(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1), v(0, y1 + 1, (z0 + z1) / 2));   // roof lining
  B.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(0, (y0 + y1) / 2, z1 + 1));   // dash / bulkhead
  B.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), v(0, (y0 + y1) / 2, z0 - 1));   // behind the seats
  B.style('#111214').box(F.seat.x - 0.17, F.seat.x + 0.17, F.belt - 0.08, F.belt + 0.02, z1 - 0.3, z1 - 0.05);   // dashboard
  B.style(SEAT).box(F.seat.x - 0.23, F.seat.x + 0.23, y0, F.seat.y, F.seat.z - 0.3, F.seat.z + 0.22);   // cushion
  B.style(SEAT).box(F.seat.x - 0.22, F.seat.x + 0.22, F.seat.y, Math.min(y1 - 0.08, F.seat.y + 0.62), F.seat.z - 0.38, F.seat.z - 0.24);   // backrest
  const lin = B.geometry(), li = names.map(n => lin.attributes[n]);
  for (let i = 0; i < lin.attributes.position.count; i++) { const r = []; names.forEach((n, k) => { for (let c = 0; c < sizes[k]; c++) r.push(li[k] ? li[k].array[i * sizes[k] + c] : 0); }); body.push(r); }
  // the door's inner panel: its faces again, reversed, dark, 3 cm inside; then move the door into hinge space
  const dark = new THREE.Color(INTERIOR), ci = names.indexOf('color'), co = sizes.slice(0, ci).reduce((a, b) => a + b, 0), pi = names.indexOf('aPaint'), po = sizes.slice(0, pi).reduce((a, b) => a + b, 0);
  const n0 = door.length;
  for (let i = 0; i < n0; i += 3) for (const j of [i, i + 2, i + 1]) {
    const r = door[j].slice(); r[0] -= 0.03; r[no] = -r[no]; r[no + 1] = -r[no + 1]; r[no + 2] = -r[no + 2];
    if (ci >= 0) { r[co] = dark.r * 0.7; r[co + 1] = dark.g * 0.7; r[co + 2] = dark.b * 0.7; } if (pi >= 0) r[po] = 0; door.push(r);
  }
  const hinge = [F.hw, 0, F.front];
  for (const r of door) { r[0] -= hinge[0]; r[2] -= hinge[2]; }
  const make = rows => {
    const g = new THREE.BufferGeometry();
    names.forEach((n, k) => { const s = sizes[k], o = sizes.slice(0, k).reduce((a, b) => a + b, 0), a = new Float32Array(rows.length * s); rows.forEach((r, i) => { for (let c = 0; c < s; c++) a[i * s + c] = r[o + c]; }); g.setAttribute(n, new THREE.BufferAttribute(a, s)); });
    g.computeBoundingSphere(); g.computeBoundingBox(); g.userData = { ...geo.userData }; return g;
  };
  return { body: make(body), door: make(door), hinge, frame: F, doorTris: n0 / 3 };
}
