import { decodeVisibleUv } from './screen-lasso.js';
import { blendSelectedPixel } from './selection-clipboard.js';
import { indexSelectionTiles } from './selection-coverage.js';
import { textureResolution as SIZE } from './texture-resolution.js';

export function joinedSeamPixels(alpha, topology, width = SIZE) {
  if (!topology?.portals?.size) return null;
  const joined = new Uint8Array(alpha.length);
  const mark = (index) => {
    const owner = topology.owners[index];
    const x = index % width, y = Math.floor(index / width);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= width || py < 0 || py >= alpha.length / width) continue;
      const nearby = py * width + px;
      if (alpha[nearby] && topology.owners[nearby] === owner) joined[nearby] = 1;
    }
  };
  for (const [index, neighbors] of topology.portals) {
    if (!alpha[index]) continue;
    for (const neighbor of neighbors) {
      if (neighbor < index || !alpha[neighbor]) continue;
      mark(index); mark(neighbor);
    }
  }
  return joined;
}

export function selectionBorderAt(alpha, topology, joined, index, neighbor) {
  if (neighbor >= 0 && neighbor < alpha.length && alpha[neighbor]) return false;
  // A missing atlas pixel is not a surface boundary when a selected portal
  // joins this pixel to the selected side of another UV island.
  return !joined?.[index] || (neighbor >= 0 && neighbor < alpha.length &&
    topology.owners[neighbor] !== 0);
}

function drawSelectionOutline(context, alpha, indices, topology = null) {
  const stride = SIZE + 1;
  const edges = new Map();
  const joined = joinedSeamPixels(alpha, topology);
  const addEdge = (from, to) => {
    let destinations = edges.get(from);
    if (!destinations) edges.set(from, destinations = []);
    destinations.push(to);
  };
  for (const index of indices) {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    const topLeft = y * stride + x;
    if (selectionBorderAt(alpha, topology, joined, index, y === 0 ? -1 : index - SIZE))
      addEdge(topLeft, topLeft + 1);
    if (selectionBorderAt(alpha, topology, joined, index, x === SIZE - 1 ? -1 : index + 1))
      addEdge(topLeft + 1, topLeft + stride + 1);
    if (selectionBorderAt(alpha, topology, joined, index, y === SIZE - 1 ? -1 : index + SIZE))
      addEdge(topLeft + stride + 1, topLeft + stride);
    if (selectionBorderAt(alpha, topology, joined, index, x === 0 ? -1 : index - 1))
      addEdge(topLeft + stride, topLeft);
  }
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1.25;
  context.lineJoin = 'round';
  context.setLineDash([5, 4]);
  context.beginPath();
  for (const [start, destinations] of edges) while (destinations.length) {
    context.moveTo(start % stride, Math.floor(start / stride));
    let current = start;
    do {
      const next = edges.get(current)?.pop();
      if (next === undefined) break;
      context.lineTo(next % stride, Math.floor(next / stride));
      current = next;
    } while (current !== start);
  }
  context.stroke();
}

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

export function combineSelectionParts(surface, parts, includeMaskCanvas = true,
  outlineTopology = null) {
  const alpha = new Uint8Array(SIZE * SIZE);
  const indices = [];
  for (const part of parts) for (const index of part.indices) {
    if (!alpha[index]) indices.push(index);
    alpha[index] = Math.max(alpha[index], part.alpha[index]);
  }
  const combined = selectionFromAlpha(surface, alpha, null, indices, includeMaskCanvas,
    outlineTopology);
  if (combined) combined.parts = parts;
  return combined;
}

export function combineSelectionAlpha(old, picked, mode) {
  const alpha = old.alpha.slice();
  const indices = Array.from(old.indices);
  let changed = false;
  for (const index of picked.indices) {
    const previous = alpha[index];
    const value = mode === 'subtract' ?
      Math.max(0, previous - picked.alpha[index]) :
      Math.max(previous, picked.alpha[index]);
    if (previous !== value) changed = true;
    if (mode === 'add' && !previous && value) indices.push(index);
    alpha[index] = value;
  }
  return { alpha, changed,
    indices: mode === 'subtract' ? indices.filter((index) => alpha[index]) : indices };
}

export function invertSelectionAlpha(source) {
  const alpha = new Uint8Array(source.length);
  const indices = [];
  for (let index = 0; index < source.length; index++) {
    const value = 255 - source[index];
    alpha[index] = value;
    if (value) indices.push(index);
  }
  return { alpha, indices };
}

