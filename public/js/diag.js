// Frame diagnostics: GPU name, JS ms vs frame interval, draw calls, per-subsystem timings, GPU ms (if the driver exposes it). Shown by perfpanel.js (F3).
export class Diag {
  constructor(renderer) {
    this.r = renderer; this.t = {}; this.frameMs = 16; this.jsMs = 0; this.gpuMs = null; this.last = performance.now(); this.logT = performance.now();
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'desconocida';
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); this.gl = gl; this.q = null;
  }
  /** time a subsystem (exponential moving average, ms) */
  time(name, fn) { const a = performance.now(); fn(); const d = performance.now() - a; this.t[name] = (this.t[name] ?? d) * 0.92 + d * 0.08; const r = this.rec; if (r) { r.cur += d; if (!(r.subMax[name] >= d)) r.subMax[name] = d; r.subSum[name] = (r.subSum[name] || 0) + d; } }
  /** bench recorder (scripts/bench.mjs): per-frame JS ms outside the renderer, render-call ms, draw calls, triangles */
  reset() { this.rec = { cur: 0, js: [], render: [], dc: [], tri: [], subMax: {}, subSum: {} }; }
  report() {
    const r = this.rec; if (!r || !r.js.length) return { frames: 0 };
    const s = [...r.js].sort((a, b) => a - b), n = s.length, avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1), f = v => +v.toFixed(2), sub = {}, subMax = {};
    for (const k in r.subSum) { sub[k] = f(r.subSum[k] / n); subMax[k] = f(r.subMax[k]); }
    return { frames: n, jsMean: f(avg(s)), jsP95: f(s[Math.min(n - 1, Math.floor(n * 0.95))]), jsMax: f(s[n - 1]), over16: s.filter(v => v > 16).length, over50: s.filter(v => v > 50).length,
      renderMean: f(avg(r.render)), dcMean: Math.round(avg(r.dc)), dcMax: Math.max(...r.dc), triMean: Math.round(avg(r.tri) / 1000), triMax: Math.round(Math.max(...r.tri) / 1000), sub, subMax };
  }
  beginRender() {
    this.rs = performance.now();
    if (this.ext && !this.q) { this.q = this.gl.createQuery(); this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.q); this.qOpen = true; }
  }
  endRender() {
    const d = performance.now() - this.rs; this.t.render = (this.t.render ?? d) * 0.92 + d * 0.08; if (this.rec) this.rec.render.push(d);
    if (this.qOpen) { this.gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.qOpen = false; }
    else if (this.q) {
      const gl = this.gl;
      if (gl.getQueryParameter(this.q, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(this.q, gl.QUERY_RESULT) / 1e6; this.gpuMs = this.gpuMs == null ? ms : this.gpuMs * 0.9 + ms * 0.1; }
        gl.deleteQuery(this.q); this.q = null;
      }
    }
  }
  frame(now, extra) {
    const dt = now - this.last; this.last = now; this.frameMs = this.frameMs * 0.92 + dt * 0.08;
    const info = this.r.info, ri = info.render, sum = Object.values(this.t).reduce((a, b) => a + b, 0);
    if (this.rec) { const r = this.rec; r.js.push(r.cur); r.cur = 0; r.dc.push(ri.calls); r.tri.push(ri.triangles); }
    this.jsMs = sum;
    const line = () => `${this.gpu} | frame ${this.frameMs.toFixed(1)} ms (${(1000 / this.frameMs).toFixed(0)} fps) | JS ${sum.toFixed(1)} ms | GPU ${this.gpuMs == null ? 'n/d' : this.gpuMs.toFixed(1) + ' ms'} | ${ri.calls} dc ${(ri.triangles / 1000).toFixed(0)}k tri | pr ${this.r.getPixelRatio().toFixed(2)} ${extra.res}`;
    if (now - this.logT > 5000) { this.logT = now; console.log('[diag] ' + line()); }
  }
}
