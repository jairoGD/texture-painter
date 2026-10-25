import { strokeTouchesSelection } from './selection-coverage.js';
import { rasterizePixelStroke } from './pixel-brush.js';
import { commandBounds } from './paint-history.js';
import { blurSurfaceStroke, blurTouchesSeam } from './surface-blur-stroke.js';

const WHITE = '#ffffff';

let markCanvas = null;
let markContext = null;
let blurHorizontalBuffer = new Float32Array(0);
let blurWeightBuffer = new Float32Array(0);
const blurKernels = new Map();

function blurKernel(sigma, reach) {
  const key = `${sigma}:${reach}`;
  let kernel = blurKernels.get(key);
  if (kernel) return kernel;
  kernel = new Float32Array(reach * 2 + 1);
  let total = 0;
  for (let offset = -reach; offset <= reach; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + reach] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index++) kernel[index] /= total;
  blurKernels.set(key, kernel);
  return kernel;
}

function markBuffer(width, height) {
  if (!markCanvas) {
    markCanvas = document.createElement('canvas');
    markContext = markCanvas.getContext('2d');
  }
  if (markCanvas.width < width) markCanvas.width = width;
  if (markCanvas.height < height) markCanvas.height = height;
  markContext.globalCompositeOperation = 'source-over';
  markContext.globalAlpha = 1;
  markContext.clearRect(0, 0, width, height);
  return markContext;
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function dab(context, x, y, { color, size, hardness }) {
  const radius = Math.max(0.5, size / 2);
  if (hardness >= 100) {
    context.fillStyle = color;
  } else {
    const inner = radius * Math.max(0, hardness / 100);
    const gradient = context.createRadialGradient(x, y, inner, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color}00`);
    context.fillStyle = gradient;
  }
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawMark({ surface, kind, point, previous, options, mask }) {
  const context = surface.context;
  const settings = { ...options, color: kind === 'eraser' ? WHITE : options.color };
  const from = previous ?? point;
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  const spacing = Math.max(1, settings.size * 0.16);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const radius = Math.max(0.5, settings.size / 2);
  if (mask && !strokeTouchesSelection(mask, from, point, radius + 1,
    surface.canvas.width, surface.canvas.height)) return false;
  const left = Math.floor(Math.min(from.x, point.x) - radius - 1);
  const top = Math.floor(Math.min(from.y, point.y) - radius - 1);
  const layerWidth = Math.ceil(Math.max(from.x, point.x) + radius + 1) - left;
  const layerHeight = Math.ceil(Math.max(from.y, point.y) + radius + 1) - top;
  const layerContext = markBuffer(layerWidth, layerHeight);
  if (settings.antialias === false) {
    const image = layerContext.createImageData(layerWidth, layerHeight);
    image.data.set(rasterizePixelStroke({ width: layerWidth, height: layerHeight,
      left, top, from, to: point, steps, hasPrevious: !!previous,
      size: settings.size, hardness: settings.hardness, color: settings.color,
      mask, surfaceWidth: surface.canvas.width, surfaceHeight: surface.canvas.height }));
    layerContext.putImageData(image, 0, 0);
  } else {
    for (let step = previous ? 0 : steps; step <= steps; step++) {
      const t = step / steps;
      dab(layerContext, from.x + (point.x - from.x) * t - left,
        from.y + (point.y - from.y) * t - top, settings);
    }
    if (mask) {
      layerContext.globalCompositeOperation = 'destination-in';
      layerContext.drawImage(mask.canvas, -left, -top);
    }
  }
  context.save();
  if (settings.antialias === false) context.imageSmoothingEnabled = false;
  context.globalAlpha = settings.opacity / 100;
  if (kind === 'eraser' && surface.imageLayer) context.globalCompositeOperation = 'destination-out';
  context.drawImage(markCanvas, 0, 0, layerWidth, layerHeight,
    left, top, layerWidth, layerHeight);
  context.restore();
  return true;
}

function blurStroke({ surface, point, previous, options, mask, isolateBlur = true }) {
  const { canvas, context } = surface;
  const from = previous ?? point;
  const radius = Math.max(1, options.size / 2);
  const sigma = Math.max(0.5, options.spread / 3);
  const reach = Math.ceil(sigma * 3);
  const left = Math.max(0, Math.floor(Math.min(from.x, point.x) - radius));
  const top = Math.max(0, Math.floor(Math.min(from.y, point.y) - radius));
  const right = Math.min(canvas.width, Math.ceil(Math.max(from.x, point.x) + radius));
  const bottom = Math.min(canvas.height, Math.ceil(Math.max(from.y, point.y) + radius));
  if (right <= left || bottom <= top) return false;

  // Read extra source pixels so the blur can pull colors into the brush from outside its edge.
  const sourceLeft = Math.max(0, left - reach);
  const sourceTop = Math.max(0, top - reach);
  const sourceRight = Math.min(canvas.width, right + reach);
  const sourceBottom = Math.min(canvas.height, bottom + reach);
  const width = sourceRight - sourceLeft;
  const height = sourceBottom - sourceTop;
  const image = context.getImageData(sourceLeft, sourceTop, width, height);
  const data = image.data;
  // Work in premultiplied RGBA so fully transparent pixels cannot contribute black.
  const targetWidth = right - left;
  const horizontalLength = targetWidth * height * 4;
  if (blurHorizontalBuffer.length < horizontalLength)
    blurHorizontalBuffer = new Float32Array(horizontalLength);
  const horizontal = blurHorizontalBuffer;
  horizontal.fill(0, 0, horizontalLength);
  const isolateSamples = !!mask && isolateBlur;
  const weightLength = targetWidth * height;
  if (isolateSamples && blurWeightBuffer.length < weightLength)
    blurWeightBuffer = new Float32Array(weightLength);
  const horizontalWeights = isolateSamples ? blurWeightBuffer : null;
  if (horizontalWeights) horizontalWeights.fill(0, 0, weightLength);
  const kernel = blurKernel(sigma, reach);

  // Horizontal samples need the halo, but only columns that can be written need a result.
  for (let y = 0; y < height; y++) for (let canvasX = left; canvasX < right; canvasX++) {
    const x = canvasX - sourceLeft;
    const column = canvasX - left;
    const target = (y * targetWidth + column) * 4;
    for (let offset = -reach; offset <= reach; offset++) {
      const sampleX = Math.max(0, Math.min(width - 1, x + offset));
      const source = (y * width + sampleX) * 4;
      const selectionWeight = isolateSamples ?
        mask.alpha[(sourceTop + y) * canvas.width + sourceLeft + sampleX] / 255 : 1;
      const weight = kernel[offset + reach] * selectionWeight;
      const alpha = data[source + 3] / 255;
      horizontal[target] += data[source] * alpha * weight;
      horizontal[target + 1] += data[source + 1] * alpha * weight;
      horizontal[target + 2] += data[source + 2] * alpha * weight;
      horizontal[target + 3] += data[source + 3] * weight;
      if (isolateSamples) horizontalWeights[y * targetWidth + column] += weight;
    }
  }

  const vx = point.x - from.x;
  const vy = point.y - from.y;
  const segmentLengthSquared = vx * vx + vy * vy;
  const innerRadius = radius * options.hardness / 100;
  const strength = options.strength / 100;
  let changed = false;
  for (let canvasY = top; canvasY < bottom; canvasY++) for (let canvasX = left; canvasX < right; canvasX++) {
    const px = canvasX + 0.5;
    const py = canvasY + 0.5;
    const projection = segmentLengthSquared ? Math.max(0, Math.min(1,
      ((px - from.x) * vx + (py - from.y) * vy) / segmentLengthSquared)) : 0;
    const distance = Math.hypot(px - from.x - projection * vx, py - from.y - projection * vy);
    if (distance >= radius) continue;
    const edge = options.hardness >= 100 || distance <= innerRadius ? 1 :
      1 - Math.max(0, Math.min(1, (distance - innerRadius) / (radius - innerRadius)));
    const falloff = edge * edge * (3 - 2 * edge);
    const selectionAlpha = mask ? mask.alpha[canvasY * canvas.width + canvasX] / 255 : 1;
    const mix = strength * falloff * selectionAlpha;
    if (!mix) continue;
    const x = canvasX - sourceLeft;
    const y = canvasY - sourceTop;
    const pixel = (y * width + x) * 4;
    const column = canvasX - left;
    let blurredRed = 0;
    let blurredGreen = 0;
    let blurredBlue = 0;
    let blurredAlpha = 0;
    let sampleWeight = 0;
    for (let offset = -reach; offset <= reach; offset++) {
      const sampleY = Math.max(0, Math.min(height - 1, y + offset));
      const source = (sampleY * targetWidth + column) * 4;
      const weight = kernel[offset + reach];
      blurredRed += horizontal[source] * weight;
      blurredGreen += horizontal[source + 1] * weight;
      blurredBlue += horizontal[source + 2] * weight;
      blurredAlpha += horizontal[source + 3] * weight;
      if (isolateSamples) sampleWeight += horizontalWeights[sampleY * targetWidth + column] * weight;
    }
    if (isolateSamples) {
      if (!sampleWeight) continue;
      blurredRed /= sampleWeight;
      blurredGreen /= sampleWeight;
      blurredBlue /= sampleWeight;
      blurredAlpha /= sampleWeight;
    }
    const originalAlpha = data[pixel + 3];
    const mixedAlpha = originalAlpha * (1 - mix) + blurredAlpha * mix;
    const nextAlpha = Math.round(mixedAlpha);
    for (let channel = 0; channel < 3; channel++) {
      const blurredColor = channel === 0 ? blurredRed : channel === 1 ? blurredGreen : blurredBlue;
      const premultiplied = data[pixel + channel] * originalAlpha / 255 * (1 - mix) + blurredColor * mix;
      const value = nextAlpha ? Math.round(premultiplied * 255 / mixedAlpha) : 0;
      if (value !== data[pixel + channel]) { data[pixel + channel] = value; changed = true; }
    }
    if (nextAlpha !== originalAlpha) { data[pixel + 3] = nextAlpha; changed = true; }
  }
  if (changed) context.putImageData(image, sourceLeft, sourceTop,
    left - sourceLeft, top - sourceTop, targetWidth, bottom - top);
  return changed;
}

function floodFill({ surface, point, options, mask }) {
  const { context, canvas } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const seed = y * width + x;
  if (mask && !mask.alpha[seed]) return false;
  const offset = seed * 4;
  const target = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  const replacement = rgb(options.color);
  if (target.slice(0, 3).every((component, index) => component === replacement[index]) &&
      (!surface.imageLayer || target[3] === 255)) return false;

  const threshold = options.tolerance * 2.55;
  const opacity = options.opacity / 100;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 1;
  queue[0] = seed;
  visited[seed] = 1;

  while (head < tail) {
    const index = queue[head++];
    if (mask && !mask.alpha[index]) continue;
    const pixel = index * 4;
    if (Math.abs(data[pixel] - target[0]) > threshold ||
        Math.abs(data[pixel + 1] - target[1]) > threshold ||
        Math.abs(data[pixel + 2] - target[2]) > threshold ||
        (surface.imageLayer && Math.abs(data[pixel + 3] - target[3]) > threshold)) continue;

    const mix = opacity * (mask ? mask.alpha[index] / 255 : 1);
    for (let channel = 0; channel < 3; channel++) {
      data[pixel + channel] = Math.round(data[pixel + channel] * (1 - mix) + replacement[channel] * mix);
    }
    if (surface.imageLayer) data[pixel + 3] = Math.round(data[pixel + 3] * (1 - mix) + 255 * mix);
    const px = index % width;
    const py = (index - px) / width;
    const neighbours = [px > 0 ? index - 1 : -1, px < width - 1 ? index + 1 : -1,
      py > 0 ? index - width : -1, py < height - 1 ? index + width : -1];
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && !visited[neighbour]) {
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return true;
}

export function executePaintCommand(command) {
  let changed;
  if (command.kind === 'blur' && command.topology && blurTouchesSeam(command.topology,
    command.point, command.previous, Math.max(1, command.options.size / 2),
    Math.ceil(Math.max(0.5, command.options.spread / 3) * 3),
    command.surface.canvas.width, command.surface.canvas.height)) {
    command.dirtyRegions = blurSurfaceStroke(command);
    changed = command.dirtyRegions.length > 0;
  } else changed = command.kind === 'bucket' ? floodFill(command) :
    command.kind === 'blur' ? blurStroke(command) : drawMark(command);
  if (changed) {
    const regions = command.dirtyRegions ?? [commandBounds(command,
      command.surface.canvas.width, command.surface.canvas.height)];
    for (const region of regions) command.surface.requestComposite(region);
  }
  return changed;
}

export function samplePaintColor(surface, point) {
  const x = Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(surface.canvas.height - 1, Math.floor(point.y)));
  const pixel = surface.compositeContext.getImageData(x, y, 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
