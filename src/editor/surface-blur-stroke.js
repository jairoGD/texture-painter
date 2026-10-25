// A small, mesh-connected blur region. UV seam portals behave like ordinary
// neighbours, so one dab reads AND writes on both sides of a seam.
const TILE = 64;

export function blurTouchesSeam(topology, point, previous, radius, reach, width, height) {
  if (!topology?.portalTiles?.size) return false;
  const from = previous ?? point;
  const pad = radius + reach + 1;
  const left = Math.max(0, Math.floor((Math.min(from.x, point.x) - pad) / TILE));
  const right = Math.min(Math.ceil(width / TILE) - 1,
    Math.floor((Math.max(from.x, point.x) + pad) / TILE));
  const top = Math.max(0, Math.floor((Math.min(from.y, point.y) - pad) / TILE));
  const bottom = Math.min(Math.ceil(height / TILE) - 1,
    Math.floor((Math.max(from.y, point.y) + pad) / TILE));
  const vx = point.x - from.x, vy = point.y - from.y;
  const lengthSquared = vx * vx + vy * vy;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++)
    for (const pixel of topology.portalTiles.get(`${x}:${y}`) ?? []) {
      const px = pixel % width + 0.5, py = Math.floor(pixel / width) + 0.5;
      const t = lengthSquared ? Math.max(0, Math.min(1,
        ((px - from.x) * vx + (py - from.y) * vy) / lengthSquared)) : 0;
      if (Math.hypot(px - from.x - t * vx, py - from.y - t * vy) <= pad) return true;
    }
  return false;
}

