import * as THREE from 'three';
import { strokeWidthAt } from './stroke-profile.js';

function imageSampler(image, antialias) {
  const read = (x, y) => {
    x = Math.max(0, Math.min(image.width - 1, x));
    y = Math.max(0, Math.min(image.height - 1, y));
    const offset = (y * image.width + x) * 4;
    return [image.data[offset], image.data[offset + 1],
      image.data[offset + 2], image.data[offset + 3]];
  };
  return (u, v) => {
    const x = Math.max(0, Math.min(image.width - 1, u * image.width - 0.5));
    const y = Math.max(0, Math.min(image.height - 1, v * image.height - 0.5));
    if (!antialias) return read(Math.round(x), Math.round(y));
    const left = Math.floor(x), top = Math.floor(y);
    const tx = x - left, ty = y - top;
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const [px, py, weight] of [
      [left, top, (1 - tx) * (1 - ty)], [left + 1, top, tx * (1 - ty)],
      [left, top + 1, (1 - tx) * ty], [left + 1, top + 1, tx * ty]
    ]) {
      const color = read(px, py);
      const a = color[3] * weight;
      alpha += a;
      red += color[0] * a;
      green += color[1] * a;
      blue += color[2] * a;
    }
    return alpha ? [red / alpha, green / alpha, blue / alpha, alpha] : null;
  };
}

