export type PlacementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlacementItem = {
  width: number;
  height: number;
};

const ITEM_PADDING_PX = 20;
const MIN_COORD = 16;
const ANGLE_STEP = Math.PI / 12;
const RADIUS_STEP = 14;
const MAX_ITERATIONS = 5000;

function boxesIntersect(
  a: PlacementRect,
  b: PlacementRect,
  padding: number
): boolean {
  return !(
    a.x + a.width + padding <= b.x ||
    b.x + b.width + padding <= a.x ||
    a.y + a.height + padding <= b.y ||
    b.y + b.height + padding <= a.y
  );
}

function hasCollision(
  x: number,
  y: number,
  newItem: PlacementItem,
  existingItems: PlacementRect[],
  padding: number
): boolean {
  const candidate: PlacementRect = {
    x,
    y,
    width: newItem.width,
    height: newItem.height,
  };
  return existingItems.some((item) => boxesIntersect(candidate, item, padding));
}

/**
 * Spiral outward from (startX, startY) — the desired center of the new item —
 * until a collision-free top-left position is found.
 */
export function getSafePosition(
  newItem: PlacementItem,
  existingItems: PlacementRect[],
  startX: number,
  startY: number
): { x: number; y: number } {
  let angle = 0;
  let radius = 0;

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const candidateCenterX = startX + radius * Math.cos(angle);
    const candidateCenterY = startY + radius * Math.sin(angle);
    const x = Math.max(MIN_COORD, Math.round(candidateCenterX - newItem.width / 2));
    const y = Math.max(MIN_COORD, Math.round(candidateCenterY - newItem.height / 2));

    if (!hasCollision(x, y, newItem, existingItems, ITEM_PADDING_PX)) {
      return { x, y };
    }

    angle += ANGLE_STEP;
    radius += RADIUS_STEP * (ANGLE_STEP / (2 * Math.PI));
  }

  const fallbackX = Math.max(MIN_COORD, Math.round(startX - newItem.width / 2));
  const fallbackY = Math.max(MIN_COORD, Math.round(startY - newItem.height / 2));
  return { x: fallbackX, y: fallbackY };
}
