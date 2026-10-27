// Bake mesh vertex colors into the material's UV atlas. The canvas remains a
// reusable graph source, so painting another layer never rerasterizes the mesh.
export function rasterizeVertexColors(geometry, slotIndex, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const uv = geometry?.getAttribute('uv');
  const color = geometry?.getAttribute('color');
  if (!uv || !color || (!geometry.groups.length && slotIndex !== 0)) return pixels;
  const index = geometry.index;
  const count = index ? index.count : uv.count;
  const coverage = new Uint8Array(size * size);
  const padding = Math.min(Math.floor(size / 8), 16,
    Math.max(4, Math.floor(size / 128)));
  const encode = (linear) => {
    const value = Math.max(0, Math.min(1, linear));
    return 255 * (value <= 0.0031308 ? value * 12.92 :
      1.055 * value ** (1 / 2.4) - 0.055);
  };
  const forEachTriangle = (visit) => {
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      if (geometry.groups.length && !geometry.groups.some((group) =>
        triangle >= group.start && triangle < group.start + group.count &&
        group.materialIndex === slotIndex)) continue;
      const ids = [index ? index.getX(triangle) : triangle,
        index ? index.getX(triangle + 1) : triangle + 1,
        index ? index.getX(triangle + 2) : triangle + 2];
      const points = ids.map((id) => [uv.getX(id) * size, (1 - uv.getY(id)) * size]);
      visit(ids, points);
    }
  };
  forEachTriangle(([a, b, c], [[ax, ay], [bx, by], [cx, cy]]) => {
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-8) return;
    const inverse = 1 / denominator;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * inverse;
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * inverse;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.00001 || w1 < -0.00001 || w2 < -0.00001) continue;
      const pixel = y * size + x;
      // Mirror modifiers append generated faces after the original mesh.
      // Keep the first face at a shared UV pixel when converting to a bitmap.
      if (coverage[pixel]) continue;
      coverage[pixel] = 1;
      const offset = pixel * 4;
      pixels[offset] = encode(color.getX(a) * w0 + color.getX(b) * w1 + color.getX(c) * w2);
      pixels[offset + 1] = encode(color.getY(a) * w0 + color.getY(b) * w1 + color.getY(c) * w2);
      pixels[offset + 2] = encode(color.getZ(a) * w0 + color.getZ(b) * w1 + color.getZ(c) * w2);
      pixels[offset + 3] = color.itemSize >= 4 ? 255 * (
        color.getW(a) * w0 + color.getW(b) * w1 + color.getW(c) * w2) : 255;
    }
  });
  // Grow colors from texels actually covered by UV triangles. This includes
  // seams whose duplicated edges do not form a detectable atlas boundary.
  // The queue visits only the island perimeter and its gutter, not the whole
  // texture once per padding pixel. Atlas edges wrap like the Three.js texture.
  const neighbor = (pixel, dx, dy) => {
    const x = (pixel % size + dx + size) % size;
    const y = (Math.floor(pixel / size) + dy + size) % size;
    return y * size + x;
  };
  let frontier = [];
  for (let pixel = 0; pixel < coverage.length; pixel++) {
    if (!coverage[pixel]) continue;
    if (!coverage[neighbor(pixel, -1, 0)] || !coverage[neighbor(pixel, 1, 0)] ||
        !coverage[neighbor(pixel, 0, -1)] || !coverage[neighbor(pixel, 0, 1)])
      frontier.push(pixel);
  }
  for (let step = 0; step < padding && frontier.length; step++) {
    const next = [];
    for (const source of frontier) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const target = neighbor(source, dx, dy);
        if (coverage[target]) continue;
        coverage[target] = 1;
        pixels.set(pixels.subarray(source * 4, source * 4 + 4), target * 4);
        next.push(target);
      }
    }
    frontier = next;
  }
  return pixels;
}