function simplifyPathSamples(samples, tolerance) {
  if (samples.length < 3) return samples;
  const keep = new Uint8Array(samples.length);
  keep[0] = keep[samples.length - 1] = 1;
  const pending = [[0, samples.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop();
    if (end - start < 2) continue;
    const from = samples[start], to = samples[end];
    const direction = to.point.clone().sub(from.point);
    const squared = direction.lengthSq();
    let worst = -1, worstIndex = -1;
    for (let index = start + 1; index < end; index++) {
      const sample = samples[index];
      const t = squared > 1e-14 ? Math.max(0, Math.min(1,
        sample.point.clone().sub(from.point).dot(direction) / squared)) : 0;
      const projected = from.point.clone().addScaledVector(direction, t);
      const positionError = sample.point.distanceTo(projected) / tolerance;
      const normalError = 1 - sample.normal.dot(from.normal.clone()
        .lerp(to.normal, t).normalize());
      const distanceError = Math.abs(sample.distance -
        (from.distance + t * (to.distance - from.distance))) / tolerance;
      const error = Math.max(positionError, normalError / 0.005, distanceError);
      if (error > worst) { worst = error; worstIndex = index; }
    }
    if (worst > 1) {
      keep[worstIndex] = 1;
      pending.push([start, worstIndex], [worstIndex, end]);
    }
  }
  return samples.filter((_, index) => keep[index]);
}

function surfaceSampler(path, image, options, mirrored = false) {
  const scales = path.triangles.map((triangle) => triangle.worldPerTexel)
    .filter((scale) => scale > 0).sort((a, b) => a - b);
  const scale = scales[Math.floor(scales.length / 2)] || 1e-3;
  const samples = simplifyPathSamples(path.samples, Math.max(1e-6, scale * 0.25));
  const width = Math.max(1, options.size || 1) * scale;
  const largestScale = Math.min(scales.at(-1) || scale, scale * 8);
  const waveReach = options.lineStyle === 'wavy' ? Math.max(0, options.waveHeight || 0) : 0;
  const radius = (Math.max(1, options.size || 1) * 1.5 + waveReach) * largestScale;
  const cellSize = Math.max(radius, path.length / 4096, 1e-5);
  const cells = new Map();
  const bounds = new THREE.Box3();
  for (let index = 1; index < samples.length; index++) {
    const a = samples[index - 1].point, b = samples[index].point;
    bounds.expandByPoint(a);
    const min = a.clone().min(b).addScalar(-radius);
    const max = a.clone().max(b).addScalar(radius);
    const first = min.toArray().map((value) => Math.floor(value / cellSize));
    const last = max.toArray().map((value) => Math.floor(value / cellSize));
    for (let z = first[2]; z <= last[2]; z++)
      for (let y = first[1]; y <= last[1]; y++)
        for (let x = first[0]; x <= last[0]; x++) {
          const key = `${x}:${y}:${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(index);
        }
  }
  bounds.expandByPoint(samples.at(-1).point);
  bounds.expandByScalar(radius);
  const color = options.color || '#ffffff';
  const solid = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) || 0);
  const sampleImage = image ? imageSampler(image, options.antialias) : null;
  const naturalLength = image ? width * image.height / image.width : 1;
  const repeats = image && path.length > 0 ? options.seamlessTexture ?
    Math.max(1, Math.round(path.length / naturalLength)) : path.length / naturalLength : 1;
  return { bounds, samples,
    candidateSegments(box) {
      const first = box.min.clone().addScalar(-radius).toArray()
        .map((value) => Math.floor(value / cellSize));
      const last = box.max.clone().addScalar(radius).toArray()
        .map((value) => Math.floor(value / cellSize));
      const volume = (last[0] - first[0] + 1) * (last[1] - first[1] + 1) *
        (last[2] - first[2] + 1);
      if (volume > 100000) return new Set(samples.slice(1).map((_, index) => index + 1));
      const candidates = new Set();
      for (let z = first[2]; z <= last[2]; z++)
        for (let y = first[1]; y <= last[1]; y++)
          for (let x = first[0]; x <= last[0]; x++)
            for (const index of cells.get(`${x}:${y}:${z}`) || []) candidates.add(index);
      return candidates;
    },
    sample(point, normal, localScale) {
    const candidates = cells.get(`${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}:${Math.floor(point.z / cellSize)}`);
    if (!candidates) return null;
    const maxBand = Math.max(1, options.size || 1) * localScale;
    const reach = maxBand * 0.75 + waveReach * localScale;
    let nearest = null, nearestDistance = reach * reach;
    for (const index of candidates) {
      const from = samples[index - 1], to = samples[index];
      const dx = to.point.x - from.point.x;
      const dy = to.point.y - from.point.y;
      const dz = to.point.z - from.point.z;
      const lengthSquared = dx * dx + dy * dy + dz * dz;
      if (lengthSquared < 1e-14) continue;
      const fx = point.x - from.point.x;
      const fy = point.y - from.point.y;
      const fz = point.z - from.point.z;
      const projected = (fx * dx + fy * dy + fz * dz) / lengthSquared;
      const t = Math.max(0, Math.min(1, projected));
      const rx = fx - t * dx, ry = fy - t * dy, rz = fz - t * dz;
      const distance = rx * rx + ry * ry + rz * rz;
      if (distance >= nearestDistance) continue;
      const nx = from.normal.x + t * (to.normal.x - from.normal.x);
      const ny = from.normal.y + t * (to.normal.y - from.normal.y);
      const nz = from.normal.z + t * (to.normal.z - from.normal.z);
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < 1e-10 ||
          (normal.x * nx + normal.y * ny + normal.z * nz) / normalLength < 0.1)
        continue;
      nearestDistance = distance;
      nearest = { from, to, t, index, projected, dx, dy, dz, lengthSquared,
        nx: nx / normalLength, ny: ny / normalLength, nz: nz / normalLength,
        rx, ry, rz };
    }
    if (!nearest) return null;
    const { from, to, t, index, projected, dx, dy, dz, lengthSquared,
      nx, ny, nz, rx, ry, rz } = nearest;
    if (options.brushProfile === 'square' &&
        ((index === 1 && projected < 0) ||
        (index === samples.length - 1 && projected > 1))) return null;
    const tangentLength = Math.sqrt(lengthSquared);
    const ax = (ny * dz - nz * dy) / tangentLength;
    const ay = (nz * dx - nx * dz) / tangentLength;
    const az = (nx * dy - ny * dx) / tangentLength;
    const acrossLength = Math.hypot(ax, ay, az);
    if (acrossLength < 1e-10) return null;
    // A reflection reverses the handedness of the normal/tangent frame.
    // Keep the image's left and right edges mirrored with the model.
    const signed = (rx * ax + ry * ay + rz * az) /
      acrossLength * (mirrored ? -1 : 1);
    const edge = options.antialias ? localScale * 0.5 : 0;
    const traveled = from.distance + t * (to.distance - from.distance);
    const band = strokeWidthAt(options.size, options.brushProfile,
      options.taperAmount, path.length ? traveled / path.length : 0.5) * localScale;
    const half = band / 2;
    if (options.lineStyle === 'dashed') {
      const dash = Math.max(1, options.dashLength || 1) * scale;
      const gap = Math.max(1, options.dashGap || 1) * scale;
      if (traveled % (dash + gap) > dash) return null;
    }
    let centered = signed;
    if (options.lineStyle === 'wavy') {
      const height = Math.max(0, options.waveHeight || 0) * scale;
      const spacing = Math.max(2, options.waveSpacing || 2) * scale;
      centered -= Math.sin(traveled * Math.PI * 2 / spacing) * height;
    }
    const distance = Math.abs(centered);
    if (distance > half + edge) return null;
    let result;
    if (sampleImage) {
      const u = (options.flipTexture ? -centered : centered) / band + 0.5;
      const phase = (traveled / path.length * repeats) % 1;
      result = sampleImage(u, phase);
      if (!result) return null;
      if (options.seamlessTexture && (phase < 0.06 || phase > 0.94)) {
        const other = sampleImage(u, 1 - phase);
        if (other) {
          const weight = phase < 0.06 ? (0.06 - phase) / 0.12 : (phase - 0.94) / 0.12;
          result = result.map((value, index) => value * (1 - weight) + other[index] * weight);
        }
      }
    } else result = [...solid, 255];
    const inner = half * Math.max(0, Math.min(1, (options.hardness ?? 100) / 100));
    const fade = sampleImage ? Math.max(0, Math.min(1, (half + edge - distance) /
      Math.max(edge, 1e-8))) : distance <= inner ? 1 :
      Math.max(0, Math.min(1, (half + edge - distance) /
        Math.max(half - inner + edge, 1e-8)));
    result[3] *= fade * Math.max(0, Math.min(1, (options.opacity ?? 100) / 100));
    return result[3] > 0 ? result : null;
  } };
}

export function projectSurfaceCurve(path, image, options, width, height, selection = null,
  mirror = null) {
  const samplers = [surfaceSampler(path, image, options)];
  if (mirror) {
    const reflect = (value, direction = false) => {
      const reflected = value.clone();
      const distance = direction ? reflected.dot(mirror.normal) :
        reflected.sub(mirror.point).dot(mirror.normal);
      return value.clone().addScaledVector(mirror.normal, -2 * distance);
    };
    const samples = path.samples.map((sample) => ({ ...sample,
      point: reflect(sample.point), normal: reflect(sample.normal, true) }));
    samplers.push(surfaceSampler({ ...path, samples }, image, options, true));
  }
  const painted = new Map();
  const coverage = options.antialias ? new Map() : null;
  const offsets = options.antialias ? [[0.25, 0.25], [0.75, 0.25],
    [0.25, 0.75], [0.75, 0.75]] : [[0.5, 0.5]];
  for (const triangle of path.triangles) {
    const bbox = new THREE.Box3().setFromPoints(triangle.points);
    if (!samplers.some((sampler) => sampler.bounds.intersectsBox(bbox))) continue;
    const nearby = samplers.map((sampler) => ({ sampler,
      segments: sampler.candidateSegments(bbox) }));
    if (!nearby.some((entry) => entry.segments.size)) continue;
    const u = triangle.uvs.map((uv) => uv.x);
    const v = triangle.uvs.map((uv) => uv.y);
    const determinant = (v[1] - v[2]) * (u[0] - u[2]) +
      (u[2] - u[1]) * (v[0] - v[2]);
    if (Math.abs(determinant) < 1e-12) continue;
    let pathMinU = Infinity, pathMaxU = -Infinity;
    let pathMinV = Infinity, pathMaxV = -Infinity;
    const closest = new THREE.Vector3();
    const barycentric = new THREE.Vector3();
    for (const { sampler, segments } of nearby) for (const index of segments)
      for (const point of [sampler.samples[index - 1].point,
        sampler.samples[index].point]) {
        triangle.face.closestPointToPoint(point, closest);
        THREE.Triangle.getBarycoord(closest, ...triangle.points, barycentric);
        const U = barycentric.x * u[0] + barycentric.y * u[1] + barycentric.z * u[2];
        const V = barycentric.x * v[0] + barycentric.y * v[1] + barycentric.z * v[2];
        pathMinU = Math.min(pathMinU, U);
        pathMaxU = Math.max(pathMaxU, U);
        pathMinV = Math.min(pathMinV, V);
        pathMaxV = Math.max(pathMaxV, V);
      }
    const padding = Math.max(2, (options.size || 1) * 2 +
      (options.lineStyle === 'wavy' ? Math.max(0, options.waveHeight || 0) : 0));
    const paddingU = padding / width;
    const paddingV = padding / height;
    const left = Math.max(0, Math.floor(Math.max(Math.min(...u),
      pathMinU - paddingU) * width));
    const right = Math.min(width - 1, Math.ceil(Math.min(Math.max(...u),
      pathMaxU + paddingU) * width));
    const top = Math.max(0, Math.floor((1 - Math.min(Math.max(...v),
      pathMaxV + paddingV)) * height));
    const bottom = Math.min(height - 1, Math.ceil((1 - Math.max(Math.min(...v),
      pathMinV - paddingV)) * height));
    if (right < left || bottom < top) continue;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const pixel = y * width + x;
      if (selection && !selection[pixel]) continue;
      for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex++) {
        const [ox, oy] = offsets[offsetIndex];
        const U = (x + ox) / width, V = 1 - (y + oy) / height;
        const a = ((v[1] - v[2]) * (U - u[2]) + (u[2] - u[1]) * (V - v[2])) / determinant;
        const b = ((v[2] - v[0]) * (U - u[2]) + (u[0] - u[2]) * (V - v[2])) / determinant;
        const c = 1 - a - b;
        if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
        const point = triangle.points[0].clone().multiplyScalar(a)
          .addScaledVector(triangle.points[1], b)
          .addScaledVector(triangle.points[2], c);
        const normal = triangle.normals[0].clone().multiplyScalar(a)
          .addScaledVector(triangle.normals[1], b)
          .addScaledVector(triangle.normals[2], c).normalize();
        let color = null;
        for (const sampler of samplers) {
          const next = sampler.sample(point, normal, triangle.worldPerTexel);
          if (next && (!color || next[3] > color[3])) color = next;
        }
        if (!color) continue;
        if (!coverage) {
          if (!painted.has(pixel) || painted.get(pixel)[3] < color[3])
            painted.set(pixel, color);
          continue;
        }
        let subpixels = coverage.get(pixel);
        if (!subpixels) {
          subpixels = [null, null, null, null];
          coverage.set(pixel, subpixels);
        }
        if (!subpixels[offsetIndex] || subpixels[offsetIndex][3] < color[3])
          subpixels[offsetIndex] = color;
      }
    }
  }
  if (coverage) for (const [pixel, subpixels] of coverage) {
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const color of subpixels) {
      if (!color) continue;
      alpha += color[3];
      red += color[0] * color[3];
      green += color[1] * color[3];
      blue += color[2] * color[3];
    }
    if (alpha) painted.set(pixel, [red / alpha, green / alpha,
      blue / alpha, alpha / offsets.length]);
  }
  return painted;
}
