const SIZE = 1024;

export function selectionFromMask(surface, canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const alpha = new Uint8Array(SIZE * SIZE);
  const bounds = { left: SIZE, top: SIZE, right: 0, bottom: 0 };
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const index = y * SIZE + x;
    const value = pixels[index * 4 + 3];
    alpha[index] = value;
    if (!value) continue;
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + 1);
    bounds.bottom = Math.max(bounds.bottom, y + 1);
  }
  if (bounds.right <= bounds.left) return null;
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = overlayCanvas.height = SIZE;
  const overlayContext = overlayCanvas.getContext('2d');
  const overlay = overlayContext.createImageData(SIZE, SIZE);
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const index = y * SIZE + x;
    if (!alpha[index]) continue;
    const edge = x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3 ||
      !alpha[index - 3] || !alpha[index + 3] || !alpha[index - SIZE * 3] || !alpha[index + SIZE * 3];
    const pixel = index * 4;
    overlay.data[pixel] = edge ? 126 : 90;
    overlay.data[pixel + 1] = edge ? 206 : 177;
    overlay.data[pixel + 2] = 255;
    overlay.data[pixel + 3] = edge ? 255 : 75;
  }
  overlayContext.putImageData(overlay, 0, 0);
  return { surface, canvas, alpha, bounds, overlayCanvas };
}

export function shiftedSelection(selection, dx, dy) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.getContext('2d').drawImage(selection.canvas, dx, dy);
  return selectionFromMask(selection.surface, canvas);
}

export function containsSelection(selection, point) {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE && selection.alpha[y * SIZE + x] > 0;
}

export function moveSelectionPixels({ surface, selection, dx, dy }) {
  if (!dx && !dy) return false;
  const { context, canvas } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const source = context.getImageData(0, 0, width, height);
  const original = source.data;
  const output = new Uint8ClampedArray(original);
  const { alpha, bounds } = selection;
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const mask = alpha[y * width + x] / 255;
    if (!mask) continue;
    const pixel = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++)
      output[pixel + channel] = original[pixel + channel] * (1 - mask) +
        (surface.imageLayer ? 0 : 255) * mask;
  }
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const mask = alpha[y * width + x] / 255;
    const destX = x + dx;
    const destY = y + dy;
    if (!mask || destX < 0 || destX >= width || destY < 0 || destY >= height) continue;
    const sourcePixel = (y * width + x) * 4;
    const targetPixel = (destY * width + destX) * 4;
    for (let channel = 0; channel < 4; channel++) {
      output[targetPixel + channel] = output[targetPixel + channel] * (1 - mask) + original[sourcePixel + channel] * mask;
    }
  }
  source.data.set(output);
  context.putImageData(source, 0, 0);
  surface.requestComposite();
  return true;
}
