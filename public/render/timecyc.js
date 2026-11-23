// Day/night cycle by bands (data/timecyc.json). Pure functions, no three.js, so node tests and the renderer share them.
// getTimecyc(hour, tc) -> { hour, band, zenith, horizon, fog (sRGB bytes), fogNear, fogFar (fraction of draw distance),
//   light (vertex tint multiplier), ambient, sun (0..1), sunInt, sunDir (unit vector, y up, -z north), lamps, windows (0..1), lampsOn, windowsOn }

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : lerp(a, b, t);

/** hour wrapped to [0, 24) */
export const wrapHour = h => ((h % 24) + 24) % 24;

/** sun direction: rises in the east (+x), noon to the south (+z), sets in the west; below the horizon it becomes a low moon opposite */
export function sunDirection(h, sunrise = 7.5, sunset = 20.5) {
  const day = h >= sunrise && h <= sunset;
  const t = day ? (h - sunrise) / (sunset - sunrise) : wrapHour(h - sunset) / (24 - (sunset - sunrise));   // 0..1 across the arc
  const a = t * Math.PI, y = Math.sin(a) * (day ? 0.85 : 0.6) + 0.08;   // +0.08: keep the light a bit above the ground at dawn/dusk
  const x = Math.cos(a) * (day ? 1 : -1), z = day ? 0.35 : -0.35, n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

export function getTimecyc(hour, tc) {
  const K = tc.keys, h = wrapHour(hour);
  let i = 0; while (i < K.length - 2 && h >= K[i + 1].h) i++;
  const a = K[i], b = K[i + 1], t = (h - a.h) / (b.h - a.h), out = { hour: h, band: a.band };   // a band starts at its key
  for (const k in a) if (k !== 'h' && k !== 'band') out[k] = mix(a[k], b[k], t);
  out.lampsOn = out.lamps > 0.5; out.windowsOn = out.windows > 0.5;
  out.sunDir = sunDirection(h, tc.sunrise, tc.sunset);
  return out;
}

/** CSS colour from sRGB bytes (sky gradients in the UI / loading screen) */
export const css = c => `rgb(${c.map(v => Math.round(v)).join(',')})`;
