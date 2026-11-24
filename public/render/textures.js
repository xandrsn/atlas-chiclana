// World textures: CC0 photo atlases (docs/CREDITS.md), packed by tools/textures/pack.py into public/v2/assets/textures/.
// surf.webp = detail multiplier per surface layer (mean 128 = x1: the baked vertex colour stays the real colour), surf_n.webp = tangent normal (RG) + roughness (B),
// leaf.webp = foliage cards. Layers 0..15 = surface KIND of scripts/bake_cells.mjs; 16.. = its sub-materials. 7 = water, 15 = macro noise.
import * as THREE from 'three';
export const ATLAS = { cols: 6, rows: 4, size: 512 }, DIR = new URL('../assets/textures/', import.meta.url).href;

/** grey (neutral) texture array at once; the pixels of the atlas replace it when the image arrives (browser only). tex.userData.ready = promise */
export function surfaceArray(file, aniso, grey) {   // grey = 0xAABBGGRR
  const { cols, rows, size: N } = ATLAS, data = new Uint8Array(N * N * 4 * cols * rows); new Uint32Array(data.buffer).fill(grey);
  const tex = new THREE.DataArrayTexture(data, N, N, cols * rows);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = aniso; tex.needsUpdate = true;
  tex.userData = { file, ready: load(file).then(im => {
    if (!im) return;
    const cv = document.createElement('canvas'); cv.width = N; cv.height = N; const g = cv.getContext('2d', { willReadFrequently: true });
    for (let l = 0; l < cols * rows; l++) { g.drawImage(im, l % cols * N, Math.floor(l / cols) * N, N, N, 0, 0, N, N); data.set(g.getImageData(0, 0, N, N).data, l * N * N * 4); }
    im.close(); tex.needsUpdate = true;
  }) };
  return tex;
}
export function leafTexture(file, aniso) {
  const tex = new THREE.Texture(); tex.flipY = false; tex.premultiplyAlpha = false; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = aniso;
  tex.userData = { file, ready: load(file).then(im => { if (im) { tex.image = im; tex.needsUpdate = true; } }) };
  return tex;
}
const load = async file => {
  if (typeof createImageBitmap === 'undefined') return null;   // node (tools/preview, tests)
  try { const r = await fetch(DIR + file); if (!r.ok) throw new Error(r.status); return await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
  catch (e) { console.error('texture', file, e); return null; }   // the world keeps its flat colours
};
