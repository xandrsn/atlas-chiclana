// Vehicle catalogue (data/vehicles/index.json + one data/vehicles/<id>.json per model) and the mapping from each model's "handling"
// block to the arcade sim parameters (sim/car.js Car, sim/heli.js Heli). Pure: no THREE, runs in node tests.
const KMH = 1 / 3.6, ARCADE = 2.5, PUNCH = 3.4;   // sandbox: launches and stops harder than the real-world figures; PUNCH = engine power boost so the top speed is reached in ~15-20 s

/** -> [spec, ...] in index order; get(url) -> parsed JSON */
export async function loadCatalog(get) {
  const idx = await get('/data/vehicles/index.json');
  return Promise.all(idx.vehicles.map(id => get(`/data/vehicles/${id}.json`)));
}

/** catalogue "handling" -> Car params. Mass and power set the pull (power-limited above ~10 m/s), grip caps the yaw rate, the suspension
 *  block drives the visual body roll / pitch (spring rate per wheel x wheels, damping, centre of mass height, roll factor) */
export function carParams(spec) {
  const H = spec.handling, d = spec.dims, S = H.suspension, m = H.mass, wheels = spec.kind === 'bike' ? 2 : 4;
  const maxSpeed = H.maxSpeedKmh * KMH, k = S.stiffness * wheels / m, power = H.powerKW * 1000 * 0.85 * ARCADE * PUNCH / m, accel = Math.max(4, 100 * KMH / H.accel0to100 * ARCADE);
  return {
    accel, power, brake: H.brakeDecel * ARCADE, maxSpeed, reverse: Math.min(8, maxSpeed * 0.3),
    drag: Math.min(accel, power / (maxSpeed * 1.12)) / (maxSpeed * 1.12),   // the pull still beats drag up to 12 % over the data's top speed: the cap is reached, not approached forever
    wheelbase: d.wheelbase, steerMax: H.steerMaxDeg * Math.PI / 180, falloff: H.steerSpeedFalloff, grip: H.grip * 1.4,
    k, c: S.damping * wheels / m, rollK: m * H.comHeight * S.rollFactor / (S.stiffness * wheels) * 1.2, pitchK: m * H.comHeight / (S.stiffness * wheels * d.wheelbase) * 2, lean: spec.kind === 'bike',
    mass: m, halfL: d.length / 2, halfW: d.width / 2, height: d.height, track: d.track || d.width, comH: spec.kind === 'bike' ? 0 : H.comHeight,
    ...spec.kind === 'dozer' ? { skid: true, crush: true, noRoll: true, turn: 0.75, accel: 2.2, power: 0, brake: 5, k: 40, c: 14, rollK: 0.02, pitchK: 0.004, wheelbase: undefined } : {},
  };
}

/** catalogue "flight" block -> Heli params */
export function heliParams(spec) {
  const F = spec.flight, maxSpeed = F.maxSpeedKmh * KMH, accel = F.accel;
  return { maxSpeed, accel, drag: accel / maxSpeed, climb: F.climb, yawRate: F.yawRate, ceiling: F.ceiling, halfL: spec.dims.length / 2, halfW: spec.dims.width / 2 };
}

/** orbit camera config for a model: farther and higher for long / tall vehicles (data/controls.json camera is the base) */
export function camFor(base, spec) {
  const d = spec.dims; if (spec.kind === 'heli') return { ...base, distCar: 15, pivotCar: 2.2 };
  if (spec.kind === 'tram') return { ...base, distCar: 22, pivotCar: 3.4 };
  return { ...base, distCar: Math.max(base.distCar, d.length * 1.15 + 4), pivotCar: Math.max(base.pivotCar, d.height * 0.6 + 0.6) };
}

/** HUD text for the vehicle in use: the real make and model; types without a real model yet show their type. '' on foot */
const TYPE = { autobus: 'Autobús', camion: 'Camión', basura: 'Camión de basura', moto: 'Moto', scooter: 'Escúter', topadora: 'Topadora', tram: 'Tranvía' };
export const vehicleName = s => !s ? '' : TYPE[s.archetype ?? s.kind] ?? `${s.make} ${s.model}`;
