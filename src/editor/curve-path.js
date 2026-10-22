function cubicPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlA.x +
      3 * inverse * t ** 2 * controlB.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlA.y +
      3 * inverse * t ** 2 * controlB.y + t ** 3 * end.y
  };
}

export function curveScreenPoints(points, step, spacing = 4) {
  if (points.length < 2) return [];
  const [start, end] = points;
  const controlA = step > 0 ? points[2] ?? end : start;
  const controlB = step > 1 ? points[3] ?? controlA : step > 0 ? controlA : end;
  const path = [start, controlA, controlB, end];
  const length = path.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
  const segments = Math.max(1, Math.min(2048, Math.ceil(length / spacing)));
  return Array.from({ length: segments + 1 }, (_, index) =>
    cubicPoint(start, controlA, controlB, end, index / segments));
}
