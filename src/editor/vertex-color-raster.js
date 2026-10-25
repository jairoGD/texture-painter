// Bake mesh vertex colors into the material's UV atlas. The canvas remains a
// reusable graph source, so painting another layer never rerasterizes the mesh.
export function rasterizeVertexColors(geometry, slotIndex, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const uv = geometry?.getAttribute('uv');
  const color = geometry?.getAttribute('color');
  if (!uv || !color || (!geometry.groups.length && slotIndex !== 0)) return pixels;
  const index = geometry.index;
  const count = index ? index.count : uv.count;
  const encode = (linear) => {
    const value = Math.max(0, Math.min(1, linear));
    return 255 * (value <= 0.0031308 ? value * 12.92 :
      1.055 * value ** (1 / 2.4) - 0.055);
  };
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    if (geometry.groups.length && !geometry.groups.some((group) =>
      triangle >= group.start && triangle < group.start + group.count &&
      group.materialIndex === slotIndex)) continue;
    const a = index ? index.getX(triangle) : triangle;
    const b = index ? index.getX(triangle + 1) : triangle + 1;
    const c = index ? index.getX(triangle + 2) : triangle + 2;
    const ax = uv.getX(a) * size; const ay = (1 - uv.getY(a)) * size;
    const bx = uv.getX(b) * size; const by = (1 - uv.getY(b)) * size;
    const cx = uv.getX(c) * size; const cy = (1 - uv.getY(c)) * size;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-8) continue;
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
      const offset = (y * size + x) * 4;
      pixels[offset] = encode(color.getX(a) * w0 + color.getX(b) * w1 + color.getX(c) * w2);
      pixels[offset + 1] = encode(color.getY(a) * w0 + color.getY(b) * w1 + color.getY(c) * w2);
      pixels[offset + 2] = encode(color.getZ(a) * w0 + color.getZ(b) * w1 + color.getZ(c) * w2);
      pixels[offset + 3] = color.itemSize >= 4 ? 255 * (
        color.getW(a) * w0 + color.getW(b) * w1 + color.getW(c) * w2) : 255;
    }
  }
  return pixels;
}
