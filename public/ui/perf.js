// v2 performance panel (F3 or ?perf) + frame recorder used by scripts/perf_v2.mjs. Hidden = one boolean check per frame.
import { onKey } from '../input/keys.js';

export class Perf {
  constructor(renderer, extra) {
    this.r = renderer; this.extra = extra; this.t = {}; this.frameMs = 16; this.last = performance.now(); this.txt = 0; this.worst = 0; this.worstT = 0;
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'desconocida'; this.gl = gl; this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this.gpuMs = null;
    this.el = document.createElement('pre');
    this.el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:50;margin:0;padding:8px 10px;background:rgba(0,0,0,.78);color:#bfe;font:12px/1.4 monospace;pointer-events:none;white-space:pre;display:none';
    document.body.appendChild(this.el); onKey('F3', () => this.show(!this.on)); this.show(new URLSearchParams(location.search).has('perf'));
    this.rec = null;
  }
  show(v) { this.on = v; this.el.style.display = v ? 'block' : 'none'; }
  /** time a subsystem: exponential moving average in ms (+ per-frame sum for the recorder) */
  time(name, fn) { const a = performance.now(); const r = fn(); const d = performance.now() - a; this.t[name] = (this.t[name] ?? d) * 0.9 + d * 0.1; this.cur = (this.cur || 0) + d; return r; }
  beginGpu() { if (this.ext && !this.q) { this.q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.q); this.open = true; } }
  endGpu() {
    const gl = this.gl; if (this.open) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.open = false; return; }
    if (this.q && gl.getQueryParameter(this.q, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(this.q, gl.QUERY_RESULT) / 1e6; this.gpuMs = this.gpuMs == null ? ms : this.gpuMs * 0.9 + ms * 0.1; } gl.deleteQuery(this.q); this.q = null; }
  }
  frame(now) {
    const dt = now - this.last; this.last = now; this.frameMs = this.frameMs * 0.92 + dt * 0.08;
    if (dt > this.worst || now - this.worstT > 5000) { this.worst = dt; this.worstT = now; }
    const ri = this.r.info.render;
    if (this.rec) { const r = this.rec; r.dt.push(dt); r.js.push(this.cur || 0); r.tri = Math.max(r.tri, ri.triangles); r.dc = Math.max(r.dc, ri.calls); r.apply = Math.max(r.apply, this.extra().cells.applyLast || 0); }
    this.cur = 0;
    if (!this.on || now - this.txt < 250) return; this.txt = now;
    const i = this.r.info, m = performance.memory, x = this.extra(), s = x.cells, c = this.r.domElement, f = (v, d = 2) => v == null ? 'n/d' : v.toFixed(d);
    this.el.textContent = [
      `v2 · FPS ${(1000 / this.frameMs).toFixed(0)} · frame ${f(this.frameMs, 1)} ms (peor 5 s: ${f(this.worst, 1)}) · GPU ${this.ext ? f(this.gpuMs) + ' ms' : 'n/d'}`,
      `CPU ms: física ${f(this.t.sim)} · streaming ${f(this.t.stream)} · cámara ${f(this.t.cam)} · render ${f(this.t.render)}`,
      `draw calls ${i.render.calls} · triángulos ${(i.render.triangles / 1000).toFixed(0)}k · geometrías ${i.memory.geometries} · texturas ${i.memory.textures} · programas ${i.programs?.length ?? '?'}`,
      `memoria JS ${m ? (m.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/d'} · celdas: ${s.resident} residentes (LOD0 ${s.lod0} · LOD1 ${s.lod1} · árboles ${s.trees}) · en vuelo ${s.inflight} · cola ${s.queued}`,
      `celdas cargadas ${s.loaded} · expulsadas ${s.evicted} · ${(s.bytes / 1048576).toFixed(1)} MB bajados · aplicar celda: último ${f(s.applyLast)} ms, máx ${f(s.applyMax)} ms`,
      `calidad ${x.q} · niebla/dibujo ${x.draw} m · DPR ${devicePixelRatio} · pixelRatio ${this.r.getPixelRatio().toFixed(2)} · canvas ${c.width}x${c.height}`,
      `GPU: ${this.gpu}`, `pos ${x.pos} · ${x.mode} · hora ${x.hour}`, '[F3 cierra]',
    ].join('\n');
  }
  start() { this.rec = { dt: [], js: [], tri: 0, dc: 0, apply: 0 }; }
  stop() {
    const r = this.rec; this.rec = null; if (!r) return null;
    const s = [...r.dt].sort((a, b) => a - b), n = s.length, q = p => s[Math.min(n - 1, Math.floor(n * p))], sum = s.reduce((a, b) => a + b, 0), js = [...r.js].sort((a, b) => a - b);
    return { frames: n, fps: +(n / (sum / 1000)).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +s[n - 1].toFixed(1), over33: s.filter(v => v > 33).length, over50: s.filter(v => v > 50).length, over100: s.filter(v => v > 100).length,
      jsMean: +(js.reduce((a, b) => a + b, 0) / n).toFixed(2), jsMax: +js[n - 1].toFixed(1), triMax: r.tri, dcMax: r.dc, applyMax: +r.apply.toFixed(2), gpuMs: this.gpuMs == null ? null : +this.gpuMs.toFixed(2) };
  }
}
