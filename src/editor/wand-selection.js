export function wandSelectionMask(image, x, y, tolerance = 30, similar = false,
  topology = null, faceIndex = null) {
  const { width, height, data } = image;
  const size = width * height;
  const mask = new Uint8Array(size);
  if (x < 0 || x >= width || y < 0 || y >= height) return mask;
  const seed = topology ? topology.seed(x, y, faceIndex) : y * width + x;
  if (seed < 0) return mask;
  const offset = seed * 4;
  const red = data[offset], green = data[offset + 1];
  const blue = data[offset + 2], alpha = data[offset + 3];
  const limit = Math.max(0, Math.min(255, Math.round(tolerance)));
  const matches = (index) => {
    const pixel = index * 4;
    return Math.abs(data[pixel] - red) <= limit &&
      Math.abs(data[pixel + 1] - green) <= limit &&
      Math.abs(data[pixel + 2] - blue) <= limit &&
      Math.abs(data[pixel + 3] - alpha) <= limit;
  };
  if (similar) {
    for (let index = 0; index < size; index++)
      if ((!topology || topology.owners[index]) && matches(index)) mask[index] = 255;
    return mask;
  }

  const tested = new Uint8Array(size);
  const stack = [seed];
  tested[seed] = 1;
  const enqueue = (index, from, portal = false) => {
    if (tested[index] || (topology && !portal && !topology.connected(from, index))) return;
    tested[index] = 1;
    stack.push(index);
  };
  while (stack.length) {
    const index = stack.pop();
    if (!matches(index)) continue;
    mask[index] = 255;
    const px = index % width;
    if (px > 0) enqueue(index - 1, index);
    if (px < width - 1) enqueue(index + 1, index);
    if (index >= width) enqueue(index - width, index);
    if (index < size - width) enqueue(index + width, index);
    if (topology) for (const neighbor of topology.portals.get(index) ?? [])
      enqueue(neighbor, index, true);
  }
  return mask;
}

export function combineWandMasks(existing, added, mode = 'replace') {
  if (mode === 'replace' || !existing) return added;
  const result = new Uint8Array(added.length);
  for (let index = 0; index < result.length; index++)
    result[index] = mode === 'subtract' ?
      (existing[index] && !added[index] ? existing[index] : 0) :
      Math.max(existing[index], added[index]);
  return result;
}
