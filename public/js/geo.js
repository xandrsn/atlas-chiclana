// Geo helpers. World = local metres, x east, z south, y up. Web-Mercator scaled by cos(lat0) so units are ~true metres.
export const R = 6378137;
// one map per page load: ?map=madrid (browser) or MAP=madrid (node scripts); default = Chiclana
const MAPID = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('map') : globalThis.process?.env?.MAP;
// centre of the municipality's bbox / of the M-30 ring; must equal data/maps.json origin (bake_cells checks it)
const ORIGINS = { madrid: { lat: 40.4377, lon: -3.694 }, cadiz: { lat: 36.4947, lon: -6.2613 }, sevilla: { lat: 37.3766, lon: -5.926 } };
export const ORIGIN = ORIGINS[MAPID] || { lat: 36.4015, lon: -6.1056 };
const D2R = Math.PI / 180;

export const merc = (lon, lat) => [R * lon * D2R, R * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))];
const [MX0, MY0] = merc(ORIGIN.lon, ORIGIN.lat);
export const K = Math.cos(ORIGIN.lat * D2R);

export const toLocal = (lon, lat) => { const [mx, my] = merc(lon, lat); return [(mx - MX0) * K, (MY0 - my) * K]; };
export const toLonLat = (x, z) => {
  const mx = x / K + MX0, my = MY0 - z / K;
  return [mx / R / D2R, (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / D2R];
};

export const TILE_M = z => 2 * Math.PI * R / 2 ** z;                     // tile edge in mercator metres
export const lonLatToTile = (lon, lat, z) => {
  const [mx, my] = merc(lon, lat), s = TILE_M(z);
  return [Math.floor((mx + Math.PI * R) / s), Math.floor((Math.PI * R - my) / s)];
};
/** top-left corner (x0,z0) and edge length (metres, world units) of slippy tile z/tx/ty */
export const tileRect = (z, tx, ty) => {
  const s = TILE_M(z), mx = -Math.PI * R + tx * s, my = Math.PI * R - ty * s;
  return [(mx - MX0) * K, (MY0 - my) * K, s * K];
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
