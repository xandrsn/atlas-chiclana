import * as THREE from 'three';
// "Venus al Sol" (a.k.a. "La Gorda") by José Hermida: seated bronze nude on a white fluted pedestal, in the roundabout
// Plaza Víctimas del Terrorismo next to the Puente del VII Centenario. Dimensions/pose are estimated from one 3D-scan thumbnail.
const bronze = new THREE.MeshLambertMaterial({ color: 0x3c4148 }), white = new THREE.MeshLambertMaterial({ color: 0xf0ede4 });
const stone = new THREE.MeshLambertMaterial({ color: 0xcfc9ba }), grass = new THREE.MeshLambertMaterial({ color: 0x4f8a3a }), soil = new THREE.MeshLambertMaterial({ color: 0x7a4a2e });
const ell = (rx, ry, rz, x, y, z, rot = [0, 0, 0]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bronze); m.scale.set(rx, ry, rz); m.position.set(x, y, z); m.rotation.set(...rot); return m; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); return m; };
export function venusModel() {
  const g = new THREE.Group();
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.2, 24), grass); lawn.position.y = 0.1; g.add(lawn);
  g.add(box(2.7, 0.3, 2.7, stone, 0, 0.2), box(2.3, 0.15, 2.3, white, 0, 0.5));
  const body = box(2.0, 1.4, 2.0, white, 0, 0.65); g.add(body);
  for (let i = -4; i <= 4; i++) { g.add(box(0.12, 1.3, 0.06, stone, i * 0.22, 0.7, 1.02), box(0.06, 1.3, 0.12, stone, 1.02, 0.7, i * 0.22)); }
  g.add(box(2.2, 0.15, 2.2, white, 0, 2.05), box(1.9, 0.04, 1.9, soil, 0, 2.2));
  const y = 2.2, s = new THREE.Group(); s.position.y = y;
  s.add(ell(0.62, 0.45, 0.6, 0, 0.45, 0));                    // hips / seat
  s.add(ell(0.55, 0.72, 0.5, 0, 1.25, -0.05));                // torso
  s.add(ell(0.2, 0.12, 0.2, -0.28, 1.58, 0.28), ell(0.2, 0.12, 0.2, 0.28, 1.58, 0.28)); // bust
  s.add(ell(0.2, 0.24, 0.2, 0, 2.05, 0.02), ell(0.1, 0.1, 0.2, 0.2, 2.15, -0.2));        // head + hair tuft
  s.add(ell(0.28, 0.2, 0.55, -0.32, 0.55, 0.55, [-0.2, 0, 0]), ell(0.28, 0.2, 0.55, 0.32, 0.55, 0.55, [-0.2, 0, 0])); // thighs
  s.add(ell(0.2, 0.55, 0.2, -0.32, 0.0, 1.0), ell(0.2, 0.55, 0.2, 0.32, 0.0, 1.0));       // calves hanging down the front
  s.add(ell(0.2, 0.1, 0.35, -0.32, -0.5, 1.15), ell(0.2, 0.1, 0.35, 0.32, -0.5, 1.15));   // feet
  s.add(ell(0.14, 0.14, 0.7, -0.78, 0.95, 0.05, [0, 0, -0.5]));                          // left arm propped on the plinth
  s.add(ell(0.14, 0.14, 0.5, 0.7, 1.1, 0.15, [0, 0, 0.3]));                               // right arm resting on the thigh
  g.add(s);
  return g;
}
