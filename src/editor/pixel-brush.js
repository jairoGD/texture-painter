import { strokeWidthAt } from './stroke-profile.js';

function parseColor(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

export function rasterizePixelStroke({ width, height, left, top, from, to, steps,
  hasPrevious, size, hardness, color, mask = null, surfaceWidth = width,
  surfaceHeight = height, brushProfile = 'circle', taperAmount = 100,
  profileFrom = 0, profileTo = 1, angle = 0 }) {
  const coverage = new Float32Array(width * height);

  for (let step = hasPrevious ? 0 : steps; step <= steps; step++) {
    const t = step / steps;
    const dabSize = strokeWidthAt(size, brushProfile, taperAmount,
      profileFrom + (profileTo - profileFrom) * t);
    const dabRadius = Math.max(0.5, dabSize / 2);
    const dabInner = dabRadius * Math.max(0, hardness / 100);
    let centerX = from.x + (to.x - from.x) * t - left;
    let centerY = from.y + (to.y - from.y) * t - top;
    if (size <= 1) {
      centerX = Math.floor(centerX) + 0.5;
      centerY = Math.floor(centerY) + 0.5;
    }
    const reach = dabRadius * (brushProfile === 'square' ? Math.SQRT2 : 1);
    const x0 = Math.max(0, Math.floor(centerX - reach));
    const y0 = Math.max(0, Math.floor(centerY - reach));
    const x1 = Math.min(width, Math.ceil(centerX + reach));
    const y1 = Math.min(height, Math.ceil(centerY + reach));
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      const distance = brushProfile === 'square' ?
        Math.max(Math.abs(dx * cos + dy * sin), Math.abs(-dx * sin + dy * cos)) :
        Math.hypot(dx, dy);
      if (distance >= dabRadius) continue;
      const alpha = hardness >= 100 || distance <= dabInner ? 1 :
        (dabRadius - distance) / (dabRadius - dabInner);
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
