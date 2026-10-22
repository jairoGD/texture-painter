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
  offsets = null, backgroundImage = null) {
  const { canvas, context } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const output = context.createImageData(width, height);
  const original = originalImage.data;
  output.data.set(backgroundImage?.data ?? original);
  const pixels = output.data;
  const empty = surface.imageLayer ? 0 : 255;
  if (!backgroundImage) for (const index of selection.indices) {
    const mask = selection.alpha[index] / 255;
    const offset = index * 4;
    for (let channel = 0; channel < 4; channel++)
      pixels[offset + channel] = original[offset + channel] * (1 - mask) + empty * mask;
  }
  const movements = offsets ? selection.parts.map((part, index) => ({ part, ...offsets[index] })) :
    [{ part: selection, dx, dy }];
  for (const movement of movements) for (const index of movement.part.indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const targetX = x + movement.dx;
    const targetY = y + movement.dy;
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
    const mask = movement.part.alpha[index] / 255;
    const targetIndex = targetY * width + targetX;
    if (backgroundImage) blendSelectedPixel(pixels, targetIndex, original, index, mask);
    else {
      const sourceOffset = index * 4;
      const targetOffset = targetIndex * 4;
      for (let channel = 0; channel < 4; channel++)
        pixels[targetOffset + channel] = pixels[targetOffset + channel] * (1 - mask) +
          original[sourceOffset + channel] * mask;
    }
  }
  return output;
}