export function selectionFromAlpha(surface, alpha, canvas = null, activeIndices = null,
  includeMaskCanvas = true, outlineTopology = null) {
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
  drawSelectionOutline(overlayContext, alpha, indices, outlineTopology);
  return { surface, canvas, alpha, bounds, overlayCanvas,
    outlineTopology,
    indices: Uint32Array.from(indices),
    occupiedTiles: includeMaskCanvas ? indexSelectionTiles(indices, SIZE, SIZE) : null };
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
  outputImage = null, outputAlpha = null, branches = null, backgroundImage = null, reuse = null) {
  const image = outputImage ?? { width: SIZE, height: SIZE,
    data: new Uint8ClampedArray(originalImage.data.length) };
  const data = image.data;
  const base = backgroundImage?.data ?? originalImage.data;
  const destinationAlpha = outputAlpha ?? new Uint8Array(SIZE * SIZE);
  if (reuse?.initialized) {
    for (const index of reuse.previousIndices) {
      const pixel = index * 4;
      data[pixel] = base[pixel];
      data[pixel + 1] = base[pixel + 1];
      data[pixel + 2] = base[pixel + 2];
      data[pixel + 3] = base[pixel + 3];
      destinationAlpha[index] = 0;
    }
  } else {
    data.set(base);
    destinationAlpha.fill(0);
    if (reuse) reuse.initialized = true;
  }
  const destinationIndices = [];
  const { alpha } = selection;
  const empty = selection.surface.imageLayer ? 0 : 255;
  if (!backgroundImage) for (const index of selection.indices) {
    const mask = alpha[index] / 255;
    if (!mask) continue;
    const pixel = index * 4;
    for (let channel = 0; channel < 4; channel++)
      data[pixel + channel] = originalImage.data[pixel + channel] * (1 - mask) + empty * mask;
  }
  const entries = branches ?? [{ selection, projection, samples, dx, dy }];
  const partAlphas = branches ? reuse?.partAlphas ??
    entries.map(() => new Uint8Array(SIZE * SIZE)) : null;
  if (partAlphas && reuse?.partIndices)
    reuse.partIndices.forEach((indices, index) => {
      for (const pixel of indices) partAlphas[index][pixel] = 0;
    });
  const partIndices = branches ? entries.map(() => []) : null;
  for (const [partIndex, entry] of entries.entries()) {
    const { buffer, width, height } = entry.projection;
    for (let index = 0; index < entry.samples.screen.length; index++) {
      const screenIndex = entry.samples.screen[index];
      const x = screenIndex % width + entry.dx;
      const y = Math.floor(screenIndex / width) + entry.dy;
      const target = decodeVisibleUv(buffer, width, height, x, y);
      if (!target) continue;
      const right = decodeVisibleUv(buffer, width, height, x + 1, y);
      const down = decodeVisibleUv(buffer, width, height, x, y + 1);
      const distance = Math.max(right ? Math.hypot(target.x - right.x, target.y - right.y) : 0,
        down ? Math.hypot(target.x - down.x, target.y - down.y) : 0);
      const radius = Math.max(2, Math.min(12, distance < 48 ? Math.ceil(distance * 0.75) : 2));
      const sourceIndex = entry.samples.source[index];
      const mask = entry.selection.alpha[sourceIndex];
      for (let py = Math.max(0, target.y - radius); py <= Math.min(SIZE - 1, target.y + radius); py++)
        for (let px = Math.max(0, target.x - radius); px <= Math.min(SIZE - 1, target.x + radius); px++) {
          if ((px - target.x) ** 2 + (py - target.y) ** 2 > radius * radius) continue;
          const destinationIndex = py * SIZE + px;
          if (partAlphas && partAlphas[partIndex][destinationIndex] < mask) {
            if (!partAlphas[partIndex][destinationIndex]) partIndices[partIndex].push(destinationIndex);
            partAlphas[partIndex][destinationIndex] = mask;
          }
          if (destinationAlpha[destinationIndex] >= mask) continue;
          if (!destinationAlpha[destinationIndex]) destinationIndices.push(destinationIndex);
          const mix = mask / 255;
          blendSelectedPixel(data, destinationIndex, originalImage.data, sourceIndex, mix);
          destinationAlpha[destinationIndex] = mask;
        }
    }
  }
  if (reuse) {
    reuse.previousIndices = destinationIndices;
    reuse.partAlphas = partAlphas;
    reuse.partIndices = partIndices;
  }
  return { image, alpha: destinationAlpha, indices: destinationIndices,
    parts: partAlphas?.map((partAlpha, index) => ({ alpha: partAlpha, indices: partIndices[index] })) };
}
