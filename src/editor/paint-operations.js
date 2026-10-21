const WHITE = '#ffffff';
import { moveSelectionPixels } from './lasso-selection.js';

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function dab(context, x, y, { color, size, hardness }) {
  const radius = Math.max(1, size / 2);
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
  const radius = Math.max(1, settings.size / 2);
  const left = Math.floor(Math.min(from.x, point.x) - radius - 1);
  const top = Math.floor(Math.min(from.y, point.y) - radius - 1);
  if (mask && (left >= mask.bounds.right || top >= mask.bounds.bottom ||
      Math.ceil(Math.max(from.x, point.x) + radius + 1) <= mask.bounds.left ||
      Math.ceil(Math.max(from.y, point.y) + radius + 1) <= mask.bounds.top)) return false;
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(Math.max(from.x, point.x) + radius + 1) - left;
  layer.height = Math.ceil(Math.max(from.y, point.y) + radius + 1) - top;
  const layerContext = layer.getContext('2d');
  context.save();
  for (let step = previous ? 0 : steps; step <= steps; step++) {
    const t = step / steps;
    dab(layerContext, from.x + (point.x - from.x) * t - left, from.y + (point.y - from.y) * t - top, settings);
  }
  if (mask) {
    layerContext.globalCompositeOperation = 'destination-in';
    layerContext.drawImage(mask.canvas, -left, -top);
    const pixels = layerContext.getImageData(0, 0, layer.width, layer.height).data;
    let visible = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]) { visible = true; break; }
    }
    if (!visible) { context.restore(); return false; }
  }
  context.globalAlpha = settings.opacity / 100;
  if (kind === 'eraser' && surface.imageLayer) context.globalCompositeOperation = 'destination-out';
  context.drawImage(layer, left, top);
  context.restore();
  return true;
}

function blurStroke({ surface, point, previous, options, mask }) {
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
  const horizontal = new Float32Array(width * height * 3);
  const kernel = new Float32Array(reach * 2 + 1);
  let total = 0;
  for (let offset = -reach; offset <= reach; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + reach] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index++) kernel[index] /= total;

  // Separable convolution keeps a broad, smooth brush practical while dragging.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 3;
    for (let offset = -reach; offset <= reach; offset++) {
      const sampleX = Math.max(0, Math.min(width - 1, x + offset));
      const source = (y * width + sampleX) * 4;
      const weight = kernel[offset + reach];
      horizontal[target] += data[source] * weight;
      horizontal[target + 1] += data[source + 1] * weight;
      horizontal[target + 2] += data[source + 2] * weight;
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
    for (let channel = 0; channel < 3; channel++) {
      let blurred = 0;
      for (let offset = -reach; offset <= reach; offset++) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        blurred += horizontal[(sampleY * width + x) * 3 + channel] * kernel[offset + reach];
      }
      const value = Math.round(data[pixel + channel] * (1 - mix) + blurred * mix);
      if (value !== data[pixel + channel]) { data[pixel + channel] = value; changed = true; }
    }
  }
  if (changed) context.putImageData(image, sourceLeft, sourceTop);
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
  const changed = command.kind === 'bucket' ? floodFill(command) :
    command.kind === 'blur' ? blurStroke(command) :
      command.kind === 'moveSelection' ? moveSelectionPixels(command) : drawMark(command);
  if (changed) command.surface.requestComposite();
  return changed;
}

export function samplePaintColor(surface, point) {
  const x = Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(surface.canvas.height - 1, Math.floor(point.y)));
  const pixel = surface.compositeContext.getImageData(x, y, 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
