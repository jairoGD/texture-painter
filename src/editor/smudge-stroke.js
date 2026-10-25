// A smearing brush carries the previous dab's pixels forward. The carried
// colors gradually pick up the surface beneath them, as in a physical brush.
function captureBrush(surface, point, diameter, mask, isolate) {
  const { width, height } = surface.canvas;
  const radius = Math.floor(diameter / 2);
  const left = Math.floor(point.x) - radius;
  const top = Math.floor(point.y) - radius;
  const patch = new Uint8ClampedArray(diameter * diameter * 4);
  const coverage = isolate && mask ? new Uint8Array(diameter * diameter) : null;
  const x0 = Math.max(0, left), y0 = Math.max(0, top);
  const x1 = Math.min(width, left + diameter), y1 = Math.min(height, top + diameter);
  if (x1 > x0 && y1 > y0) {
    const source = surface.context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const target = ((y - top) * diameter + x - left);
      const sourceOffset = ((y - y0) * (x1 - x0) + x - x0) * 4;
      patch.set(source.subarray(sourceOffset, sourceOffset + 4), target * 4);
      if (coverage) coverage[target] = mask.alpha[y * width + x];
    }
  }
  return { patch, coverage, diameter };
}

function mixPixel(data, destination, patch, source, amount) {
  const oldAlpha = data[destination + 3] / 255;
  const carriedAlpha = patch[source + 3] / 255;
  const alpha = oldAlpha * (1 - amount) + carriedAlpha * amount;
  const nextAlpha = Math.round(alpha * 255);
  let changed = nextAlpha !== data[destination + 3];
  for (let channel = 0; channel < 3; channel++) {
    const premultiplied = data[destination + channel] * oldAlpha * (1 - amount) +
      patch[source + channel] * carriedAlpha * amount;
    const value = alpha ? Math.round(premultiplied / alpha) : 0;
    if (value !== data[destination + channel]) changed = true;
    data[destination + channel] = value;
  }
  data[destination + 3] = nextAlpha;
  return changed;
}

function pickUp(patch, source, destination, amount) {
  const carriedAlpha = patch[source + 3] / 255;
  const pickedAlpha = destination[3] / 255;
  const alpha = carriedAlpha * (1 - amount) + pickedAlpha * amount;
  for (let channel = 0; channel < 3; channel++) {
    const premultiplied = patch[source + channel] * carriedAlpha * (1 - amount) +
      destination[channel] * pickedAlpha * amount;
    patch[source + channel] = alpha ? Math.round(premultiplied / alpha) : 0;
  }
  patch[source + 3] = Math.round(alpha * 255);
}

export function smudgeStroke({ surface, point, previous, options, mask,
  isolateBlur = true, smudgeState }) {
  const state = smudgeState ?? {};
  const radius = Math.max(0.5, Number(options.size) / 2);
  const diameter = Math.max(1, Math.ceil(radius * 2) + 2);
  if (!state.patch || state.diameter !== diameter) {
    Object.assign(state, captureBrush(surface, previous ?? point, diameter, mask,
      isolateBlur));
    if (!previous) return false;
  }
  const from = previous ?? point;
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  const steps = previous ? Math.max(1, Math.ceil(distance /
    Math.max(1, Number(options.size) * 0.05))) : 1;
  if (previous && distance < 0.01) return false;
  const left = Math.max(0, Math.floor(Math.min(from.x, point.x) - radius - 2));
  const top = Math.max(0, Math.floor(Math.min(from.y, point.y) - radius - 2));
  const right = Math.min(surface.canvas.width,
    Math.ceil(Math.max(from.x, point.x) + radius + 2));
  const bottom = Math.min(surface.canvas.height,
    Math.ceil(Math.max(from.y, point.y) + radius + 2));
  if (right <= left || bottom <= top) return false;
  const image = surface.context.getImageData(left, top, right - left, bottom - top);
  const data = image.data;
  const strength = Math.max(0, Math.min(1, Number(options.strength) / 100));
  const pickup = 0.08 + (1 - strength) * 0.22;
  const hardness = Math.max(0, Math.min(100, Number(options.hardness))) / 100;
  const innerRadius = radius * hardness;
  const half = Math.floor(diameter / 2);
  const picked = new Uint8ClampedArray(4);
  let changed = false;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const centerX = from.x + (point.x - from.x) * t;
    const centerY = from.y + (point.y - from.y) * t;
    const originX = Math.floor(centerX) - half;
    const originY = Math.floor(centerY) - half;
    const x0 = Math.max(left, originX), y0 = Math.max(top, originY);
    const x1 = Math.min(right, originX + diameter);
    const y1 = Math.min(bottom, originY + diameter);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const distanceFromCenter = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distanceFromCenter >= radius) continue;
      const edge = hardness >= 1 || distanceFromCenter <= innerRadius ? 1 :
        1 - (distanceFromCenter - innerRadius) / (radius - innerRadius);
      const falloff = edge * edge * (3 - 2 * edge);
      const selection = mask ? mask.alpha[y * surface.canvas.width + x] / 255 : 1;
      if (!selection) continue;
      const patchIndex = (y - originY) * diameter + x - originX;
      const source = patchIndex * 4;
      const destination = ((y - top) * image.width + x - left) * 4;
      const sourceCoverage = state.coverage ? state.coverage[patchIndex] / 255 : 1;
      const amount = strength * falloff * selection * sourceCoverage;
      for (let channel = 0; channel < 4; channel++)
        picked[channel] = data[destination + channel];
      if (amount && mixPixel(data, destination, state.patch, source, amount)) changed = true;
      if (sourceCoverage || !isolateBlur) pickUp(state.patch, source, picked, pickup);
      else state.patch.set(picked, source);
      if (state.coverage) state.coverage[patchIndex] = Math.round(
        state.coverage[patchIndex] * (1 - pickup) + selection * 255 * pickup);
    }
  }
  if (changed) surface.context.putImageData(image, left, top);
  return changed;
}
