import { indexSelectionTiles } from './selection-coverage.js';

export function uvToLayerPixel(uv, canvas) {
  const u = ((uv.x % 1) + 1) % 1;
  const v = ((uv.y % 1) + 1) % 1;
  return { x: u * canvas.width, y: (1 - v) * canvas.height };
}

export function scaleLayerRegion(region, source, target) {
  if (!region) return null;
  return {
    left: Math.max(0, Math.floor(region.left * target.width / source.width) - 1),
    top: Math.max(0, Math.floor(region.top * target.height / source.height) - 1),
    right: Math.min(target.width, Math.ceil(region.right * target.width / source.width) + 1),
    bottom: Math.min(target.height, Math.ceil(region.bottom * target.height / source.height) + 1)
  };
}

export function selectionMaskForLayer(selection, canvas) {
  if (!selection || !canvas) return null;
  if (selection.alpha.length === canvas.width * canvas.height) return selection;
  const cached = selection.layerMasks?.get(canvas);
  if (cached) return cached;
  const scaled = document.createElement('canvas');
  scaled.width = canvas.width;
  scaled.height = canvas.height;
  const context = scaled.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(selection.canvas, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  const indices = [];
  const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
  for (let index = 0; index < alpha.length; index++) {
    const value = pixels[index * 4 + 3];
    if (!value) continue;
    alpha[index] = value;
    indices.push(index);
    const x = index % canvas.width;
    const y = Math.floor(index / canvas.width);
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + 1);
    bounds.bottom = Math.max(bounds.bottom, y + 1);
  }
  const result = { canvas: scaled, alpha, indices: Uint32Array.from(indices), bounds,
    occupiedTiles: indexSelectionTiles(indices, canvas.width, canvas.height) };
  (selection.layerMasks ??= new WeakMap()).set(canvas, result);
  return result;
}
