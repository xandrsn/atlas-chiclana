// The protagonist drawn as a THREE.SkinnedMesh on the procedural rig (peds/rig.js): one continuous skinned mesh of the player's own
// outfit, posed every frame from the walker state (sim/player.js: gait, jump, scripted falls) or a boarding sequence (sim/board.js),
// with a crossfade between poses (no jumps). Unlit like every v2 mesh: the material colour is the time-of-day light (play.js copies it).
import * as THREE from 'three';
import { Rig, Animator, ss } from '../peds/rig.js';

export class Avatar {
  constructor(recipe) {
    this.rig = new Rig(recipe); this.anim = new Animator(); this.t = 0;
    const { root, bones, skeleton } = this.rig.skeleton(); this.bones = bones;
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const m = this.mesh = new THREE.SkinnedMesh(this.rig.geometry(recipe), this.mat);
    m.add(root); m.updateMatrixWorld(true); m.bind(skeleton); m.frustumCulled = false;   // shortcut: never culled (one mesh, always near the camera)
  }
  /** pose key + crossfade time for the walker state; fills the animator's live target */
  walker(pl, wet) {
    const r = this.rig, T = this.anim.T, a = pl.act, t = this.t;
    if (a?.k === 'knock') { r.air(T, { vy: a.vy, fall: 1, t }); return ['knock', 0.1]; }
    if (a?.k === 'lie') { r.lie(T, a.face); return ['lie' + a.face, 0.18]; }
    if (a?.k === 'getup') { r.getup(T, Math.min(1, a.t / 1.5), a.face); return ['getup', 0.08]; }
    if (a?.k === 'roll') { r.roll(T, Math.min(1, a.t / 0.95)); return ['roll', 0.08]; }
    if (a?.k === 'stumble') { r.stumble(T, Math.min(1, a.t / 0.75)); return ['stumble', 0.1]; }
    if (pl.air) { r.air(T, { vy: pl.vy, fall: ss(0.45, 1.3, pl.fall || 0), t }); return ['air', 0.12]; }
    if (wet) { r.swim(T, t); return ['swim', 0.3]; }
    const g = pl.gait; r.loco(T, { ph: pl.ph, A: pl.stride, walk: Math.max(Math.min(1, g), 0.6 * pl.spin), run: Math.max(0, g - 1), cr: pl.cr, slope: pl.slope, t });
    return ['loco', 0.2];
  }
  /** advance: s = [key, fade] from walker() or a boarding pose (the caller filled anim.T) */
  update(dt, [key, fade]) { this.t += dt; this.rig.apply(this.anim.update(dt, key, fade), this.bones); }
}
