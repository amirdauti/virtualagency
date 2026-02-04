type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Circle = { x: number; z: number; r: number };

export interface Point2D {
  x: number;
  z: number;
}

// ---- Office navigation mesh (2D grid, x/z) ----
// These values mirror the scene layout in OfficeEnvironment.tsx.
const OFFICE_SIZE = 80;
const GRID_CELL = 1; // 1 unit per cell
const GRID_W = Math.floor(OFFICE_SIZE / GRID_CELL);
const GRID_H = Math.floor(OFFICE_SIZE / GRID_CELL);
const GRID_ORIGIN_X = -OFFICE_SIZE / 2;
const GRID_ORIGIN_Z = -OFFICE_SIZE / 2;

const DIVIDER_Z = 3;
const DIVIDER_WIDTH_X = 30; // matches args={[30,1,0.8]}
const DIVIDER_THICKNESS_Z = 1.0;
const CORRIDOR_GAPS = [-9, -3, 3, 9]; // x centers
const CORRIDOR_HALF_WIDTH = 1.4;

const DESK_ROWS = 4;
const DESKS_PER_ROW = 6;
const DESK_START_X = -15;
const DESK_START_Z = -25;
const DESK_SPACING_X = 6;
const DESK_SPACING_Z = 5;

let blockedGrid: Uint8Array | null = null;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value | 0));
}

function worldToCell(p: Point2D): { i: number; j: number } {
  const i = Math.floor((p.x - GRID_ORIGIN_X) / GRID_CELL);
  const j = Math.floor((p.z - GRID_ORIGIN_Z) / GRID_CELL);
  return { i: clampInt(i, 0, GRID_W - 1), j: clampInt(j, 0, GRID_H - 1) };
}

function cellToWorld(i: number, j: number): Point2D {
  return {
    x: GRID_ORIGIN_X + (i + 0.5) * GRID_CELL,
    z: GRID_ORIGIN_Z + (j + 0.5) * GRID_CELL,
  };
}

function idx(i: number, j: number): number {
  return j * GRID_W + i;
}

function rectContains(r: Rect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

function circleContains(c: Circle, x: number, z: number): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  return dx * dx + dz * dz <= c.r * c.r;
}

function buildObstacles(): { rects: Rect[]; circles: Circle[] } {
  const rects: Rect[] = [];
  const circles: Circle[] = [];

  // Desks + chairs (footprint padding for character radius)
  // Desk top is 2x1, chair is ~0.5 depth; approximate a single axis-aligned rectangle.
  for (let row = 0; row < DESK_ROWS; row++) {
    for (let col = 0; col < DESKS_PER_ROW; col++) {
      const x = DESK_START_X + col * DESK_SPACING_X;
      const z = DESK_START_Z + row * DESK_SPACING_Z;
      rects.push({
        minX: x - 1.6,
        maxX: x + 1.6,
        minZ: z - 0.9,
        maxZ: z + 1.6,
      });
    }
  }

  // Divider bar (block except corridor openings)
  rects.push({
    minX: -DIVIDER_WIDTH_X / 2 - 0.4,
    maxX: DIVIDER_WIDTH_X / 2 + 0.4,
    minZ: DIVIDER_Z - DIVIDER_THICKNESS_Z / 2,
    maxZ: DIVIDER_Z + DIVIDER_THICKNESS_Z / 2,
  });

  // Lounge furniture (LoungeArea group is at z=18)
  // Couches: use generous AABB since two are rotated.
  rects.push({ minX: -12.0, maxX: -4.0, minZ: 16.0, maxZ: 21.0 }); // left couch cluster
  rects.push({ minX: 4.0, maxX: 12.0, minZ: 16.0, maxZ: 21.0 }); // right couch cluster
  rects.push({ minX: -2.2, maxX: 2.2, minZ: 22.4, maxZ: 24.2 }); // back couch

  // Coffee table at (0, 20)
  rects.push({ minX: -1.3, maxX: 1.3, minZ: 19.2, maxZ: 20.8 });

  // Beanbags
  circles.push({ x: -4, z: 24, r: 1.0 });
  circles.push({ x: 4, z: 24, r: 1.0 });
  circles.push({ x: -10, z: 21, r: 1.0 });
  circles.push({ x: 10, z: 21, r: 1.0 });

  // Arcade + vending machines
  rects.push({ minX: 13.2, maxX: 16.8, minZ: 24.6, maxZ: 28.2 }); // arcade at (15,26)
  rects.push({ minX: -19.6, maxX: -16.4, minZ: 21.2, maxZ: 24.2 }); // vending (approx)
  rects.push({ minX: -19.6, maxX: -16.4, minZ: 24.2, maxZ: 27.2 });

  // Plants
  circles.push({ x: -12, z: 16, r: 1.6 });
  circles.push({ x: 12, z: 16, r: 1.6 });
  circles.push({ x: 0, z: 28, r: 1.4 });

  return { rects, circles };
}

