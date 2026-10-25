// Geometry coverage and projection weights stay unchanged when an image node's
// scale, rotation, offset, interpolation, or source pixels change.
let cachedLookup = null;

export function clearTriplanarLookup() { cachedLookup = null; }

function triangleMaterial(geometry, triangle) {
  if (!geometry.groups.length) return 0;
  const start = triangle * 3;
  return geometry.groups.find((group) =>
    start >= group.start && start < group.start + group.count)?.materialIndex ?? 0;
}

export function getTriplanarLookup(geometry, slotIndex, size) {
  if (cachedLookup?.geometry === geometry && cachedLookup.slotIndex === slotIndex &&
      cachedLookup.size === size) return cachedLookup;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!position || !uv) return null;
  const normal = geometry.getAttribute('normal');
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const centerX = (min.x + max.x) / 2;
  const centerY = (min.y + max.y) / 2;
  const centerZ = (min.z + max.z) / 2;
  const extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.001);
  const pixels = size * size;
  const coordinates = new Uint16Array(pixels * 3);
  const weights = new Uint16Array(pixels * 2);
  const flags = new Uint8Array(pixels);
  const indices = geometry.index;
  const count = indices ? indices.count : position.count;

  for (let triangle = 0; triangle < count / 3; triangle++) {
    if (triangleMaterial(geometry, triangle) !== slotIndex) continue;
    const i0 = indices ? indices.getX(triangle * 3) : triangle * 3;
    const i1 = indices ? indices.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const i2 = indices ? indices.getX(triangle * 3 + 2) : triangle * 3 + 2;
    const ax = uv.getX(i0) * size; const ay = (1 - uv.getY(i0)) * size;
    const bx = uv.getX(i1) * size; const by = (1 - uv.getY(i1)) * size;
    const cx = uv.getX(i2) * size; const cy = (1 - uv.getY(i2)) * size;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-8) continue;
    const inverse = 1 / denominator;
    const px0 = position.getX(i0); const py0 = position.getY(i0); const pz0 = position.getZ(i0);
    const px1 = position.getX(i1); const py1 = position.getY(i1); const pz1 = position.getZ(i1);
    const px2 = position.getX(i2); const py2 = position.getY(i2); const pz2 = position.getZ(i2);
    let nx0; let ny0; let nz0; let nx1; let ny1; let nz1; let nx2; let ny2; let nz2;
    if (normal) {
      nx0 = normal.getX(i0); ny0 = normal.getY(i0); nz0 = normal.getZ(i0);
      nx1 = normal.getX(i1); ny1 = normal.getY(i1); nz1 = normal.getZ(i1);
      nx2 = normal.getX(i2); ny2 = normal.getY(i2); nz2 = normal.getZ(i2);
    } else {
      const abx = px1 - px0; const aby = py1 - py0; const abz = pz1 - pz0;
      const acx = px2 - px0; const acy = py2 - py0; const acz = pz2 - pz0;
      nx0 = aby * acz - abz * acy;
      ny0 = abz * acx - abx * acz;
      nz0 = abx * acy - aby * acx;
      nx1 = nx2 = nx0; ny1 = ny2 = ny0; nz1 = nz2 = nz0;
    }
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      const w0 = ((by - cy) * (sampleX - cx) + (cx - bx) * (sampleY - cy)) * inverse;
      const w1 = ((cy - ay) * (sampleX - cx) + (ax - cx) * (sampleY - cy)) * inverse;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.00001 || w1 < -0.00001 || w2 < -0.00001) continue;
      const pointX = px0 * w0 + px1 * w1 + px2 * w2;
      const pointY = py0 * w0 + py1 * w1 + py2 * w2;
      const pointZ = pz0 * w0 + pz1 * w1 + pz2 * w2;
      const normalX = nx0 * w0 + nx1 * w1 + nx2 * w2;
      const normalY = ny0 * w0 + ny1 * w1 + ny2 * w2;
      const normalZ = nz0 * w0 + nz1 * w1 + nz2 * w2;
      const xx = normalX * normalX; const yy = normalY * normalY; const zz = normalZ * normalZ;
      const weightX = xx * xx; const weightY = yy * yy; const weightZ = zz * zz;
      const total = weightX + weightY + weightZ;
      const normalizedX = total > 1e-12 ? weightX / total : 0;
      const normalizedY = total > 1e-12 ? weightY / total : 0;
      const offset = y * size + x;
      const coordinateOffset = offset * 3;
      coordinates[coordinateOffset] = Math.round(Math.max(0, Math.min(1,
        0.5 + (pointX - centerX) / extent)) * 65535);
      coordinates[coordinateOffset + 1] = Math.round(Math.max(0, Math.min(1,
        0.5 + (pointY - centerY) / extent)) * 65535);
      coordinates[coordinateOffset + 2] = Math.round(Math.max(0, Math.min(1,
        0.5 + (pointZ - centerZ) / extent)) * 65535);
      weights[offset * 2] = Math.round(normalizedX * 65535);
      weights[offset * 2 + 1] = Math.min(65535 - weights[offset * 2],
        Math.round(normalizedY * 65535));
      flags[offset] = 8 | (normalX >= 0 ? 1 : 0) |
        (normalY >= 0 ? 2 : 0) | (normalZ >= 0 ? 4 : 0);
    }
  }
  cachedLookup = { geometry, slotIndex, size, coordinates, weights, flags };
  return cachedLookup;
}

