// Screen-space sampling keeps the stroke on the visible 3D surface. UVs are
// only used after each ray has found the triangle beneath that screen point.
export function sampleScreenStroke(start, end, hitAt, spacing = 1) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (!distance) return [hitAt(start.x, start.y)];
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const hits = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    const hit = hitAt(x, y);
    const previous = hits.at(-1);
    // Add a sample on each side of a triangle edge. This prevents thin strokes
    // from leaving a gap at UV seams even when the model is zoomed far out.
    if (previous && hit && previous.object === hit.object && previous.faceIndex !== hit.faceIndex) {
      let left = (index - 1) / steps;
      let right = t;
      let leftHit = previous;
      let rightHit = hit;
      for (let iteration = 0; iteration < 5; iteration++) {
        const middle = (left + right) / 2;
        const middleHit = hitAt(start.x + (end.x - start.x) * middle,
          start.y + (end.y - start.y) * middle);
        if (middleHit?.object === leftHit.object && middleHit.faceIndex === leftHit.faceIndex) {
          left = middle; leftHit = middleHit;
        } else {
          right = middle; rightHit = middleHit;
        }
      }
      hits.push(leftHit, rightHit);
    }
    hits.push(hit);
  }
  return hits;
}

export function canConnectSurfaceHits(previousHit, hit, previousPoint, point, maxUvDistance) {
  return !!previousHit && !!hit && previousHit.object === hit.object &&
    previousHit.faceIndex === hit.faceIndex &&
    Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < maxUvDistance;
}

export function canConnectUvHits(previousHit, hit, previousPoint, point, maxUvDistance) {
  return !!previousHit && !!hit && previousHit.object === hit.object &&
    Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < maxUvDistance;
}
