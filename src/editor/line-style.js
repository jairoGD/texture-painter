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
