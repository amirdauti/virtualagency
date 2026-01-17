// Corridor gaps between divider posts where agents can walk through
const CORRIDOR_GAPS = [
  { x: -9, z: 3 }, // Gap between X=-12 and X=-6 posts
  { x: -3, z: 3 }, // Gap between X=-6 and X=0 posts
  { x: 3, z: 3 }, // Gap between X=0 and X=6 posts
  { x: 9, z: 3 }, // Gap between X=6 and X=12 posts
];

// Divider Z position
const DIVIDER_Z = 3;

export interface Point2D {
  x: number;
  z: number;
}

/**
 * Check if a path from start to end crosses the area divider
 */
function needsToCrossDivider(start: Point2D, end: Point2D): boolean {
  const startInLounge = start.z > DIVIDER_Z;
  const endInLounge = end.z > DIVIDER_Z;
  return startInLounge !== endInLounge;
}

/**
 * Find the corridor gap that minimizes total travel distance
 */
function findNearestGap(start: Point2D, end: Point2D): Point2D {
  let bestGap = CORRIDOR_GAPS[0];
  let bestDistance = Infinity;

  for (const gap of CORRIDOR_GAPS) {
    const distance =
      Math.hypot(gap.x - start.x, gap.z - start.z) +
      Math.hypot(gap.x - end.x, gap.z - end.z);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestGap = gap;
    }
  }

  return { ...bestGap };
}

/**
 * Generate a path from start to end, avoiding the area divider.
 * Returns an array of waypoints the agent should visit in order.
 */
export function generatePath(start: Point2D, end: Point2D): Point2D[] {
  if (!needsToCrossDivider(start, end)) {
    // Direct path is fine - no obstacles to avoid
    return [end];
  }

  // Need to route through a corridor gap
  const gapPoint = findNearestGap(start, end);
  const path: Point2D[] = [];

  // Add approach waypoint on the starting side of divider
  if (start.z > DIVIDER_Z) {
    // Coming from lounge, approach from above
    path.push({ x: gapPoint.x, z: DIVIDER_Z + 2 });
  } else {
    // Coming from desks, approach from below
    path.push({ x: gapPoint.x, z: DIVIDER_Z - 2 });
  }

  // Walk through the gap
  path.push(gapPoint);

  // Add exit waypoint on the destination side
  if (end.z > DIVIDER_Z) {
    // Heading to lounge, exit above
    path.push({ x: gapPoint.x, z: DIVIDER_Z + 2 });
  } else {
    // Heading to desks, exit below
    path.push({ x: gapPoint.x, z: DIVIDER_Z - 2 });
  }

  // Final destination
  path.push(end);

  return path;
}