export function blurSurfaceStroke({ surface, point, previous, options, mask, isolateBlur,
  topology, faceIndex }) {
  const { canvas, context } = surface;
  const width = canvas.width, height = canvas.height;
  const radius = Math.max(1, options.size / 2);
  const sigma = Math.max(0.5, options.spread / 3);
  const halo = Math.ceil(sigma * 3);
  const limit = Math.ceil(radius + halo);
  const from = previous ?? point;
  const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y)));
  const ids = [];
  const distances = [];
  const lookup = new Map();
  const queue = [];
  const isolated = !!mask && isolateBlur;
  const add = (id, distance) => {
    if (id < 0 || !topology.owners[id] || lookup.has(id) ||
        (isolated && !mask.alpha[id])) return;
    lookup.set(id, ids.length);
    ids.push(id);
    distances.push(distance);
    queue.push(ids.length - 1);
  };
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.floor(from.x + (point.x - from.x) * t);
    const y = Math.floor(from.y + (point.y - from.y) * t);
    if (x >= 0 && y >= 0 && x < width && y < height)
      add(topology.seed(x, y, faceIndex), 0);
  }
  if (!queue.length) return [];
  const neighbours = (id, visit) => {
    const x = id % width, y = (id - x) / width;
    if (x > 0 && topology.connected(id, id - 1)) visit(id - 1);
    if (x + 1 < width && topology.connected(id, id + 1)) visit(id + 1);
    if (y > 0 && topology.connected(id, id - width)) visit(id - width);
    if (y + 1 < height && topology.connected(id, id + width)) visit(id + width);
    for (const remote of topology.portals.get(id) ?? []) visit(remote);
  };
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], distance = distances[index];
    if (distance >= limit) continue;
    neighbours(ids[index], (other) => add(other, distance + 1));
  }

  // Read only the tiles touched by this dab. All input is copied before any
  // output is written, so each stroke sample uses a stable source image.
  const tiles = new Map();
  const tileFor = (id) => {
    const x = id % width, y = (id - x) / width;
    const left = Math.floor(x / TILE) * TILE, top = Math.floor(y / TILE) * TILE;
    const key = `${left}:${top}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { left, top, image: context.getImageData(left, top,
        Math.min(TILE, width - left), Math.min(TILE, height - top)), dirty: false };
      tiles.set(key, tile);
    }
    return [tile, ((y - top) * tile.image.width + x - left) * 4];
  };
  const count = ids.length;
  const source = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [tile, offset] = tileFor(ids[i]);
    const data = tile.image.data, alpha = data[offset + 3] / 255;
    source[i * 4] = data[offset] * alpha;
    source[i * 4 + 1] = data[offset + 1] * alpha;
    source[i * 4 + 2] = data[offset + 2] * alpha;
    source[i * 4 + 3] = data[offset + 3];
  }
  const adjacent = new Array(count);
  for (let i = 0; i < count; i++) {
    const list = [];
    neighbours(ids[i], (id) => {
      const neighbour = lookup.get(id);
      if (neighbour !== undefined) list.push(neighbour);
    });
    adjacent[i] = list;
  }
  // Four-neighbour diffusion has variance about one texel squared per pass.
  // Cap the pass count to keep large brush dabs interactive.
  const passes = Math.min(72, Math.max(1, Math.round(sigma * sigma)));
  let current = source, next = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < count; i++) {
      const list = adjacent[i], base = i * 4;
      if (!list.length) {
        next.set(current.subarray(base, base + 4), base);
        continue;
      }
      const weight = 0.75 / list.length;
      for (let channel = 0; channel < 4; channel++) {
        let value = current[base + channel] * 0.25;
        for (let n = 0; n < list.length; n++)
          value += current[list[n] * 4 + channel] * weight;
        next[base + channel] = value;
      }
    }
    [current, next] = [next, current];
  }
  const strength = options.strength / 100;
  const innerRadius = radius * options.hardness / 100;
  const changedPixels = [];
  for (let i = 0; i < count; i++) {
    const distance = distances[i];
    if (distance >= radius) continue;
    const edge = options.hardness >= 100 || distance <= innerRadius ? 1 :
      1 - Math.max(0, Math.min(1, (distance - innerRadius) / (radius - innerRadius)));
    const falloff = edge * edge * (3 - 2 * edge);
    const coverage = mask ? mask.alpha[ids[i]] / 255 : 1;
    const mix = strength * falloff * coverage;
    if (!mix) continue;
    const [tile, offset] = tileFor(ids[i]);
    const data = tile.image.data, base = i * 4;
    const alpha = source[base + 3] * (1 - mix) + current[base + 3] * mix;
    let changed = Math.round(alpha) !== data[offset + 3];
    for (let channel = 0; channel < 3; channel++) {
      const premultiplied = source[base + channel] * (1 - mix) + current[base + channel] * mix;
      const value = alpha ? Math.round(premultiplied * 255 / alpha) : 0;
      if (value !== data[offset + channel]) changed = true;
      data[offset + channel] = value;
    }
    data[offset + 3] = Math.round(alpha);
    if (changed) {
      tile.dirty = true;
      changedPixels.push(ids[i]);
    }
  }
  // Linear texture sampling reads just outside a UV island. Extend freshly
  // blurred edge texels into two unowned texels so that interpolation does not
  // expose transparent atlas pixels as a dark seam on the mesh.
  let frontier = changedPixels;
  const padded = new Set();
  for (let distance = 0; distance < 2 && frontier.length; distance++) {
    const nextFrontier = [];
    for (const id of frontier) {
      const x = id % width, y = (id - x) / width;
      const [sourceTile, sourceOffset] = tileFor(id);
      const color = sourceTile.image.data.subarray(sourceOffset, sourceOffset + 4);
      if (!color[3]) continue;
      for (const target of [x > 0 ? id - 1 : -1, x + 1 < width ? id + 1 : -1,
        y > 0 ? id - width : -1, y + 1 < height ? id + width : -1]) {
        if (target < 0 || topology.owners[target] || padded.has(target)) continue;
        padded.add(target);
        const [tile, offset] = tileFor(target);
        tile.image.data.set(color, offset);
        tile.dirty = true;
        nextFrontier.push(target);
      }
    }
    frontier = nextFrontier;
  }
  const dirtyTiles = [];
  for (const tile of tiles.values()) if (tile.dirty) {
    context.putImageData(tile.image, tile.left, tile.top);
    dirtyTiles.push({ left: tile.left, top: tile.top,
      right: tile.left + tile.image.width, bottom: tile.top + tile.image.height });
  }
  dirtyTiles.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows = [];
  for (const tile of dirtyTiles) {
    const last = rows.at(-1);
    if (last && last.top === tile.top && last.right === tile.left)
      last.right = tile.right;
    else rows.push({ ...tile });
  }
  const regions = [];
  for (const row of rows) {
    const above = regions.find((region) => region.left === row.left &&
      region.right === row.right && region.bottom === row.top);
    if (above) above.bottom = row.bottom;
    else regions.push(row);
  }
  return regions;
}
