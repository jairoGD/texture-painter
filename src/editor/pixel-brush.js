function parseColor(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function rasterizePixelStroke({ width, height, left, top, from, to, steps,
  hasPrevious, size, hardness, color, mask = null, surfaceWidth = width,
  surfaceHeight = height }) {
  const radius = Math.max(0.5, size / 2);
  const radiusSquared = radius * radius;
  const innerRadius = radius * Math.max(0, hardness / 100);
  const coverage = new Float32Array(width * height);

  for (let step = hasPrevious ? 0 : steps; step <= steps; step++) {
    const t = step / steps;
    let centerX = from.x + (to.x - from.x) * t - left;
    let centerY = from.y + (to.y - from.y) * t - top;
    if (size <= 1) {
      centerX = Math.floor(centerX) + 0.5;
      centerY = Math.floor(centerY) + 0.5;
    }
    const x0 = Math.max(0, Math.floor(centerX - radius));
    const y0 = Math.max(0, Math.floor(centerY - radius));
    const x1 = Math.min(width, Math.ceil(centerX + radius));
    const y1 = Math.min(height, Math.ceil(centerY + radius));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= radiusSquared) continue;
      const alpha = hardness >= 100 || distanceSquared <= innerRadius * innerRadius ? 1 :
        (radius - Math.sqrt(distanceSquared)) / (radius - innerRadius);
      const index = y * width + x;
      coverage[index] += (1 - coverage[index]) * alpha;
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  const [red, green, blue] = parseColor(color);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!coverage[index]) continue;
    if (mask) {
      const canvasX = left + x;
      const canvasY = top + y;
      if (canvasX < 0 || canvasY < 0 || canvasX >= surfaceWidth ||
          canvasY >= surfaceHeight || mask.alpha[canvasY * surfaceWidth + canvasX] < 128) continue;
    }
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Math.round(coverage[index] * 255);
  }
  return pixels;
}
