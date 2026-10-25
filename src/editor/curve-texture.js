// Maps screen-space curve coordinates into an image strip. Each image row is
// bent around the local curve tangent, rather than stamped as a rotated tile.
export function createCurveTextureSampler(points, image, { size = 16,
  seamless = false, antialias = true, opacity = 100 } = {}) {
  if (points.length < 2 || !image?.width || !image?.height) return null;
  const width = Math.max(1, size);
  const radius = width / 2;
  const cellSize = Math.max(16, Math.ceil(width));
  const cells = new Map();
  const segments = [];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) continue;
    const segment = { a, dx, dy, length, start: totalLength };
    const index = segments.push(segment) - 1;
    totalLength += length;
    const left = Math.floor((Math.min(a.x, b.x) - radius - 1) / cellSize);
    const right = Math.floor((Math.max(a.x, b.x) + radius + 1) / cellSize);
    const top = Math.floor((Math.min(a.y, b.y) - radius - 1) / cellSize);
    const bottom = Math.floor((Math.max(a.y, b.y) + radius + 1) / cellSize);
    for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
      const key = `${cx},${cy}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(index);
    }
  }
  if (!segments.length) return null;
  const naturalLength = width * image.height / image.width;
  const repetitions = seamless ? Math.max(1, Math.round(totalLength / naturalLength)) :
    totalLength / naturalLength;
  const pixels = image.data;
  const read = (x, y) => {
    x = Math.max(0, Math.min(image.width - 1, x));
    y = Math.max(0, Math.min(image.height - 1, y));
    const offset = (y * image.width + x) * 4;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
  };
  const sampleImage = (u, v) => {
    const fx = Math.max(0, Math.min(image.width - 1, u * image.width - 0.5));
    const fy = Math.max(0, Math.min(image.height - 1, v * image.height - 0.5));
    if (!antialias) return read(Math.round(fx), Math.round(fy));
    const x = Math.floor(fx), y = Math.floor(fy);
    const tx = fx - x, ty = fy - y;
    const neighbors = [[x, y, (1 - tx) * (1 - ty)], [x + 1, y, tx * (1 - ty)],
      [x, y + 1, (1 - tx) * ty], [x + 1, y + 1, tx * ty]];
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const [px, py, weight] of neighbors) {
      const color = read(px, py);
      const a = color[3] * weight;
      alpha += a;
      red += color[0] * a;
      green += color[1] * a;
      blue += color[2] * a;
    }
    return alpha ? [red / alpha, green / alpha, blue / alpha, alpha] : [0, 0, 0, 0];
  };
  return (x, y) => {
    const candidates = cells.get(`${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`);
    if (!candidates) return null;
    let nearest = null, distanceSquared = Infinity;
    for (const index of candidates) {
      const segment = segments[index];
      const t = Math.max(0, Math.min(1,
        ((x - segment.a.x) * segment.dx + (y - segment.a.y) * segment.dy) /
        (segment.length * segment.length)));
      const px = segment.a.x + t * segment.dx, py = segment.a.y + t * segment.dy;
      const distance = (x - px) ** 2 + (y - py) ** 2;
      if (distance < distanceSquared) { distanceSquared = distance; nearest = { segment, t, px, py }; }
    }
    if (!nearest || distanceSquared > (radius + (antialias ? 0.5 : 0)) ** 2) return null;
    const { segment, t, px, py } = nearest;
    const signed = (segment.dx * (y - py) - segment.dy * (x - px)) / segment.length;
    const u = signed / width + 0.5;
    const progress = (segment.start + t * segment.length) / totalLength;
    const phase = (progress * repetitions) % 1;
    const v = phase;
    let color = sampleImage(u, v);
    if (seamless) {
      // Blend only around the tile boundary so non-tileable source images join.
      const blend = 0.06;
      if (phase < blend) {
        const other = sampleImage(u, 1 - phase);
        const weight = (blend - phase) / (2 * blend);
        color = color.map((component, channel) =>
          component * (1 - weight) + other[channel] * weight);
      } else if (phase > 1 - blend) {
        const other = sampleImage(u, 1 - phase);
        const weight = (phase - (1 - blend)) / (2 * blend);
        color = color.map((component, channel) =>
          component * (1 - weight) + other[channel] * weight);
      }
    }
    const edge = antialias ? Math.max(0, Math.min(1, radius + 0.5 - Math.abs(signed))) : 1;
    color[3] *= edge * Math.max(0, Math.min(1, opacity / 100));
    return color[3] > 0 ? color : null;
  };
}

// Average premultiplied samples over a projected texture pixel. This smooths
// both the strip edges and high-frequency details without dark transparent rims.
export function sampleCurveTexturePixel(sampler, x, y, derivatives = null) {
  if (!derivatives) return sampler(x, y);
  const [xx, xy, yx, yy] = derivatives;
  let alpha = 0, red = 0, green = 0, blue = 0;
  for (const ox of [-0.25, 0.25]) for (const oy of [-0.25, 0.25]) {
    const color = sampler(x + ox * xx + oy * yx, y + ox * xy + oy * yy);
    if (!color) continue;
    const a = color[3] / 4;
    alpha += a;
    red += color[0] * a;
    green += color[1] * a;
    blue += color[2] * a;
  }
  return alpha > 0 ? [red / alpha, green / alpha, blue / alpha, alpha] : null;
}
