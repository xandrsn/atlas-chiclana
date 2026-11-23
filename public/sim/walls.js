// Building collisions for the movers (Phase 5): wraps a ground callback (sim/ground.js groundFn) so a pose is blocked when its body
// crosses a building wall (camera/solid.js: the exact footprints of the baked walls, built in the cell worker). The body is a rectangle
// (car: half width / half length along heading h; walker: a square) tested exactly against each wall piece, so it can touch a facade
// and slide along it; the movers advance < 1 m per 60 Hz step at any speed (no tunnelling through the 0.4 m+ thick walls).
// Only walls whose [bottom, top] overlaps the body's band (feet + low .. feet + head) block: decks, tunnels and car parks under or
// over a wall keep working, and anything lower than `low` over the feet (kerbs, parapets, stair and stand risers) is left to Ground.at.
//   solid: { hits(x, z, h, hw, hl, y0, y1) } · dims() -> [halfWidth, halfLength] · o: { low, head }
export const BAND = { low: 1, head: 1.6 };
export function withWalls(ground, solid, dims, o = BAND) {
  return (x, z, y, h = 0) => {
    const g = ground(x, z, y, h); if (g == null || g.blocked) return g;
    const fy = g.y ?? g, [hw, hl] = dims();
    if (solid.hits(x, z, h, hw, hl, fy + o.low, fy + o.head)) return { ...(typeof g === 'object' ? g : { y: g }), blocked: true, layer: 'building' };
    return g;
  };
}
