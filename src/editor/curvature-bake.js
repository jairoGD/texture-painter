function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function length(vector) { return Math.hypot(...vector); }

function topology(positions, diagonal, cornerNormals, minimumAngle, markedSharpOnly) {
  const welded = new Map();
  const weldTolerance = Math.max(1e-9, diagonal * 1e-6);
  const vertices = [];
  const neighbors = [];
  const normalSums = [];
  const edges = new Map();
  const faces = [];
  const vertexId = (position) => {
    const key = position.map((value) => Math.round(value / weldTolerance)).join(',');
    if (welded.has(key)) return welded.get(key);
    const id = vertices.length;
    welded.set(key, id);
    vertices.push(position);
    neighbors.push(new Set());
    normalSums.push([0, 0, 0]);
    return id;
  };
  for (let index = 0; index < positions.length / 9; index++) {
    const base = index * 9;
    const points = [0, 1, 2].map((corner) =>
      [positions[base + corner * 3], positions[base + corner * 3 + 1],
        positions[base + corner * 3 + 2]]);
    const ids = points.map(vertexId);
    const ab = subtract(points[1], points[0]);
    const ac = subtract(points[2], points[0]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const area = length(cross);
    const normal = area > 1e-12 ? cross.map((value) => value / area) : [0, 0, 0];
    const center = [0, 1, 2].map((axis) =>
      (points[0][axis] + points[1][axis] + points[2][axis]) / 3);
    const authoredNormals = cornerNormals?.length >= base + 9 ?
      [0, 1, 2].map((corner) => [cornerNormals[base + corner * 3],
        cornerNormals[base + corner * 3 + 1], cornerNormals[base + corner * 3 + 2]]) : null;
    faces.push({ ids, normal, center, authoredNormals });
    if (area < 1e-12) continue;
    for (const id of ids) for (let axis = 0; axis < 3; axis++)
      normalSums[id][axis] += cross[axis];
    for (let corner = 0; corner < 3; corner++) {
      const a = ids[corner], b = ids[(corner + 1) % 3];
      if (a === b) continue;
      neighbors[a].add(b);
      neighbors[b].add(a);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
      edges.get(key).faces.push(index);
    }
  }

  const edgeScores = new Map();
  const sharpness = new Float32Array(vertices.length);
  const normalBreak = (faceA, faceB, edge) => {
    if (!faceA.authoredNormals || !faceB.authoredNormals) return false;
    let difference = 0;
    for (const id of [edge.a, edge.b]) {
      const a = faceA.authoredNormals[faceA.ids.indexOf(id)];
      const b = faceB.authoredNormals[faceB.ids.indexOf(id)];
      if (!a || !b) return false;
      difference += Math.acos(clamp(dot(a, b), -1, 1));
    }
    return difference / 2 >= Math.PI / 180;
  };
  for (const [key, edge] of edges) {
    let signed = 0;
    for (let first = 0; first < edge.faces.length; first++) {
      for (let second = first + 1; second < edge.faces.length; second++) {
        const a = faces[edge.faces[first]], b = faces[edge.faces[second]];
        const angle = Math.acos(clamp(dot(a.normal, b.normal), -1, 1));
        if (angle < minimumAngle || angle < 1e-4) continue;
        if (markedSharpOnly && !normalBreak(a, b, edge)) continue;
        const displacement = subtract(b.center, a.center);
        const side = -(dot(a.normal, displacement) - dot(b.normal, displacement));
        if (Math.abs(side) < 1e-8) continue;
        const candidate = Math.sign(side) * clamp(angle / (Math.PI / 2));
        if (Math.abs(candidate) > Math.abs(signed)) signed = candidate;
      }
    }
    edgeScores.set(key, signed);
    sharpness[edge.a] = Math.max(sharpness[edge.a], Math.abs(signed));
    sharpness[edge.b] = Math.max(sharpness[edge.b], Math.abs(signed));
  }

  const vertexScores = new Float32Array(vertices.length);
  for (let id = 0; id < vertices.length && !markedSharpOnly; id++) {
    const normalLength = length(normalSums[id]);
    if (normalLength < 1e-12 || !neighbors[id].size) continue;
    const normal = normalSums[id].map((value) => value / normalLength);
    let mean = 0;
    for (const other of neighbors[id]) {
      const delta = subtract(vertices[id], vertices[other]);
      const squared = dot(delta, delta);
      if (squared > 1e-12) mean += dot(delta, normal) / squared;
    }
    mean /= neighbors[id].size;
    vertexScores[id] = clamp(mean * diagonal * 0.24, -1, 1) *
      (1 - sharpness[id]);
  }
  return { vertices, faces, edgeScores, vertexScores };
}

function segmentDistance(point, start, end) {
  const direction = subtract(end, start);
  const squared = dot(direction, direction);
  const t = squared > 1e-12 ? clamp(dot(subtract(point, start), direction) / squared) : 0;
  return length(subtract(point, [0, 1, 2].map((axis) => start[axis] + direction[axis] * t)));
}

export function createCurvatureBaker(source, options) {
  const resolution = clamp(Math.round(options.resolution), 16, 2048);
  const width = Math.max(1e-6, source.diagonal * clamp(Number(options.width), 0.1, 20) / 100);
  const strength = clamp(Number(options.strength) / 100);
  const mode = ['convex', 'cavity', 'signed'].includes(options.mode) ? options.mode : 'convex';
  const markedSharpOnly = options.markedSharpOnly === true;
  if (markedSharpOnly && source.cornerNormals?.length !== source.positions.length)
    throw new Error('This model has no vertex normals for detecting sharp edges.');
  const minimumAngle = clamp(Number(options.angle ?? 10), 0, 180) * Math.PI / 180;
  const mesh = topology(source.positions, source.diagonal, source.cornerNormals,
    minimumAngle, markedSharpOnly);
  const data = new Uint8ClampedArray(resolution * resolution * 4);
  const filled = new Uint8Array(resolution * resolution);

  function bakeTriangle(index) {
    const triangle = source.targetTriangles[index];
    const face = mesh.faces[triangle];
    if (!face) return;
    const points = face.ids.map((id) => mesh.vertices[id]);
    const uvBase = index * 6;
    const x0 = source.targetUvs[uvBase] * resolution;
    const y0 = source.targetUvs[uvBase + 1] * resolution;
    const x1 = source.targetUvs[uvBase + 2] * resolution;
    const y1 = source.targetUvs[uvBase + 3] * resolution;
    const x2 = source.targetUvs[uvBase + 4] * resolution;
    const y2 = source.targetUvs[uvBase + 5] * resolution;
    const determinant = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(determinant) < 1e-10) return;
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const right = Math.min(resolution - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(resolution - 1, Math.ceil(Math.max(y0, y1, y2)));
    const scores = [0, 1, 2].map((corner) => {
      const a = face.ids[corner], b = face.ids[(corner + 1) % 3];
      return mesh.edgeScores.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0;
    });
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const pixel = y * resolution + x;
      if (filled[pixel]) continue;
      const px = x + 0.5, py = y + 0.5;
      const wa = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / determinant;
      const wb = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / determinant;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      const weights = [wa, wb, wc];
      const point = [0, 1, 2].map((axis) =>
        points[0][axis] * wa + points[1][axis] * wb + points[2][axis] * wc);
      const smooth = weights.reduce((sum, weight, corner) =>
        sum + weight * mesh.vertexScores[face.ids[corner]], 0);
      let convex = Math.max(0, smooth), cavity = Math.max(0, -smooth);
      for (let corner = 0; corner < 3; corner++) {
        const score = scores[corner];
        if (!score) continue;
        const distance = segmentDistance(point, points[corner], points[(corner + 1) % 3]);
        const influence = Math.exp(-2 * (distance / width) ** 2) * Math.abs(score);
        if (score > 0) convex = Math.max(convex, influence);
        else cavity = Math.max(cavity, influence);
      }
      const shade = mode === 'signed' ?
        Math.round(128 + 127 * strength * (convex - cavity)) :
        Math.round(255 * strength * (mode === 'cavity' ? cavity : convex));
      const offset = pixel * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = shade;
      data[offset + 3] = 255;
      filled[pixel] = 1;
    }
  }

  function finish() {
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
          const offset = neighbor * 4, value = data[pixel * 4];
          data[offset] = data[offset + 1] = data[offset + 2] = value;
          data[offset + 3] = 255;
          next.push(neighbor);
        }
      }
      frontier = next;
    }
    return { width: resolution, height: resolution, data };
  }
  return { triangleCount: source.targetTriangles.length, bakeTriangle, finish };
}
