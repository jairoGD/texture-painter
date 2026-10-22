const INF = 0x3fffffff;

// Squared Euclidean distance to the nearest selected (grow) or empty (shrink) texel.
// A vertical scan followed by a lower-envelope scan keeps the cost linear in pixel count.
export function resizeSelectionAlpha(source, width, height, amount, expand) {
  if (!Number.isInteger(amount) || amount < 1) throw new RangeError('Selection size must be a positive integer.');
  if (source.length !== width * height) throw new RangeError('Selection dimensions do not match its mask.');
  const vertical = new Int32Array(source.length);
  const nearest = new Int32Array(width);
  const boundaries = new Float64Array(width + 1);
  const output = new Uint8Array(source.length);
  const radiusSquared = amount * amount;

  for (let x = 0; x < width; x++) {
    let last = -1;
    let found = !expand;
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (expand ? source[index] > 0 : source[index] === 0) {
        last = y;
        found = true;
      }
      vertical[index] = found ? (y - last) ** 2 : INF;
    }
    last = height;
    found = !expand;
    for (let y = height - 1; y >= 0; y--) {
      const index = y * width + x;
      if (expand ? source[index] > 0 : source[index] === 0) {
        last = y;
        found = true;
      }
      if (found) vertical[index] = Math.min(vertical[index], (last - y) ** 2);
    }
  }

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let top = -1;
    for (let x = 0; x < width; x++) {
      const value = vertical[row + x];
      if (value === INF) continue;
      let intersection = -Infinity;
      while (top >= 0) {
        const previous = nearest[top];
        intersection = (value + x * x - vertical[row + previous] - previous * previous) /
          (2 * (x - previous));
        if (intersection > boundaries[top]) break;
        top--;
      }
      top++;
      nearest[top] = x;
      boundaries[top] = top === 0 ? -Infinity : intersection;
      boundaries[top + 1] = Infinity;
    }
    if (top < 0) continue;
    let candidate = 0;
    for (let x = 0; x < width; x++) {
      while (candidate < top && boundaries[candidate + 1] < x) candidate++;
      const nearestX = nearest[candidate];
      const distance = (x - nearestX) ** 2 + vertical[row + nearestX];
      const inside = expand ? distance <= radiusSquared :
        distance > radiusSquared && (x + 1) ** 2 > radiusSquared &&
        (width - x) ** 2 > radiusSquared;
      if (inside) output[row + x] = 255;
    }
  }
  return output;
}
