const SIZE = 1024;
import { decodeVisibleUv } from './screen-lasso.js';

export function selectionFromMask(surface, canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const alpha = new Uint8Array(SIZE * SIZE);
  const indices = [];
  for (let index = 0; index < alpha.length; index++) {
    alpha[index] = pixels[index * 4 + 3];
    if (alpha[index]) indices.push(index);
  }
  return selectionFromAlpha(surface, alpha, canvas, indices);
}

export function selectionFromAlpha(surface, alpha, canvas = null, activeIndices = null,
  includeMaskCanvas = true) {
  const indices = activeIndices ?? [];
  if (!activeIndices) for (let index = 0; index < alpha.length; index++)
    if (alpha[index]) indices.push(index);
  const bounds = { left: SIZE, top: SIZE, right: 0, bottom: 0 };
  for (const index of indices) {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + 1);
    bounds.bottom = Math.max(bounds.bottom, y + 1);
  }
  if (bounds.right <= bounds.left) return null;
  if (!canvas && includeMaskCanvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
    const mask = context.createImageData(SIZE, SIZE);
    for (const index of indices) mask.data[index * 4 + 3] = alpha[index];
    context.putImageData(mask, 0, 0);
  }
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = overlayCanvas.height = SIZE;
  const overlayContext = overlayCanvas.getContext('2d');
  const overlay = overlayContext.createImageData(SIZE, SIZE);
  for (const index of indices) {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    const edge = x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3 ||
      !alpha[index - 3] || !alpha[index + 3] || !alpha[index - SIZE * 3] || !alpha[index + SIZE * 3];
    const pixel = index * 4;
    overlay.data[pixel] = edge ? 126 : 90;
    overlay.data[pixel + 1] = edge ? 206 : 177;
    overlay.data[pixel + 2] = 255;
    overlay.data[pixel + 3] = edge ? 255 : 75;
  }
  overlayContext.putImageData(overlay, 0, 0);
  return { surface, canvas, alpha, bounds, overlayCanvas, indices: Uint32Array.from(indices) };
}

export function containsSelection(selection, point) {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE && selection.alpha[y * SIZE + x] > 0;
}

export function visibleSelectionSamples(selection, projection) {
  const { buffer, width, height } = projection;
  const screen = [];
  const source = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const uv = decodeVisibleUv(buffer, width, height, x, y);
    if (!uv) continue;
    const index = uv.y * SIZE + uv.x;
    if (!selection.alpha[index]) continue;
    screen.push(y * width + x);
    source.push(index);
  }
  return { screen: Int32Array.from(screen), source: Int32Array.from(source) };
}

export function moveSelectionInView(selection, originalImage, projection, samples, dx, dy,
  outputImage = null, outputAlpha = null) {
  const { buffer, width, height } = projection;
  const image = outputImage ?? { width: SIZE, height: SIZE,
    data: new Uint8ClampedArray(originalImage.data.length) };
  const data = image.data;
  data.set(originalImage.data);
  const destinationAlpha = outputAlpha ?? new Uint8Array(SIZE * SIZE);
  destinationAlpha.fill(0);
  const destinationIndices = [];
  const { alpha } = selection;
  const empty = selection.surface.imageLayer ? 0 : 255;
  for (const index of selection.indices) {
    const mask = alpha[index] / 255;
    if (!mask) continue;
    const pixel = index * 4;
    for (let channel = 0; channel < 4; channel++)
      data[pixel + channel] = originalImage.data[pixel + channel] * (1 - mask) + empty * mask;
  }
  for (let index = 0; index < samples.screen.length; index++) {
    const screenIndex = samples.screen[index];
    const x = screenIndex % width + dx;
    const y = Math.floor(screenIndex / width) + dy;
    const target = decodeVisibleUv(buffer, width, height, x, y);
    if (!target) continue;
    const right = decodeVisibleUv(buffer, width, height, x + 1, y);
    const down = decodeVisibleUv(buffer, width, height, x, y + 1);
    const distance = Math.max(right ? Math.hypot(target.x - right.x, target.y - right.y) : 0,
      down ? Math.hypot(target.x - down.x, target.y - down.y) : 0);
    const radius = Math.max(2, Math.min(12, distance < 48 ? Math.ceil(distance * 0.75) : 2));
    const sourceIndex = samples.source[index];
    const mask = alpha[sourceIndex];
    const sourcePixel = sourceIndex * 4;
    for (let py = Math.max(0, target.y - radius); py <= Math.min(SIZE - 1, target.y + radius); py++)
      for (let px = Math.max(0, target.x - radius); px <= Math.min(SIZE - 1, target.x + radius); px++) {
        if ((px - target.x) ** 2 + (py - target.y) ** 2 > radius * radius) continue;
        const destinationIndex = py * SIZE + px;
        if (destinationAlpha[destinationIndex] >= mask) continue;
        if (!destinationAlpha[destinationIndex]) destinationIndices.push(destinationIndex);
        const mix = mask / 255;
        const destinationPixel = destinationIndex * 4;
        for (let channel = 0; channel < 4; channel++)
          data[destinationPixel + channel] = data[destinationPixel + channel] * (1 - mix) +
            originalImage.data[sourcePixel + channel] * mix;
        destinationAlpha[destinationIndex] = mask;
      }
  }
  return { image, alpha: destinationAlpha, indices: destinationIndices };
}
