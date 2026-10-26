function triangleBounds(positions) {
  const count = positions.length / 9;
  const bounds = new Float32Array(count * 6);
  const centers = new Float32Array(count * 3);
  for (let triangle = 0; triangle < count; triangle++) {
    const base = triangle * 9, box = triangle * 6;
    for (let axis = 0; axis < 3; axis++) {
      const a = positions[base + axis], b = positions[base + 3 + axis];
      const c = positions[base + 6 + axis];
      bounds[box + axis] = Math.min(a, b, c);
      bounds[box + 3 + axis] = Math.max(a, b, c);
      centers[triangle * 3 + axis] = (a + b + c) / 3;
    }
  }
  return { bounds, centers };
}

function buildTree(positions) {
  const ids = Array.from({ length: positions.length / 9 }, (_, index) => index);
  const { bounds, centers } = triangleBounds(positions);
  const build = (start, end) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const centerMin = [...min], centerMax = [...max];
    for (let index = start; index < end; index++) {
      const id = ids[index], box = id * 6, center = id * 3;
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], bounds[box + axis]);
        max[axis] = Math.max(max[axis], bounds[box + 3 + axis]);
        centerMin[axis] = Math.min(centerMin[axis], centers[center + axis]);
        centerMax[axis] = Math.max(centerMax[axis], centers[center + axis]);
      }
    }
    const node = { min, max, start, end };
    if (end - start <= 8) return node;
    let axis = 0;
    for (let candidate = 1; candidate < 3; candidate++)
      if (centerMax[candidate] - centerMin[candidate] >
          centerMax[axis] - centerMin[axis]) axis = candidate;
    if (centerMax[axis] - centerMin[axis] < 1e-10) return node;
    const sorted = ids.slice(start, end).sort((a, b) =>
      centers[a * 3 + axis] - centers[b * 3 + axis]);
    for (let index = 0; index < sorted.length; index++) ids[start + index] = sorted[index];
    const middle = (start + end) >> 1;
    node.left = build(start, middle);
    node.right = build(middle, end);
    return node;
  };
  return { root: ids.length ? build(0, ids.length) : null, ids };
}

function intersectsBox(node, origin, direction, maximum) {
  let near = 0, far = maximum;
  for (let axis = 0; axis < 3; axis++) {
    const value = direction[axis];
    if (Math.abs(value) < 1e-12) {
      if (origin[axis] < node.min[axis] || origin[axis] > node.max[axis]) return false;
      continue;
    }
    let first = (node.min[axis] - origin[axis]) / value;
    let last = (node.max[axis] - origin[axis]) / value;
    if (first > last) [first, last] = [last, first];
    near = Math.max(near, first);
    far = Math.min(far, last);
    if (near > far) return false;
  }
  return true;
}

function intersectsTriangle(positions, id, origin, direction, maximum) {
  const base = id * 9;
  const ax = positions[base], ay = positions[base + 1], az = positions[base + 2];
  const e1x = positions[base + 3] - ax;
  const e1y = positions[base + 4] - ay;
  const e1z = positions[base + 5] - az;
  const e2x = positions[base + 6] - ax;
  const e2y = positions[base + 7] - ay;
  const e2z = positions[base + 8] - az;
  const px = direction[1] * e2z - direction[2] * e2y;
  const py = direction[2] * e2x - direction[0] * e2z;
  const pz = direction[0] * e2y - direction[1] * e2x;
  const determinant = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(determinant) < 1e-12) return false;
  const inverse = 1 / determinant;
  const tx = origin[0] - ax, ty = origin[1] - ay, tz = origin[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inverse;
  if (v < 0 || u + v > 1) return false;
  const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return distance > 1e-7 && distance < maximum;
}

function isOccluded(tree, positions, origin, direction, maximum, sourceTriangle) {
  const visit = (node) => {
    if (!node || !intersectsBox(node, origin, direction, maximum)) return false;
    if (node.left) return visit(node.left) || visit(node.right);
    for (let index = node.start; index < node.end; index++) {
      const id = tree.ids[index];
      if (id !== sourceTriangle &&
          intersectsTriangle(positions, id, origin, direction, maximum)) return true;
    }
    return false;
  };
  return visit(tree.root);
}

function normalFrame(normal) {
  const guide = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = [guide[1] * normal[2] - guide[2] * normal[1],
    guide[2] * normal[0] - guide[0] * normal[2],
    guide[0] * normal[1] - guide[1] * normal[0]];
  const tangentLength = Math.hypot(...tangent);
  for (let axis = 0; axis < 3; axis++) tangent[axis] /= tangentLength;
  const bitangent = [normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0]];
  return { normal, tangent, bitangent };
}