function wrapTexel(index, length, extension) {
  if (extension === 'clip') return index < 0 || index >= length ? -1 : index;
  if (extension === 'repeat') return ((index % length) + length) % length;
  if (extension === 'mirror') {
    const value = ((index % (length * 2)) + length * 2) % (length * 2);
    return value < length ? value : length * 2 - 1 - value;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function sampleInto(out, source, width, height, u, v, interpolation, extension) {
  const sourceX = u * width - 0.5;
  const sourceY = (1 - v) * height - 0.5;
  if (interpolation === 'closest') {
    const x = wrapTexel(Math.round(sourceX), width, extension);
    const y = wrapTexel(Math.round(sourceY), height, extension);
    const offset = x < 0 || y < 0 ? -1 : (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++) out[channel] = offset < 0 ? 0 : source[offset + channel];
    return;
  }
  const floorX = Math.floor(sourceX); const floorY = Math.floor(sourceY);
  const fractionX = sourceX - floorX; const fractionY = sourceY - floorY;
  const x0 = wrapTexel(floorX, width, extension);
  const x1 = wrapTexel(floorX + 1, width, extension);
  const y0 = wrapTexel(floorY, height, extension);
  const y1 = wrapTexel(floorY + 1, height, extension);
  const p00 = x0 < 0 || y0 < 0 ? -1 : (y0 * width + x0) * 4;
  const p10 = x1 < 0 || y0 < 0 ? -1 : (y0 * width + x1) * 4;
  const p01 = x0 < 0 || y1 < 0 ? -1 : (y1 * width + x0) * 4;
  const p11 = x1 < 0 || y1 < 0 ? -1 : (y1 * width + x1) * 4;
  const topLeft = (1 - fractionX) * (1 - fractionY);
  const topRight = fractionX * (1 - fractionY);
  const bottomLeft = (1 - fractionX) * fractionY;
  const bottomRight = fractionX * fractionY;
  for (let channel = 0; channel < 4; channel++) out[channel] =
    (p00 < 0 ? 0 : source[p00 + channel]) * topLeft +
    (p10 < 0 ? 0 : source[p10 + channel]) * topRight +
    (p01 < 0 ? 0 : source[p01 + channel]) * bottomLeft +
    (p11 < 0 ? 0 : source[p11 + channel]) * bottomRight;
}

export function shadeTriplanarLookup(lookup, source, width, height, target, node) {
  const scale = Number(node.scale) || 1;
  const rotation = (Number(node.rotation) || 0) * Math.PI / 180;
  const cosine = Math.cos(rotation); const sine = Math.sin(rotation);
  const a = scale * cosine; const b = -scale * sine;
  const d = scale * sine; const e = scale * cosine;
  const c = scale * 0.5 * (1 - cosine + sine) + (Number(node.offsetU) || 0);
  const f = scale * 0.5 * (1 - sine - cosine) + (Number(node.offsetV) || 0);
  const interpolation = node.interpolation ?? 'linear';
  const extension = node.extension ?? 'repeat';
  const sampled = new Float64Array(4);
  const { coordinates, weights, flags } = lookup;
  for (let pixel = 0; pixel < flags.length; pixel++) {
    const sign = flags[pixel];
    if (!(sign & 8)) continue;
    const x = coordinates[pixel * 3] / 65535;
    const y = coordinates[pixel * 3 + 1] / 65535;
    const z = coordinates[pixel * 3 + 2] / 65535;
    const wx = weights[pixel * 2] / 65535;
    const wy = weights[pixel * 2 + 1] / 65535;
    const wz = 1 - wx - wy;
    let red = 0; let green = 0; let blue = 0; let alpha = 0;
    if (wx > 1e-5) {
      const u = sign & 1 ? 1 - z : z;
      sampleInto(sampled, source, width, height, a * u + b * y + c,
        d * u + e * y + f, interpolation, extension);
      const strength = sampled[3] * wx;
      red += sampled[0] * strength; green += sampled[1] * strength;
      blue += sampled[2] * strength; alpha += strength;
    }
    if (wy > 1e-5) {
      const v = sign & 2 ? z : 1 - z;
      sampleInto(sampled, source, width, height, a * x + b * v + c,
        d * x + e * v + f, interpolation, extension);
      const strength = sampled[3] * wy;
      red += sampled[0] * strength; green += sampled[1] * strength;
      blue += sampled[2] * strength; alpha += strength;
    }
    if (wz > 1e-5) {
      const u = sign & 4 ? x : 1 - x;
      sampleInto(sampled, source, width, height, a * u + b * y + c,
        d * u + e * y + f, interpolation, extension);
      const strength = sampled[3] * wz;
      red += sampled[0] * strength; green += sampled[1] * strength;
      blue += sampled[2] * strength; alpha += strength;
    }
    const offset = pixel * 4;
    if (alpha > 0) {
      target[offset] = red / alpha;
      target[offset + 1] = green / alpha;
      target[offset + 2] = blue / alpha;
      target[offset + 3] = alpha;
    }
  }
}
