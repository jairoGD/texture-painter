// Produces continuous parts of a line in the caller's 2D coordinate space.
// The scene supplies screen pixels; UV sampling supplies texture pixels.
export function lineStylePaths(start, end, options = {}, spacing = 2) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const at = (length, offset = 0) => ({
    x: start.x + dx * length / distance - dy * offset / distance,
    y: start.y + dy * length / distance + dx * offset / distance
  });
  if (!distance || options.lineStyle === 'solid' || !options.lineStyle)
    return [[start, end]];
  if (options.lineStyle === 'dashed') {
    const dash = Math.max(1, Number(options.dashLength) || 1);
    const gap = Math.max(1, Number(options.dashGap) || 1);
    const paths = [];
    for (let from = 0; from < distance; from += dash + gap)
      paths.push([at(from), at(Math.min(distance, from + dash))]);
    return paths;
  }
  if (options.lineStyle === 'wavy') {
    const height = Math.max(0, Number(options.waveHeight) || 0);
    const wavelength = Math.max(2, Number(options.waveSpacing) || 2);
    const steps = Math.max(1, Math.ceil(distance / Math.min(spacing, wavelength / 12)));
    return [Array.from({ length: steps + 1 }, (_, index) => {
      const length = distance * index / steps;
      const taper = Math.min(1, length / Math.max(1, height),
        (distance - length) / Math.max(1, height));
      return at(length, Math.sin(length * Math.PI * 2 / wavelength) * height * taper);
    })];
  }
  return [[start, end]];
}

// Styles an existing curve by traveled distance, so dashes and waves keep
// their phase through every Bezier subdivision instead of restarting there.
export function styledPolylinePaths(points, options = {}, spacing = 2) {
  if (points.length < 2 || !options.lineStyle || options.lineStyle === 'solid')
    return points.length ? [points] : [];
  const lengths = [0];
  for (let index = 1; index < points.length; index++)
    lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y));
  const total = lengths.at(-1);
  if (!total) return [[points[0]]];
  const pointAt = (distance) => {
    let low = 1, high = lengths.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (lengths[middle] < distance) low = middle + 1;
      else high = middle;
    }
    const index = low;
    const from = points[index - 1], to = points[index];
    const length = lengths[index] - lengths[index - 1];
    const t = length ? (distance - lengths[index - 1]) / length : 0;
    return { x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      tangentX: length ? (to.x - from.x) / length : 1,
      tangentY: length ? (to.y - from.y) / length : 0 };
  };
  if (options.lineStyle === 'dashed') {
    const dash = Math.max(1, Number(options.dashLength) || 1);
    const gap = Math.max(1, Number(options.dashGap) || 1);
    const paths = [];
    for (let start = 0; start < total; start += dash + gap) {
      const end = Math.min(total, start + dash);
      const first = pointAt(start), last = pointAt(end);
      const path = [{ x: first.x, y: first.y }];
      for (let index = 1; index < points.length - 1; index++)
        if (lengths[index] > start && lengths[index] < end) path.push(points[index]);
      path.push({ x: last.x, y: last.y });
      paths.push(path);
    }
    return paths;
  }
  if (options.lineStyle === 'wavy') {
    const height = Math.max(0, Number(options.waveHeight) || 0);
    const wavelength = Math.max(2, Number(options.waveSpacing) || 2);
    const steps = Math.max(1, Math.ceil(total / Math.min(spacing, wavelength / 12)));
    return [Array.from({ length: steps + 1 }, (_, index) => {
      const distance = total * index / steps;
      const center = pointAt(distance);
      const taper = Math.min(1, distance / Math.max(1, height),
        (total - distance) / Math.max(1, height));
      const offset = Math.sin(distance * Math.PI * 2 / wavelength) * height * taper;
      return { x: center.x - center.tangentY * offset,
        y: center.y + center.tangentX * offset };
    })];
  }
  return [points];
}
