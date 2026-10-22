export const MASK_TILE_SIZE = 32;

export function indexSelectionTiles(indices, width, height) {
  const columns = Math.ceil(width / MASK_TILE_SIZE);
  const rows = Math.ceil(height / MASK_TILE_SIZE);
  const tiles = new Uint8Array(columns * rows);
  for (const index of indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    tiles[Math.floor(y / MASK_TILE_SIZE) * columns + Math.floor(x / MASK_TILE_SIZE)] = 1;
  }
  return tiles;
}

export function strokeTouchesSelection(selection, from, to, radius, width, height) {
  const left = Math.max(0, selection.bounds.left,
    Math.floor(Math.min(from.x, to.x) - radius - 1));
  const top = Math.max(0, selection.bounds.top,
    Math.floor(Math.min(from.y, to.y) - radius - 1));
  const right = Math.min(width, selection.bounds.right,
    Math.ceil(Math.max(from.x, to.x) + radius + 1));
  const bottom = Math.min(height, selection.bounds.bottom,
    Math.ceil(Math.max(from.y, to.y) + radius + 1));
  if (left >= right || top >= bottom) return false;

  const columns = Math.ceil(width / MASK_TILE_SIZE);
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const lengthSquared = vx * vx + vy * vy;
  const radiusSquared = radius * radius;
  for (let tileY = Math.floor(top / MASK_TILE_SIZE);
    tileY <= Math.floor((bottom - 1) / MASK_TILE_SIZE); tileY++) {
    for (let tileX = Math.floor(left / MASK_TILE_SIZE);
      tileX <= Math.floor((right - 1) / MASK_TILE_SIZE); tileX++) {
      if (selection.occupiedTiles && !selection.occupiedTiles[tileY * columns + tileX]) continue;
      const x0 = Math.max(left, tileX * MASK_TILE_SIZE);
      const x1 = Math.min(right, (tileX + 1) * MASK_TILE_SIZE);
      const y0 = Math.max(top, tileY * MASK_TILE_SIZE);
      const y1 = Math.min(bottom, (tileY + 1) * MASK_TILE_SIZE);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (!selection.alpha[y * width + x]) continue;
        const px = x + 0.5 - from.x;
        const py = y + 0.5 - from.y;
        const t = lengthSquared ? Math.max(0, Math.min(1,
          (px * vx + py * vy) / lengthSquared)) : 0;
        const dx = px - t * vx;
        const dy = py - t * vy;
        if (dx * dx + dy * dy < radiusSquared) return true;
      }
    }
  }
  return false;
}
