// Light rigid-body helpers for the v2 sim (pure: no THREE, runs in node tests, scripts/physics_v2_test.mjs).
// Plane convention of sim/car.js: x east, z south, heading h around +y (0 = facing -z, + = left), so a point at offset (rx, rz) of a body
// spinning at w moves at (w * rz, -w * rx) and an impulse J applied there gives it the angular impulse rz * Jx - rx * Jz.
export const G = 9.81;

/** 2D impulse between bodies a and b ({ m, I, x, z, vx, vz, w }) touching at (px, pz), unit normal (nx, nz) from a towards b.
 *  e = restitution. Changes both in place (linear momentum is conserved exactly); returns the impulse (0 when already separating). */
export function collide(a, b, px, pz, nx, nz, e = 0.3) {
  const rax = px - a.x, raz = pz - a.z, rbx = px - b.x, rbz = pz - b.z;
  const vn = (b.vx + b.w * rbz - a.vx - a.w * raz) * nx + (b.vz - b.w * rbx - a.vz + a.w * rax) * nz;
  if (vn >= 0) return 0;
  const ka = raz * nx - rax * nz, kb = rbz * nx - rbx * nz, J = -(1 + e) * vn / (1 / a.m + 1 / b.m + ka * ka / a.I + kb * kb / b.I);
  a.vx -= J * nx / a.m; a.vz -= J * nz / a.m; a.w -= J * ka / a.I;
  b.vx += J * nx / b.m; b.vz += J * nz / b.m; b.w += J * kb / b.I;
  return J;
}

/** a box body's moment of inertia around its vertical axis (half length hl, half width hw) */
export const inertia = (m, hl, hw) => m * (4 * hl * hl + 4 * hw * hw) / 12;

/** a car as two circles (front / rear axle, radius = half width): -> [[x, z], [x, z]], r */
export function discs(x, z, h, hl, hw) {
  const o = Math.max(0, hl - hw), fx = -Math.sin(h) * o, fz = -Math.cos(h) * o;
  return [[x + fx, z + fz], [x - fx, z - fz]];
}

/** deepest contact between two cars (disc pairs): -> { px, pz, nx, nz, d (penetration) } or null */
export function contact(a, b) {
  let best = null;
  for (const [ax, az] of discs(a.x, a.z, a.h, a.hl, a.hw)) for (const [bx, bz] of discs(b.x, b.z, b.h, b.hl, b.hw)) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-6, d = a.hw + b.hw - L;
    if (d > 0 && (!best || d > best.d)) best = { nx: dx / L, nz: dz / L, px: ax + dx / L * a.hw, pz: az + dz / L * a.hw, d };
  }
  return best;
}

/** rigid stick falling over its base (tree, lamp post): s = { a (angle from vertical), w (angle rate), L (height) }. Lands flat with a small
 *  bounce; returns true while it still moves. */
export function fallStep(s, dt) {
  if (s.rest) return false;
  s.w += 1.5 * G / Math.max(0.5, s.L) * Math.sin(Math.max(0.02, s.a)) * dt; s.a += s.w * dt;   // uniform rod pivoting on its foot: a'' = 3g / (2L) sin a
  const lie = Math.PI / 2 - 0.04;
  if (s.a >= lie) { s.a = lie; s.w = -s.w * 0.25; if (Math.abs(s.w) < 0.3) { s.w = 0; s.rest = true; } }
  return !s.rest;
}

/** per-cell damage: what was knocked down, run over or displaced in a resident cell (stream/cells.js keeps it on the cell, evict drops it) */
export const damageOf = c => (c.dmg ||= { trees: new Set(), props: new Set() });
