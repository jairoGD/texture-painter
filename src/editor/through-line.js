import { sampleScreenStroke } from './surface-stroke.js';

// Keep each ray intersection on its own path so front and back faces never
// connect through unrelated UV coordinates. Reuse ray results while refining
// the points around triangle boundaries.
export function sampleThroughLine(start, end, intersectionsAt, spacing = 2) {
  const cache = new Map();
  const hitsAt = (x, y) => {
    const key = `${x}:${y}`;
    if (!cache.has(key)) cache.set(key, intersectionsAt(x, y));
    return cache.get(key);
  };
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  let depthCount = 0;
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const hits = hitsAt(start.x + (end.x - start.x) * t,
      start.y + (end.y - start.y) * t);
    depthCount = Math.max(depthCount, hits.length);
  }
  return Array.from({ length: depthCount }, (_, depth) => sampleScreenStroke(start, end,
    (x, y) => hitsAt(x, y)[depth] ?? null, spacing));
}
