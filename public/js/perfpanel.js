// Performance panel (F3 or ?perf). Reads what main.js/diag.js already measure; while hidden the per-frame cost is one boolean check in main.js.
// Rows: FPS, CPU ms per system (exponential averages from Diag.time), renderer.info, JS heap, DPR / canvas size, streamed cells per LOD, GPU name + GPU ms.
const GROUPS = [   // panel row -> Diag.time() names measured in main.js
  ['física + cámara', ['vehicle']], ['tráfico + aparcados', ['traffic']], ['NPCs', ['npcs']], ['ragdolls', ['ragdoll']],
  ['streaming / celdas', ['terrain', 'underground', 'bldgs', 'cells', 'sancti']], ['lugares / monumentos', ['monum', 'bernabeu']],
  ['render (CPU)', ['render']], ['audio', ['audio']], ['minimapa', ['minimap']], ['nombre de calle', ['street']],
];
export class PerfPanel {
  constructor(renderer, diag, extra) {
    this.r = renderer; this.d = diag; this.extra = extra; this.t = 0;
    this.el = document.createElement('pre'); this.el.id = 'perfPanel';
    this.el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:50;margin:0;padding:8px 10px;background:rgba(0,0,0,.78);color:#bfe;font:12px/1.4 monospace;pointer-events:none;white-space:pre;display:none';
    document.body.appendChild(this.el);
    addEventListener('keydown', e => { if (e.code === 'F3') { e.preventDefault(); this.show(!this.on); } });
    this.show(new URLSearchParams(location.search).has('perf'));
  }
  show(v) { this.on = v; this.el.style.display = v ? 'block' : 'none'; }
  update(now) {
    if (now - this.t < 250) return; this.t = now;   // text refresh at 4 Hz; the numbers themselves are per-frame averages
    const d = this.d, t = d.t, r = this.r, info = r.info, ri = info.render, m = performance.memory, x = this.extra(), f = v => v == null ? 'n/d' : v.toFixed(2);
    const rows = GROUPS.map(([label, ks]) => { const v = ks.reduce((a, k) => a + (t[k] || 0), 0); return `  ${label.padEnd(22)} ${v.toFixed(2).padStart(6)} ms`; });
    const c = r.domElement, b = x.bld, w = x.cells, tr = x.terrain;
    this.el.textContent = [
      `FPS ${(1000 / d.frameMs).toFixed(0)}  ·  frame ${d.frameMs.toFixed(1)} ms  ·  CPU JS ${d.jsMs.toFixed(1)} ms  ·  GPU ${d.ext ? f(d.gpuMs) + ' ms' : 'n/d (sin EXT_disjoint_timer_query_webgl2)'}`,
      'CPU por sistema (media móvil):', ...rows,
      `draw calls ${ri.calls}  ·  triángulos ${(ri.triangles / 1000).toFixed(0)}k  ·  geometrías ${info.memory.geometries}  ·  texturas ${info.memory.textures}  ·  programas ${info.programs?.length ?? '?'}`,
      `memoria JS ${m ? `${(m.usedJSHeapSize / 1048576).toFixed(0)} / ${(m.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : 'n/d (solo Chrome)'}`,
      `devicePixelRatio ${devicePixelRatio}  ·  pixelRatio render ${r.getPixelRatio().toFixed(2)}  ·  ventana ${innerWidth}x${innerHeight}  ·  canvas ${c.width}x${c.height} (${(c.width * c.height / 1e6).toFixed(2)} Mpx)`,
      `calidad ${x.q}  ·  escala dinámica x${x.res.toFixed(2)}`,
      `terreno: ${tr.drawn} nodos, z${tr.deepest}, ${tr.tex} texturas orto, cola ${tr.queued}`,
      `edificios (celdas por LOD): LOD0 ${b ? b.lod0 : '-'} · LOD1 ${b ? b.lod1 : '-'} · LOD2 ${b ? b.lod2 : '-'}`,
      `calles/árboles: ${w ? `${w.cells} celdas, cola ${w.queued}, ${w.builds || 0} construidas, corte máx ${(w.maxBuild || 0).toFixed(1)} ms` : '-'}`,
      `GPU: ${d.gpu}`,
      '[F3 cierra · ?perf lo abre al cargar]',
    ].join('\n');
  }
}
