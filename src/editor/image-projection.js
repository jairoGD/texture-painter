function wrap(value, extension) {
  if (extension === 'clip' && (value < 0 || value > 1)) return null;
  if (extension === 'repeat') return ((value % 1) + 1) % 1;
  if (extension === 'mirror') {
    const cycle = ((value % 2) + 2) % 2;
    return cycle <= 1 ? cycle : 2 - cycle;
  }
  return Math.max(0, Math.min(1, value));
}

function samplePixel(source, width, height, x, y, extension) {
  const u = wrap((x + 0.5) / width, extension);
  const v = wrap((y + 0.5) / height, extension);
  if (u === null || v === null) return [0, 0, 0, 0];
  const column = Math.min(width - 1, Math.floor(u * width));
  const row = Math.min(height - 1, Math.floor(v * height));
  const offset = (row * width + column) * 4;
  return source.subarray(offset, offset + 4);
}

export function sampleImage(source, width, height, u, v, interpolation, extension) {
  const x = u * width - 0.5;
  const y = (1 - v) * height - 0.5;
  if (interpolation === 'closest')
    return samplePixel(source, width, height, Math.round(x), Math.round(y), extension);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const p00 = samplePixel(source, width, height, x0, y0, extension);
  const p10 = samplePixel(source, width, height, x0 + 1, y0, extension);
  const p01 = samplePixel(source, width, height, x0, y0 + 1, extension);
  const p11 = samplePixel(source, width, height, x0 + 1, y0 + 1, extension);
  return [0, 1, 2, 3].map((channel) =>
    (p00[channel] * (1 - dx) + p10[channel] * dx) * (1 - dy) +
    (p01[channel] * (1 - dx) + p11[channel] * dx) * dy);
}

export function projectedUv(position, normal, projection) {
  const [x, y, z] = position;
  if (projection === 'sphere' || projection === 'tube') {
    const px = x * 2 - 1;
    const py = y * 2 - 1;
    const pz = z * 2 - 1;
    const u = (Math.atan2(pz, px) / (2 * Math.PI) + 1) % 1;
    if (projection === 'tube') return [u, y];
    const radius = Math.hypot(px, py, pz) || 1;
    return [u, 1 - Math.acos(Math.max(-1, Math.min(1, py / radius))) / Math.PI];
  }
  const [nx, ny, nz] = normal.map(Math.abs);
  if (nx >= ny && nx >= nz) return [normal[0] >= 0 ? 1 - z : z, y];
  if (ny >= nz) return [x, normal[1] >= 0 ? z : 1 - z];
  return [normal[2] >= 0 ? x : 1 - x, y];
}

function triangleMaterial(geometry, triangle) {
  if (!geometry.groups.length) return 0;
  const start = triangle * 3;
  return geometry.groups.find((group) => start >= group.start && start < group.start + group.count)?.materialIndex ?? 0;
}

export function bakeImageToUv(surface, node, imageCanvas, size) {
  const result = document.createElement('canvas');
  result.width = result.height = size;
  const context = result.getContext('2d');
  const interpolation = node.interpolation ?? 'linear';
  const extension = node.extension ?? 'repeat';
  const offsetU = Number(node.offsetU) || 0;
  const offsetV = Number(node.offsetV) || 0;
  const scale = Number(node.scale) || 1;
  if ((node.projection ?? 'flat') === 'flat' && scale === 1 && !offsetU && !offsetV) {
    context.imageSmoothingEnabled = interpolation !== 'closest';
    context.imageSmoothingQuality = 'high';
    context.drawImage(imageCanvas, 0, 0, size, size);
    return result;
  }
  const sourceContext = imageCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height).data;
  const output = context.createImageData(size, size);
  const target = output.data;
  const write = (index, u, v) => {
    const rgba = sampleImage(source, imageCanvas.width, imageCanvas.height,
      u * scale + offsetU, v * scale + offsetV, interpolation, extension);
    const pixel = index * 4;
    for (let channel = 0; channel < 4; channel++) target[pixel + channel] = rgba[channel];
  };
  if ((node.projection ?? 'flat') === 'flat' || !surface.geometry) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      write(y * size + x, (x + 0.5) / size, 1 - (y + 0.5) / size);
  } else {
    const geometry = surface.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    if (!position || !uv) return result;
    const bounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox);
    const min = bounds.min;
    const extent = bounds.max.clone().sub(min);
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let triangle = 0; triangle < count / 3; triangle++) {
      if (triangleMaterial(geometry, triangle) !== surface.slotIndex) continue;
      const ids = [0, 1, 2].map((corner) => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner);
      const coords = ids.map((id) => [uv.getX(id) * size, (1 - uv.getY(id)) * size]);
      const [a, b, c] = coords;
      const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(denominator) < 1e-8) continue;
      const positions = ids.map((id) => [position.getX(id), position.getY(id), position.getZ(id)]);
      const normals = ids.map((id) => normal ? [normal.getX(id), normal.getY(id), normal.getZ(id)] : [0, 0, 1]);
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const weights = [((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / denominator,
          ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / denominator];
        weights.push(1 - weights[0] - weights[1]);
        if (weights.some((weight) => weight < -0.00001)) continue;
        const point = [0, 1, 2].map((axis) =>
          (positions.reduce((sum, vertex, corner) => sum + vertex[axis] * weights[corner], 0) - min.getComponent(axis)) /
          (extent.getComponent(axis) || 1));
        const facing = [0, 1, 2].map((axis) =>
          normals.reduce((sum, vertex, corner) => sum + vertex[axis] * weights[corner], 0));
        const [u, v] = projectedUv(point, facing, node.projection);
        write(y * size + x, u, v);
      }
    }
  }
  context.putImageData(output, 0, 0);
  return result;
}
