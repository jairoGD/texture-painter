import { selectionFromMask } from './lasso-selection.js';

const SIZE = 1024;

export function shiftedUvSelection(selection, dx, dy) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d').drawImage(selection.canvas, dx, dy);
  return selectionFromMask(selection.surface, canvas);
}

export function moveSelectionInUv(surface, selection, originalImage, dx, dy) {
  const { canvas, context } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const output = context.createImageData(width, height);
  const original = originalImage.data;
  output.data.set(original);
  const pixels = output.data;
  const empty = surface.imageLayer ? 0 : 255;
  for (const index of selection.indices) {
    const mask = selection.alpha[index] / 255;
    const offset = index * 4;
    for (let channel = 0; channel < 4; channel++)
      pixels[offset + channel] = original[offset + channel] * (1 - mask) + empty * mask;
  }
  for (const index of selection.indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const targetX = x + dx;
    const targetY = y + dy;
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
    const mask = selection.alpha[index] / 255;
    const sourceOffset = index * 4;
    const targetOffset = (targetY * width + targetX) * 4;
    for (let channel = 0; channel < 4; channel++)
      pixels[targetOffset + channel] = pixels[targetOffset + channel] * (1 - mask) +
        original[sourceOffset + channel] * mask;
  }
  return output;
}
