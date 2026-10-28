// Extend an island mask into its texture gutter. The UV atlas repeats, so
// neighbors at opposite atlas edges are adjacent for texture sampling.
export function uvMaskWithGutter(source, excluded, width, height, padding = 0) {
  const length = width * height;
  const covered = new Uint8Array(length);
  for (let index = 0; index < length; index++)
    covered[index] = source[index] ? 1 : 0;
  if (padding > 0) {
    let frontier = [];
    for (let index = 0; index < length; index++) {
      if (!covered[index]) continue;
      const x = index % width, y = (index - x) / width;
      const neighbors = [y * width + (x + width - 1) % width,
        y * width + (x + 1) % width,
        ((y + height - 1) % height) * width + x,
        ((y + 1) % height) * width + x];
      if (neighbors.some((neighbor) => !covered[neighbor])) frontier.push(index);
    }
    for (let step = 0; step < padding && frontier.length; step++) {
      const next = [];
      for (const index of frontier) {
        const x = index % width, y = (index - x) / width;
        const neighbors = [y * width + (x + width - 1) % width,
          y * width + (x + 1) % width,
          ((y + height - 1) % height) * width + x,
          ((y + 1) % height) * width + x];
        for (const neighbor of neighbors) if (!covered[neighbor]) {
          covered[neighbor] = 1;
          next.push(neighbor);
        }
      }
      frontier = next;
    }
  }
  for (let index = 0; index < length; index++)
    covered[index] = covered[index] && !excluded[index] ? 255 : 0;
  return covered;
}
