// Cell loader worker: fetch + validate + slice a baked cell (scripts/bake_cells.mjs); on request, the cell's merged tree mesh (render/trees.js).
// Also the building-wall grid (camera/solid.js) used by the camera and the movers' collisions. Module worker (stream/cells.js).
// Everything is transferred back (no copies); the main thread only wraps the arrays in BufferAttributes.
import { wallGrid, wallSegs } from '../camera/solid.js'; import { buildTrees } from '../render/trees.js';
const MAGIC = 0x324c4543;
self.onmessage = async ({ data: { id, url, cell, S, trees: tr, opt } }) => {
  if (tr) { const g = buildTrees(tr, opt); self.postMessage({ id, treeMesh: g }, [g.pos.buffer, g.col.buffer]); return; }   // tree mesh of a live cell (stream/cells.js: only near the player)
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
    const buf = await r.arrayBuffer(), h = new Uint32Array(buf, 0, 16);
    if (h[0] !== MAGIC || h[1] !== 3) throw new Error(url + ': bad cell header (re-run scripts/bake_cells.mjs)');
    const [nV0, nI0, nV1, nI1, nT, N, nD, fl] = [h[4], h[5], h[6], h[7], h[8], h[9], h[10], h[11]], yOff = new Float32Array(buf, 48, 1)[0], qxz = h[13], qy = h[14];
    let o = 64; const take = (Ctor, n) => { const a = new Ctor(buf, o, n); o += (n * Ctor.BYTES_PER_ELEMENT + 3) & ~3; return a; };   // sections padded to 4 bytes
    const pos0 = take(Int16Array, nV0 * 3), col0 = take(Uint8Array, nV0 * 4), ncol0 = take(Uint8Array, nV0 * 4), idx0 = take(fl & 1 ? Uint16Array : Uint32Array, nI0);
    const pos1 = take(Int16Array, nV1 * 3), col1 = take(Uint8Array, nV1 * 4), ncol1 = take(Uint8Array, nV1 * 4), idx1 = take(fl & 2 ? Uint16Array : Uint32Array, nI1);
    const trees = take(Float32Array, nT * 4), hm = take(Float32Array, N * N), decks = take(Float32Array, nD * 7);
    if (o !== buf.byteLength) throw new Error(url + ': size mismatch');
    let y0 = 1e9, y1 = -1e9; for (let k = 1; k < pos0.length; k += 3) { const y = pos0[k]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    y0 = yOff + y0 / qy; y1 = yOff + y1 / qy;   // world metres (positions stay int16 on the GPU: the mesh carries scale 1/q and offset yOff)
    const n = S, top = new Float32Array(n * n), bot = new Float32Array(n * n); wallGrid(pos0, idx0, S, 1, { qxz, qy, yOff, col: col0 }, top, 0, idx0.length, bot);   // 1 m grid; 4-16 ms for a dense cell
    const seg = wallSegs(pos0, idx0, { qxz, qy, yOff, col: col0 }), wt = seg ? [seg.s.buffer, seg.st.buffer, seg.ix.buffer] : [];   // exact footprints for the movers
    self.postMessage({ id, ok: true, lod: [{ pos: pos0, col: col0, ncol: ncol0, idx: idx0 }, { pos: pos1, col: col1, ncol: ncol1, idx: idx1 }], nT, N, hm, decks, y0, y1, yOff, qxz, qy, trees, walls: seg ? { top, bot, seg } : null, bytes: buf.byteLength }, [buf, top.buffer, bot.buffer, ...wt]);   // views stay valid on the transferred buffer
  } catch (e) { self.postMessage({ id, ok: false, err: String(e.message || e), cell }); }
};
