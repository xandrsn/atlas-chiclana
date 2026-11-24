// Sun shadows (data/quality.json "shadow": map size, 0 = off). Two orthographic depth maps seen from the sun: near (60 m, every frame: people, vehicles,
// buildings, trees) and far (260 m, buildings and trees only, refreshed when the view or the sun has moved). The pass draws the scene's own materials,
// which return early when uPass = 1, so instancing, skinning and leaf cut-outs cast the right silhouette. Sampled with 4 hardware PCF taps.
import * as THREE from 'three';

const val = value => ({ value });
/** uniforms shared by every lit material (makeMaterials spreads them into its own set) */
export const SH = { uShNear: val(null), uShFar: val(null), uShMN: val(new THREE.Matrix4()), uShMF: val(new THREE.Matrix4()), uShT: val(new THREE.Vector2(0.06, 0.25)), uShd: val(0), uPass: val(0), uSunDir: val(new THREE.Vector3(0, 1, 0)), uNight: val(0) };

/** GLSL (fragment; needs uSunDir): sunShadow(world position, normal) = 1 lit .. 0 in shadow */
export const SHADOW_GLSL = /* glsl */`
precision highp sampler2DShadow;
uniform sampler2DShadow uShNear, uShFar; uniform mat4 uShMN, uShMF; uniform vec2 uShT; uniform float uShd, uPass;
float shPcf(sampler2DShadow m, vec3 p) {
  vec2 t = 0.75 / vec2(textureSize(m, 0)); p.z = min(p.z, 0.9999);
  return 0.25 * (texture(m, p + vec3(-t.x, -t.y * 0.4, 0.0)) + texture(m, p + vec3(t.x * 0.4, -t.y, 0.0)) + texture(m, p + vec3(t.x, t.y * 0.4, 0.0)) + texture(m, p + vec3(-t.x * 0.4, t.y, 0.0)));
}
float sunShadow(vec3 w, vec3 n) {
  if (uShd <= 0.0) return 1.0;
  float k = 1.0 - clamp(dot(n, uSunDir), 0.0, 1.0), s = 1.0;
  vec3 p = (uShMN * vec4(w + (n * (0.8 + 1.8 * k) + uSunDir) * uShT.x, 1.0)).xyz; vec2 e = abs(p.xy - 0.5); float a = smoothstep(0.43, 0.49, max(e.x, e.y));
  if (a < 1.0) s = shPcf(uShNear, p);
  if (a > 0.0) {
    p = (uShMF * vec4(w + (n * (0.8 + 1.8 * k) + uSunDir) * uShT.y, 1.0)).xyz; e = abs(p.xy - 0.5); float b = smoothstep(0.40, 0.49, max(e.x, e.y));
    s = mix(s, b < 1.0 ? mix(shPcf(uShFar, p), 1.0, b) : 1.0, a);
  }
  return mix(1.0, s, uShd);
}
`;

/** patch an unlit vertex-colour material (baked light = lowpoly.js shadeOf): sun of the hour + sky fill + sun shadows. Call last inside onBeforeCompile;
 *  N: GLSL of the normal in model space (after the pose), O: the normal the light was baked with */
