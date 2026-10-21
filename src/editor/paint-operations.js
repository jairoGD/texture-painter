const WHITE = '#ffffff';

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

function drawMark({ surface, kind, point, previous, options }) {
  const context = surface.context;
  const settings = { ...options, color: kind === 'eraser' ? WHITE : options.color };
  const from = previous ?? point;
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  const spacing = Math.max(1, settings.size * 0.16);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const radius = Math.max(1, settings.size / 2);
  const left = Math.floor(Math.min(from.x, point.x) - radius - 1);
  const top = Math.floor(Math.min(from.y, point.y) - radius - 1);
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(Math.max(from.x, point.x) + radius + 1) - left;
  layer.height = Math.ceil(Math.max(from.y, point.y) + radius + 1) - top;
  const layerContext = layer.getContext('2d');
  context.save();
  for (let step = previous ? 0 : steps; step <= steps; step++) {
    const t = step / steps;
    dab(layerContext, from.x + (point.x - from.x) * t - left, from.y + (point.y - from.y) * t - top, settings);
  }
  context.globalAlpha = settings.opacity / 100;
  context.drawImage(layer, left, top);
  context.restore();
}

function floodFill({ surface, point, options }) {
  const { context, canvas } = surface;
  const width = canvas.width;
  const height = canvas.height;
  const x = Math.max(0, Math.min(width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(point.y)));
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const seed = y * width + x;
  const offset = seed * 4;
  const target = [data[offset], data[offset + 1], data[offset + 2]];
  const replacement = rgb(options.color);
  if (target.every((component, index) => component === replacement[index])) return false;

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
    const pixel = index * 4;
    if (Math.abs(data[pixel] - target[0]) > threshold ||
        Math.abs(data[pixel + 1] - target[1]) > threshold ||
        Math.abs(data[pixel + 2] - target[2]) > threshold) continue;

    for (let channel = 0; channel < 3; channel++) {
      data[pixel + channel] = Math.round(data[pixel + channel] * (1 - opacity) + replacement[channel] * opacity);
    }
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
  const changed = command.kind === 'bucket' ? floodFill(command) : (drawMark(command), true);
  if (changed) command.surface.texture.needsUpdate = true;
  return changed;
}

export function samplePaintColor(surface, point) {
  const x = Math.max(0, Math.min(surface.canvas.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(surface.canvas.height - 1, Math.floor(point.y)));
  const pixel = surface.context.getImageData(x, y, 1, 1).data;
  return `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
