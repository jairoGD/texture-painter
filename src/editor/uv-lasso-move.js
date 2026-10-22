import { combineSelectionParts, selectionFromMask } from './lasso-selection.js';
import { blendSelectedPixel } from './selection-clipboard.js';
import { textureResolution as SIZE } from './texture-resolution.js';

export function shiftedUvSelection(selection, dx, dy) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d').drawImage(selection.canvas, dx, dy);
  return selectionFromMask(selection.surface, canvas);
}

export function shiftedUvSelectionParts(selection, offsets) {
  const parts = selection.parts.map((part, index) => {
    const alpha = new Uint8Array(SIZE * SIZE);
    const indices = [];
    const { dx, dy } = offsets[index];
    for (const source of part.indices) {
      const x = source % SIZE + dx;
      const y = Math.floor(source / SIZE) + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      const target = y * SIZE + x;
      if (!alpha[target]) indices.push(target);
      alpha[target] = Math.max(alpha[target], part.alpha[source]);
    }
    return { alpha, indices };
  });
  return combineSelectionParts(selection.surface, parts.filter((part) => part.indices.length));
}

export function moveSelectionInUv(surface, selection, originalImage, dx, dy,
  offsets = null, backgroundImage = null, outputImage = null, reuse = null) {
  const { canvas, context } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const output = outputImage ?? context.createImageData(width, height);
  const original = originalImage.data;
  const base = backgroundImage?.data ?? original;
  const pixels = output.data;
  if (reuse?.initialized) {
    for (const index of reuse.previousIndices) {
      const pixel = index * 4;
      pixels[pixel] = base[pixel];
      pixels[pixel + 1] = base[pixel + 1];
      pixels[pixel + 2] = base[pixel + 2];
      pixels[pixel + 3] = base[pixel + 3];
    }
  } else {
    pixels.set(base);
    if (reuse) reuse.initialized = true;
  }
  const empty = surface.imageLayer ? 0 : 255;
  if (!backgroundImage) for (const index of selection.indices) {
    const mask = selection.alpha[index] / 255;
    const offset = index * 4;
    for (let channel = 0; channel < 4; channel++)
      pixels[offset + channel] = original[offset + channel] * (1 - mask) + empty * mask;
  }
  const movements = offsets ? selection.parts.map((part, index) => ({ part, ...offsets[index] })) :
    [{ part: selection, dx, dy }];
  const destinationIndices = reuse ? [] : null;
  for (const movement of movements) for (const index of movement.part.indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const targetX = x + movement.dx;
    const targetY = y + movement.dy;
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
    const mask = movement.part.alpha[index] / 255;
    const targetIndex = targetY * width + targetX;
    destinationIndices?.push(targetIndex);
    blendSelectedPixel(pixels, targetIndex, original, index, mask);
  }
  if (reuse) reuse.previousIndices = destinationIndices;
  return output;
}