function faceFrame(positions, triangle) {
  const base = triangle * 9;
  const a = [positions[base], positions[base + 1], positions[base + 2]];
  const b = [positions[base + 3], positions[base + 4], positions[base + 5]];
  const c = [positions[base + 6], positions[base + 7], positions[base + 8]];
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const normal = [ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...normal);
  if (length < 1e-12) return null;
  for (let axis = 0; axis < 3; axis++) normal[axis] /= length;
  return { a, b, c, ...normalFrame(normal) };
}

function randomRotation(x, y) {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

export function createAmbientOcclusionBaker(source, options) {
  const resolution = Math.max(16, Math.min(2048, Math.round(options.resolution)));
  const samples = Math.max(1, Math.min(128, Math.round(options.samples)));
  const strength = Math.max(0, Math.min(1, options.strength / 100));
  const reach = Math.max(1e-5, source.diagonal * options.distance / 100);
  const bias = Math.max(1e-6, source.diagonal * 0.0005);
  const positions = source.positions;
  const targetTriangles = source.targetTriangles;
  const targetUvs = source.targetUvs;
  const targetNormals = options.shadeSmooth ? source.targetNormals : null;
  const tree = buildTree(positions);
  const data = new Uint8ClampedArray(resolution * resolution * 4);
  const filled = new Uint8Array(resolution * resolution);

  function bakeTriangle(index) {
    const triangle = targetTriangles[index];
    const frame = faceFrame(positions, triangle);
    if (!frame) return;
    const uvBase = index * 6;
    const x0 = targetUvs[uvBase] * resolution;
    const y0 = targetUvs[uvBase + 1] * resolution;
    const x1 = targetUvs[uvBase + 2] * resolution;
    const y1 = targetUvs[uvBase + 3] * resolution;
    const x2 = targetUvs[uvBase + 4] * resolution;
    const y2 = targetUvs[uvBase + 5] * resolution;
    const determinant = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(determinant) < 1e-10) return;
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const right = Math.min(resolution - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(resolution - 1, Math.ceil(Math.max(y0, y1, y2)));
    const { a, b, c, normal: faceNormal } = frame;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const pixel = y * resolution + x;
      if (filled[pixel]) continue;
      const px = x + 0.5, py = y + 0.5;
      const wa = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / determinant;
      const wb = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / determinant;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const origin = [0, 1, 2].map((axis) =>
        a[axis] * wa + b[axis] * wb + c[axis] * wc + faceNormal[axis] * bias);
      let rayFrame = frame;
      if (targetNormals?.length >= (index + 1) * 9) {
        const base = index * 9;
        const normal = [0, 1, 2].map((axis) =>
          wa * targetNormals[base + axis] +
          wb * targetNormals[base + 3 + axis] +
          wc * targetNormals[base + 6 + axis]);
        const length = Math.hypot(...normal);
        if (length > 1e-6) {
          for (let axis = 0; axis < 3; axis++) normal[axis] /= length;
          if (normal[0] * faceNormal[0] + normal[1] * faceNormal[1] +
              normal[2] * faceNormal[2] > 0.01) rayFrame = normalFrame(normal);
        }
      }
      const { normal, tangent, bitangent } = rayFrame;
      const rotation = randomRotation(x, y);
      let blocked = 0;
      for (let sample = 0; sample < samples; sample++) {
        const u = (sample + 0.5) / samples;
        const radius = Math.sqrt(u);
        const angle = (rotation + sample * 0.61803398875) * Math.PI * 2;
        const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
        const dz = Math.sqrt(1 - u);
        const direction = [0, 1, 2].map((axis) =>
          tangent[axis] * dx + bitangent[axis] * dy + normal[axis] * dz);
        if (isOccluded(tree, positions, origin, direction, reach, triangle)) blocked++;
      }
      const shade = Math.round(255 * (1 - strength * blocked / samples));
      const offset = pixel * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = shade;
      data[offset + 3] = 255;
      filled[pixel] = 1;
    }
  }

  function finish() {
    // Extend colors outside the UV island so filtered texture samples do not
    // reveal a transparent line along a painted seam.
    let frontier = [];
    for (let pixel = 0; pixel < filled.length; pixel++) if (filled[pixel]) frontier.push(pixel);
    for (let ring = 0; ring < 4 && frontier.length; ring++) {
      const next = [];
      for (const pixel of frontier) {
        const x = pixel % resolution, y = (pixel / resolution) | 0;
        for (const neighbor of [x > 0 ? pixel - 1 : -1,
          x + 1 < resolution ? pixel + 1 : -1,
          y > 0 ? pixel - resolution : -1,
          y + 1 < resolution ? pixel + resolution : -1]) {
          if (neighbor < 0 || filled[neighbor]) continue;
          filled[neighbor] = 1;
          const value = data[pixel * 4];
          const offset = neighbor * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = value;
          data[offset + 3] = 255;
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return { width: resolution, height: resolution, data };
  }

  return { triangleCount: targetTriangles.length, bakeTriangle, finish };
}
