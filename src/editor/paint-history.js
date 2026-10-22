const TILE_SIZE = 64;

export function commandBounds(command, width, height) {
  if (command.kind === 'bucket' || command.kind === 'moveSelection')
    return { left: 0, top: 0, right: width, bottom: height };
  const from = command.previous ?? command.point;
  const reach = Math.max(1, (Number(command.options?.size) || 1) / 2) + 3;
  return {
    left: Math.max(0, Math.floor(Math.min(from.x, command.point.x) - reach)),
    top: Math.max(0, Math.floor(Math.min(from.y, command.point.y) - reach)),
    right: Math.min(width, Math.ceil(Math.max(from.x, command.point.x) + reach)),
    bottom: Math.min(height, Math.ceil(Math.max(from.y, command.point.y) + reach))
  };
}

function touchesTile(command, left, top, right, bottom) {
  if (command.kind === 'bucket' || command.kind === 'moveSelection') return true;
  const from = command.previous ?? command.point;
  const to = command.point;
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const lengthSquared = vx * vx + vy * vy;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((centerX - from.x) * vx + (centerY - from.y) * vy) / lengthSquared)) : 0;
  const reach = Math.max(1, (Number(command.options?.size) || 1) / 2) + 3;
  const halfDiagonal = Math.hypot(right - left, bottom - top) / 2;
  return Math.hypot(centerX - from.x - t * vx, centerY - from.y - t * vy) <= reach + halfDiagonal;
}

export function capturePaintPatches(commands, beforeImages) {
  const patches = [];
  for (const [surface, beforeImage] of beforeImages) {
    const width = surface.canvas.width;
    const height = surface.canvas.height;
    const surfaceCommands = commands.filter((command) => command.surface === surface);
    const fullCanvas = surfaceCommands.some((command) =>
      command.kind === 'bucket' || command.kind === 'moveSelection');
    const tiles = new Set();
    for (const command of fullCanvas ? [] : surfaceCommands) {
      const bounds = commandBounds(command, width, height);
      for (let y = Math.floor(bounds.top / TILE_SIZE) * TILE_SIZE; y < bounds.bottom; y += TILE_SIZE)
        for (let x = Math.floor(bounds.left / TILE_SIZE) * TILE_SIZE; x < bounds.right; x += TILE_SIZE) {
          if (touchesTile(command, x, y, Math.min(x + TILE_SIZE, width), Math.min(y + TILE_SIZE, height)))
            tiles.add(`${x}:${y}`);
        }
    }
    for (const tile of fullCanvas ? ['0:0'] : tiles) {
      const [left, top] = tile.split(':').map(Number);
      const patchWidth = fullCanvas ? width : Math.min(TILE_SIZE, width - left);
      const patchHeight = fullCanvas ? height : Math.min(TILE_SIZE, height - top);
      const before = surface.context.createImageData(patchWidth, patchHeight);
      for (let row = 0; row < patchHeight; row++) {
        const source = ((top + row) * width + left) * 4;
        before.data.set(beforeImage.data.subarray(source, source + patchWidth * 4), row * patchWidth * 4);
      }
      const after = surface.context.getImageData(left, top, patchWidth, patchHeight);
      patches.push({ surface, x: left, y: top, before, after });
    }
  }
  return patches;
}

export function applyPaintPatches(patches, state) {
  for (const patch of patches) {
    patch.surface.context.putImageData(patch[state], patch.x, patch.y);
    patch.surface.requestComposite({ left: patch.x, top: patch.y,
      right: patch.x + patch[state].width, bottom: patch.y + patch[state].height });
  }
}
