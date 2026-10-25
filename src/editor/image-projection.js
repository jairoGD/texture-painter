import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export function warpProjectionTransform(node, geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const center = bounds.getCenter(new Vector3());
  const extent = bounds.getSize(new Vector3());
  const longest = Math.max(extent.x, extent.y, extent.z, 0.001);
  const saved = node.warp ?? {};
  const values = (input, fallback) => Array.isArray(input) && input.length === 3 &&
    input.every(Number.isFinite) ? input : fallback;
  return {
    position: values(saved.position, center.toArray()),
    rotation: values(saved.rotation, [0, 0, 0]),
    scale: values(saved.scale, [Math.max(extent.x, longest * 0.25),
      Math.max(extent.y, longest * 0.25), longest])
  };
}

export function warpProjectionInverse(transform) {
  const position = new Vector3(...transform.position);
  const rotation = new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ'));
  const scale = new Vector3(...transform.scale.map((value) => Math.max(Math.abs(value), 0.0001)));
  return new Matrix4().compose(position, rotation, scale).invert();
}

export function resizeWarpProjection(transform, signs, factor) {
  const scale = transform.scale.map((value, axis) =>
    signs[axis] ? Math.max(0.001, value * factor) : value);
  const offset = new Vector3(...scale.map((value, axis) =>
    signs[axis] * (value - transform.scale[axis]) / 2));
  offset.applyQuaternion(new Quaternion().setFromEuler(new Euler(...transform.rotation, 'XYZ')));
  const position = new Vector3(...transform.position).add(offset);
  return { ...transform, position: position.toArray(), scale };
}

export function warpProjectedUv(position, inverse) {
  const elements = inverse.elements;
  const x = position[0] * elements[0] + position[1] * elements[4] +
    position[2] * elements[8] + elements[12];
  const y = position[0] * elements[1] + position[1] * elements[5] +
    position[2] * elements[9] + elements[13];
  const z = position[0] * elements[2] + position[1] * elements[6] +
    position[2] * elements[10] + elements[14];
  if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5 || Math.abs(z) > 0.5)
    return null;
  return [x + 0.5, y + 0.5];
}

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

export function drawFlatImageRegion(context, imageCanvas, node, region, size) {
  const scale = Number(node.scale) || 1;
  const scaleU = scale;
  const scaleV = scale;
  const offsetU = Number(node.offsetU) || 0;
  const offsetV = Number(node.offsetV) || 0;
  const rotation = (Number(node.rotation) || 0) * Math.PI / 180;
  const width = region.right - region.left;
  const height = region.bottom - region.top;
  context.imageSmoothingEnabled = node.interpolation !== 'closest';
  if (scaleU === 1 && scaleV === 1 && !offsetU && !offsetV && !rotation) {
    context.drawImage(imageCanvas, -region.left, -region.top, size, size);
    return true;
  }
  const tileWidth = size / scaleU;
  const tileHeight = size / scaleV;
  const x = -offsetU * tileWidth - region.left;
  const y = -(1 - scaleV - offsetV) * tileHeight - region.top;
  if (rotation) {
    const centerX = size / 2 - region.left;
    const centerY = size / 2 - region.top;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(rotation);
    context.translate(-centerX, -centerY);
  }
  if (node.extension === 'clip') {
    context.drawImage(imageCanvas, x, y, tileWidth, tileHeight);
    if (rotation) context.restore();
    return true;
  }
  if ((node.extension ?? 'repeat') === 'repeat' && typeof DOMMatrix !== 'undefined') {
    const pattern = context.createPattern(imageCanvas, 'repeat');
    if (!pattern?.setTransform) {
      if (rotation) context.restore();
      return false;
    }
    pattern.setTransform(new DOMMatrix([
      tileWidth / imageCanvas.width, 0, 0, tileHeight / imageCanvas.height, x, y
    ]));
    context.fillStyle = pattern;
    if (rotation) {
      const centerX = size / 2 - region.left;
      const centerY = size / 2 - region.top;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => [
        centerX + cosine * (px - centerX) + sine * (py - centerY),
        centerY - sine * (px - centerX) + cosine * (py - centerY)
      ]);
      const left = Math.min(...corners.map(([px]) => px));
      const top = Math.min(...corners.map(([, py]) => py));
      context.fillRect(left, top,
        Math.max(...corners.map(([px]) => px)) - left,
        Math.max(...corners.map(([, py]) => py)) - top);
      context.restore();
    } else context.fillRect(0, 0, width, height);
    return true;
  }
  if (rotation) context.restore();
  return false;
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
  const rotation = (Number(node.rotation) || 0) * Math.PI / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const flat = (node.projection ?? 'flat') === 'flat';
  if (flat && drawFlatImageRegion(context, imageCanvas, node,
    { left: 0, top: 0, right: size, bottom: size }, size)) return result;
  const sourceContext = imageCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height).data;
  const output = context.createImageData(size, size);
  const target = output.data;
  const write = (index, u, v) => {
    const rotatedU = rotation ? 0.5 + cosine * (u - 0.5) - sine * (v - 0.5) : u;
    const rotatedV = rotation ? 0.5 + sine * (u - 0.5) + cosine * (v - 0.5) : v;
    const rgba = sampleImage(source, imageCanvas.width, imageCanvas.height,
      rotatedU * scale + offsetU, rotatedV * scale + offsetV, interpolation, extension);
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
    const warpInverse = node.projection === 'warp' ?
      warpProjectionInverse(warpProjectionTransform(node, geometry)) : null;
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
      const normals = warpInverse ? null : ids.map((id) => normal ?
        [normal.getX(id), normal.getY(id), normal.getZ(id)] : [0, 0, 1]);
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
        const localPoint = [0, 1, 2].map((axis) =>
          positions.reduce((sum, vertex, corner) => sum + vertex[axis] * weights[corner], 0));
        const coordinates = warpInverse ? warpProjectedUv(localPoint, warpInverse) :
          projectedUv(localPoint.map((value, axis) =>
            (value - min.getComponent(axis)) / (extent.getComponent(axis) || 1)),
          [0, 1, 2].map((axis) => normals.reduce((sum, vertex, corner) =>
            sum + vertex[axis] * weights[corner], 0)), node.projection);
        if (!coordinates) continue;
        const [u, v] = coordinates;
        write(y * size + x, u, v);
      }
    }
  }
  context.putImageData(output, 0, 0);
  return result;
}