export function sunLit(m, s, N = 'normal', O = 'normal') {
  m.userData.caster = true; Object.assign(s.uniforms, SH);
  s.vertexShader = 'varying vec3 vWp, vNw; varying float vO;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 wp_ = vec4(transformed, 1.0); vec3 n_ = ${N}, o_ = ${O};
#ifdef USE_INSTANCING
  wp_ = instanceMatrix * wp_; n_ = mat3(instanceMatrix) * n_;
#endif
  vWp = (modelMatrix * wp_).xyz; vNw = mat3(modelMatrix) * n_; vO = 0.62 + 0.38 * max(dot(o_, vec3(0.4494, 0.7989, 0.3995)), 0.0) + 0.08 * o_.y; }`);
  s.fragmentShader = 'varying vec3 vWp, vNw; varying float vO; uniform vec3 uSunDir;\n' + (/uniform float uNight/.test(s.fragmentShader) ? '' : 'uniform float uNight;\n') + SHADOW_GLSL + s.fragmentShader
    .replace('void main() {', 'float sh_ = 1.0;\nvoid main() {\n  if (uPass > 0.5) { gl_FragColor = vec4(1.0); return; }')
    .replace('#include <color_fragment>', `#include <color_fragment>
  { vec3 nw_ = normalize(vNw + vec3(0.0, 1e-4, 0.0)); sh_ = sunShadow(vWp, nw_);
    diffuseColor.rgb *= mix((0.60 + 0.10 * nw_.y + 0.44 * max(dot(nw_, uSunDir), 0.0) * sh_) / vO, 1.0, uNight); }`);
}

const R_FAR = 260, _v = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class SunShadows {
  /** ground(x, z) -> height; size: map size in texels (0: off) */
  constructor(scene, mats, ground, size) {
    Object.assign(this, { scene, mats, ground, size }); this.blob = mats.blob.opacity; this.t = 0; this.farT = 1e9; this.farDir = new THREE.Vector3(); this.farC = new THREE.Vector3(1e9, 0, 0); if (!size) return;
    const target = () => {
      const d = new THREE.DepthTexture(size, size, THREE.UnsignedIntType); d.compareFunction = THREE.LessEqualCompare; d.minFilter = d.magFilter = THREE.LinearFilter;
      return new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: d });
    };
    const cam = layers => { const c = new THREE.OrthographicCamera(); c.layers.disableAll(); for (const l of layers) c.layers.enable(l); return c; };
    this.near = { rt: target(), cam: cam([1, 2]), M: SH.uShMN.value }; this.far = { rt: target(), cam: cam([1]), M: SH.uShMF.value };
  }
  /** layers of the casters: 1 = cells and trees, 2 = moving things (their materials are marked by sunLit once compiled) */
  mark() {
    this.scene.traverse(o => { const m = o.material; if (!m) return; if (m === this.mats.world || m === this.mats.tree) o.layers.enable(1); else if (m.userData?.caster) o.layers.enable(2); });
  }
  pass(renderer, C, cx, cy, cz, R, dir) {
    const c = C.cam, D = R * 1.5 + 120, t = 2 * R / this.size;
    c.left = c.bottom = -R; c.right = c.top = R; c.near = 1; c.far = 2 * D; c.position.copy(dir); c.lookAt(0, 0, 0); c.updateMatrixWorld();
    _x.setFromMatrixColumn(c.matrixWorld, 0); _y.setFromMatrixColumn(c.matrixWorld, 1); _v.set(cx, cy, cz);
    const a = _v.dot(_x), b = _v.dot(_y); _v.addScaledVector(_x, Math.round(a / t) * t - a).addScaledVector(_y, Math.round(b / t) * t - b);   // whole texels: edges do not swim while moving
    c.position.copy(_v).addScaledVector(dir, D); c.updateMatrixWorld(); c.updateProjectionMatrix();
    C.M.copy(BIAS).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    renderer.setRenderTarget(C.rt); renderer.render(this.scene, c); return t;
  }
  update(renderer, cam, dt) {
    const u = this.mats.u, dir = u.uSunDir.value, s = !this.size ? 0 : (1 - u.uNight.value) * THREE.MathUtils.smoothstep(dir.y, 0.04, 0.15);
    this.mats.blob.opacity = this.blob * (1 - 0.8 * s); SH.uShd.value = s; if (!s) return;
    if ((this.t -= dt) <= 0) { this.t = 0.5; this.mark(); }
    const { x, y, z } = cam.position, g = this.ground(x, z), R = Math.min(R_FAR, 60 + Math.ceil(Math.max(0, y - g - 25) * 0.7 / 20) * 20);
    cam.getWorldDirection(_f); _f.y = 0; _f.normalize().multiplyScalar(R * 0.45); const cx = x + _f.x, cz = z + _f.z;
    SH.uShNear.value = SH.uShFar.value = null; SH.uPass.value = 1;   // never sample a map while it is being drawn
    SH.uShT.value.x = this.pass(renderer, this.near, cx, this.ground(cx, cz), cz, R, dir);
    this.farT += dt;
    if (Math.hypot(x - this.farC.x, z - this.farC.z) > 16 || this.farDir.dot(dir) < 0.99998 || this.farT > 2) {
      this.farT = 0; this.farC.copy(cam.position); this.farDir.copy(dir); SH.uShT.value.y = this.pass(renderer, this.far, x, g, z, R_FAR, dir);
    }
    SH.uPass.value = 0; SH.uShNear.value = this.near.rt.depthTexture; SH.uShFar.value = this.far.rt.depthTexture; renderer.setRenderTarget(null);
  }
}