function isBlockedAt(x: number, z: number): boolean {
  // Keep inside floor bounds with a margin.
  const margin = 1.2;
  if (
    x < GRID_ORIGIN_X + margin ||
    x > GRID_ORIGIN_X + OFFICE_SIZE - margin ||
    z < GRID_ORIGIN_Z + margin ||
    z > GRID_ORIGIN_Z + OFFICE_SIZE - margin
  ) {
    return true;
  }

  const { rects, circles } = buildObstaclesCached();

  // Carve corridor openings through the divider bar.
  if (Math.abs(z - DIVIDER_Z) <= DIVIDER_THICKNESS_Z / 2 + 0.05) {
    for (const gapX of CORRIDOR_GAPS) {
      if (Math.abs(x - gapX) <= CORRIDOR_HALF_WIDTH) {
        return false;
      }
    }
  }

  for (const r of rects) {
    if (rectContains(r, x, z)) return true;
  }
  for (const c of circles) {
    if (circleContains(c, x, z)) return true;
  }
  return false;
}

let cachedObstacles: { rects: Rect[]; circles: Circle[] } | null = null;
function buildObstaclesCached() {
  if (!cachedObstacles) cachedObstacles = buildObstacles();
  return cachedObstacles;
}

function ensureGrid() {
  if (blockedGrid) return;
  blockedGrid = new Uint8Array(GRID_W * GRID_H);
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      const p = cellToWorld(i, j);
      blockedGrid[idx(i, j)] = isBlockedAt(p.x, p.z) ? 1 : 0;
    }
  }
}

function nearestFreeCell(i0: number, j0: number): { i: number; j: number } {
  ensureGrid();
  const grid = blockedGrid!;
  if (grid[idx(i0, j0)] === 0) return { i: i0, j: j0 };

  const visited = new Uint8Array(GRID_W * GRID_H);
  const qI: number[] = [i0];
  const qJ: number[] = [j0];
  visited[idx(i0, j0)] = 1;

  for (let qi = 0; qi < qI.length && qi < 2000; qi++) {
    const i = qI[qi];
    const j = qJ[qi];
    const neighbors = [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ];
    for (const [ni, nj] of neighbors) {
      if (ni < 0 || nj < 0 || ni >= GRID_W || nj >= GRID_H) continue;
      const id = idx(ni, nj);
      if (visited[id]) continue;
      visited[id] = 1;
      if (grid[id] === 0) return { i: ni, j: nj };
      qI.push(ni);
      qJ.push(nj);
    }
  }
  return { i: i0, j: j0 };
}

class MinHeap {
  private heap: number[] = [];
  constructor(private score: Float64Array) {}
  push(id: number) {
    const h = this.heap;
    h.push(id);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[h[p]] <= this.score[h[i]]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): number | null {
    const h = this.heap;
    if (h.length === 0) return null;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < h.length && this.score[h[l]] < this.score[h[s]]) s = l;
        if (r < h.length && this.score[h[r]] < this.score[h[s]]) s = r;
        if (s === i) break;
        [h[s], h[i]] = [h[i], h[s]];
        i = s;
      }
    }
    return top;
  }
  get size() {
    return this.heap.length;
  }
}

