/**
 * Normalize pixel coordinates to [0, 1] range.
 */
export function normalizeCoords(x, y, cw, ch) {
  return {
    x: x / cw,
    y: y / ch,
  };
}

/**
 * Denormalize [0, 1] coordinates back to pixel space.
 */
export function denormalizeCoords(x, y, cw, ch) {
  return {
    x: x * cw,
    y: y * ch,
  };
}
