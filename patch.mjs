import fs from 'node:fs';
const R = (f, pairs) => { let s = fs.readFileSync(f, 'utf8'); for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(f + ' expected 1 match, got ' + n + ': ' + a.slice(0, 60)); s = s.replace(a, () => b); } fs.writeFileSync(f, s); };
const P = 'C:/dev/atlas-chiclana/public/';
// maps.js: Chiclana only in the web build
let m = fs.readFileSync(P + 'js/maps.js', 'utf8');
const i0 = m.indexOf('  madrid: {'), i1 = m.indexOf('};', i0);
m = m.slice(0, i0) + m.slice(i1);
fs.writeFileSync(P + 'js/maps.js', m);
R(P + 'js/maps.js', [
  ["const id = new URLSearchParams(location.search).get('map');", "const id = 'chiclana';   // web build: only Chiclana is published"],
  ["document.title = MAP.id === 'chiclana' ? 'Chiclana Sim' : 'Chiclana Sim · ' + MAP.name;", "document.title = 'ATLAS · ' + MAP.name;"],
]);
// net.js: multiplayer needs the local server (npm start); the web build cannot host the WebSocket lobby
R(P + 'js/net.js', [
  ["  join(name, color) {\n", "  join(name, color) {\n    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return this.msg('Multijugador: solo con el servidor local (ver README)');\n"],
]);
// index.html: pinned three.js, data/tiles/street shim, credits
R(P + 'index.html', [
  ['<title>Chiclana Sim</title>', '<title>ATLAS · Chiclana</title>'],
  ['"three": "/vendor/three/build/three.module.js", "three/addons/": "/vendor/three/examples/jsm/"', '"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"'],
  ['<div id="loader">', `<div id="madeby" class="panel">Made by <a href="https://charlieandersen.vercel.app" target="_blank" rel="noopener">Charlie Andersen ↗</a> · <a href="https://github.com/xandrsn/atlas-chiclana" target="_blank" rel="noopener">código</a> · <a href="https://github.com/xandrsn/atlas-generator" target="_blank" rel="noopener">genera tu mapa ↗</a></div>

<div id="loader">`],
  ['<script type="importmap">', `<script>
// Web build: no Node server. Data comes from the pinned data repo, PNOA tiles straight from IGN (CORS *), street names are off (no server proxy).
(() => {
  const DATA = 'https://raw.githubusercontent.com/xandrsn/atlas-chiclana-data/v1/data/';
  const IGN = 'https://www.ign.es/wmts/pnoa-ma?request=getTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg&tilematrixset=GoogleMapsCompatible';
  const f0 = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || '', ms = u.match(/^\/tiles\/(ortho|dem)\/(\d+)\/(\d+)\/(\d+)\.(jpg|png)$/);
    if (u.startsWith('/data/')) return f0(DATA + u.slice(6), init);
    if (u.startsWith('/api/street')) return Promise.resolve(new Response('', { status: 404 }));   // handled by the UI's catch: no request leaves the page
    if (ms && ms[1] === 'ortho') return f0(\`\${IGN}&tilematrix=\${ms[2]}&tilerow=\${ms[4]}&tilecol=\${ms[3]}\`, init);
    if (ms) return f0(\`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/\${ms[2]}/\${ms[3]}/\${ms[4]}.png\`, init);
    return f0(input, init);
  };
})();
</script>
<script type="importmap">`],
]);
console.log('patched');