function lineOfSight(a: { i: number; j: number }, b: { i: number; j: number }): boolean {
  ensureGrid();
  const grid = blockedGrid!;
  // Bresenham
  let x0 = a.i, y0 = a.j, x1 = b.i, y1 = b.j;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (let iter = 0; iter < 4096; iter++) {
    if (grid[idx(x0, y0)] !== 0) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return true;
}

/**
 * Generate a path from start to end, avoiding desks and lounge furniture.
 * Returns an array of waypoints the agent should visit in order.
 */
export function generatePath(start: Point2D, end: Point2D): Point2D[] {
  ensureGrid();
  const grid = blockedGrid!;

  const s0 = worldToCell(start);
  const e0 = worldToCell(end);
  const s = nearestFreeCell(s0.i, s0.j);
  const e = nearestFreeCell(e0.i, e0.j);

  // Fast path: direct line of sight.
  if (lineOfSight(s, e)) return [end];

  const startId = idx(s.i, s.j);
  const goalId = idx(e.i, e.j);

  const gScore = new Float64Array(GRID_W * GRID_H);
  const fScore = new Float64Array(GRID_W * GRID_H);
  const cameFrom = new Int32Array(GRID_W * GRID_H);
  const inOpen = new Uint8Array(GRID_W * GRID_H);
  const closed = new Uint8Array(GRID_W * GRID_H);

  for (let i = 0; i < gScore.length; i++) {
    gScore[i] = Number.POSITIVE_INFINITY;
    fScore[i] = Number.POSITIVE_INFINITY;
    cameFrom[i] = -1;
  }

  const heuristic = (id: number) => {
    const i = id % GRID_W;
    const j = Math.floor(id / GRID_W);
    const dx = i - e.i;
    const dz = j - e.j;
    return Math.hypot(dx, dz);
  };

  gScore[startId] = 0;
  fScore[startId] = heuristic(startId);

  const open = new MinHeap(fScore);
  open.push(startId);
  inOpen[startId] = 1;

  const neighbors = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ] as const;

  let found = false;
  let steps = 0;
  while (open.size > 0 && steps++ < 25000) {
    const current = open.pop()!;
    inOpen[current] = 0;
    if (closed[current]) continue;
    closed[current] = 1;

    if (current === goalId) {
      found = true;
      break;
    }

    const ci = current % GRID_W;
    const cj = Math.floor(current / GRID_W);

    for (const [di, dj, cost] of neighbors) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= GRID_W || nj >= GRID_H) continue;
      const nid = idx(ni, nj);
      if (closed[nid]) continue;
      if (grid[nid] !== 0) continue;

      // Prevent cutting corners through obstacles on diagonal moves.
      if (di !== 0 && dj !== 0) {
        const a = idx(ci + di, cj);
        const b = idx(ci, cj + dj);
        if (grid[a] !== 0 || grid[b] !== 0) continue;
      }

      const tentativeG = gScore[current] + cost;
      if (tentativeG < gScore[nid]) {
        cameFrom[nid] = current;
        gScore[nid] = tentativeG;
        fScore[nid] = tentativeG + heuristic(nid);
        if (!inOpen[nid]) {
          open.push(nid);
          inOpen[nid] = 1;
        }
      }
    }
  }

  if (!found) {
    // Fallback: route via corridor gap approach as before.
    // This prevents agents from getting "stuck" if the grid is too constrained.
    const bestGapX = CORRIDOR_GAPS
      .map((x) => ({
        x,
        d:
          Math.hypot(start.x - x, start.z - DIVIDER_Z) +
          Math.hypot(end.x - x, end.z - DIVIDER_Z),
      }))
      .sort((a, b) => a.d - b.d)[0].x;
    const through: Point2D[] = [];
    through.push({ x: bestGapX, z: start.z > DIVIDER_Z ? DIVIDER_Z + 2 : DIVIDER_Z - 2 });
    through.push({ x: bestGapX, z: DIVIDER_Z });
    through.push({ x: bestGapX, z: end.z > DIVIDER_Z ? DIVIDER_Z + 2 : DIVIDER_Z - 2 });
    through.push(end);
    return through;
  }

  // Reconstruct cell path.
  const cellPath: Array<{ i: number; j: number }> = [];
  let cur = goalId;
  cellPath.push({ i: cur % GRID_W, j: Math.floor(cur / GRID_W) });
  for (let iter = 0; iter < 25000; iter++) {
    const prev = cameFrom[cur];
    if (prev < 0) break;
    cur = prev;
    cellPath.push({ i: cur % GRID_W, j: Math.floor(cur / GRID_W) });
    if (cur === startId) break;
  }
  cellPath.reverse();

  // Smooth by skipping points with line-of-sight.
  const simplified: Array<{ i: number; j: number }> = [];
  let anchor = cellPath[0];
  simplified.push(anchor);
  let k = 1;
  while (k < cellPath.length) {
    let far = k;
    for (let t = k + 1; t < cellPath.length; t++) {
      if (lineOfSight(anchor, cellPath[t])) {
        far = t;
      } else {
        break;
      }
    }
    anchor = cellPath[far];
    simplified.push(anchor);
    k = far + 1;
  }

  // Convert to world points. Keep the final point as the exact requested `end`.
  const result: Point2D[] = [];
  // Skip the first cell (start) to avoid a redundant micro-step.
  for (let i = 1; i < simplified.length; i++) {
    result.push(cellToWorld(simplified[i].i, simplified[i].j));
  }
  if (result.length === 0 || Math.hypot(result[result.length - 1].x - end.x, result[result.length - 1].z - end.z) > 0.5) {
    result.push(end);
  } else {
    result[result.length - 1] = end;
  }
  return result;
}
