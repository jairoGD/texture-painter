export function addDirtyRegion(regions, region, width, height) {
  const next = {
    left: Math.max(0, Math.floor(region.left)),
    top: Math.max(0, Math.floor(region.top)),
    right: Math.min(width, Math.ceil(region.right)),
    bottom: Math.min(height, Math.ceil(region.bottom))
  };
  if (next.left >= next.right || next.top >= next.bottom) return regions;
  for (let index = 0; index < regions.length;) {
    const current = regions[index];
    if (next.left > current.right || next.right < current.left ||
        next.top > current.bottom || next.bottom < current.top) {
      index++;
      continue;
    }
    next.left = Math.min(next.left, current.left);
    next.top = Math.min(next.top, current.top);
    next.right = Math.max(next.right, current.right);
    next.bottom = Math.max(next.bottom, current.bottom);
    regions.splice(index, 1);
    index = 0;
  }
  regions.push(next);
  return regions;
}

export function dirtyArea(regions) {
  return regions.reduce((area, rect) => area +
    (rect.right - rect.left) * (rect.bottom - rect.top), 0);
}
