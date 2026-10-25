import * as THREE from 'three';

const vector = () => new THREE.Vector3();

export function surfaceTriangles(mesh, materialIndex, textureWidth, textureHeight) {
  const geometry = mesh.geometry;
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  if (!uv || !position) return [];
  mesh.updateWorldMatrix(true, false);
  const normal = geometry.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const index = geometry.index;
  const groups = geometry.groups.length ? geometry.groups :
    [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
  const triangles = [];
  const local = vector();
  for (const group of groups) {
    if (group.materialIndex !== materialIndex) continue;
    for (let offset = group.start; offset + 2 < group.start + group.count; offset += 3) {
      const ids = [0, 1, 2].map((corner) => index ? index.getX(offset + corner) : offset + corner);
      const points = ids.map((id) => {
        if (mesh.isSkinnedMesh) mesh.getVertexPosition(id, local);
        else local.fromBufferAttribute(position, id);
        return local.clone().applyMatrix4(mesh.matrixWorld);
      });
      const uvs = ids.map((id) => new THREE.Vector2(uv.getX(id), uv.getY(id)));
      const face = new THREE.Triangle(...points);
      const faceNormal = face.getNormal(vector()).normalize();
      const normals = ids.map((id) => normal && !mesh.isSkinnedMesh ?
        new THREE.Vector3().fromBufferAttribute(normal, id).applyMatrix3(normalMatrix).normalize() :
        faceNormal.clone());
      const ratios = [[0, 1], [1, 2], [2, 0]].map(([a, b]) => {
        const texelDistance = Math.hypot((uvs[a].x - uvs[b].x) * textureWidth,
          (uvs[a].y - uvs[b].y) * textureHeight);
        return texelDistance > 1e-6 ? points[a].distanceTo(points[b]) / texelDistance : 0;
      }).filter((value) => value > 0);
      triangles.push({ faceIndex: offset / 3, points, uvs, normals, face,
        center: points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3),
        worldPerTexel: ratios.length ? ratios.reduce((sum, value) => sum + value, 0) /
          ratios.length : 0 });
    }
  }
  return triangles;
}

function faceGraph(triangles) {
  const bounds = new THREE.Box3();
  for (const triangle of triangles) for (const point of triangle.points) bounds.expandByPoint(point);
  const epsilon = Math.max(1e-7, bounds.getSize(vector()).length() * 1e-6);
  const vertexKey = (point) => [point.x, point.y, point.z]
    .map((value) => Math.round(value / epsilon)).join(':');
  const edges = new Map();
  const neighbors = triangles.map(() => []);
  triangles.forEach((triangle, face) => {
    const keys = triangle.points.map(vertexKey);
    triangle.keys = keys;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const edgeKey = [keys[a], keys[b]].sort().join('|');
      if (!edges.has(edgeKey)) edges.set(edgeKey, []);
      for (const other of edges.get(edgeKey)) {
        neighbors[face].push({ face: other.face, keys: [keys[a], keys[b]] });
        neighbors[other.face].push({ face, keys: [keys[a], keys[b]] });
      }
      edges.get(edgeKey).push({ face });
    }
  });
  return neighbors;
}

function routeFaces(triangles, neighbors, start, end) {
  if (start === end) return { faces: [start], crossing: [] };
  const distances = new Float64Array(triangles.length).fill(Infinity);
  const previous = new Int32Array(triangles.length).fill(-1);
  const crossing = new Array(triangles.length);
  const queue = [];
  const push = (entry) => {
    queue.push(entry);
    for (let index = queue.length - 1; index > 0;) {
      const parent = (index - 1) >> 1;
      if (queue[parent][0] <= queue[index][0]) break;
      [queue[parent], queue[index]] = [queue[index], queue[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const first = queue[0];
    const last = queue.pop();
    if (queue.length) {
      queue[0] = last;
      for (let index = 0;;) {
        const left = index * 2 + 1;
        if (left >= queue.length) break;
        const right = left + 1;
        const child = right < queue.length && queue[right][0] < queue[left][0] ? right : left;
        if (queue[index][0] <= queue[child][0]) break;
        [queue[index], queue[child]] = [queue[child], queue[index]];
        index = child;
      }
    }
    return first;
  };
  push([0, start]);
  distances[start] = 0;
  while (queue.length) {
    const [priority, face] = pop();
    const heuristic = triangles[face].center.distanceTo(triangles[end].center);
    if (priority > distances[face] + heuristic + 1e-9) continue;
    if (face === end) break;
    for (const edge of neighbors[face]) {
      const distance = distances[face] +
        triangles[face].center.distanceTo(triangles[edge.face].center);
      if (distance >= distances[edge.face]) continue;
      distances[edge.face] = distance;
      previous[edge.face] = face;
      crossing[edge.face] = edge.keys;
      push([distance + triangles[edge.face].center.distanceTo(triangles[end].center),
        edge.face]);
    }
  }
  if (previous[end] < 0) return null;
  const faces = [];
  for (let face = end; face !== -1; face = previous[face]) faces.push(face);
  faces.reverse();
  return { faces, crossing };
}

function unfoldAdjacent(previous, current, previousLayout, keys) {
    const before = keys.map((key) => previous.keys.indexOf(key));
    const after = keys.map((key) => current.keys.indexOf(key));
    if (before.includes(-1) || after.includes(-1)) return null;
    const p = previousLayout[before[0]];
    const q = previousLayout[before[1]];
    const edge = q.clone().sub(p);
    const edgeLength = edge.length();
    if (edgeLength < 1e-10) return null;
    const third = [0, 1, 2].find((index) => !after.includes(index));
    const previousThird = [0, 1, 2].find((index) => !before.includes(index));
    const fromP = current.points[third].distanceTo(current.points[after[0]]);
    const fromQ = current.points[third].distanceTo(current.points[after[1]]);
    const along = (fromP * fromP + edgeLength * edgeLength - fromQ * fromQ) /
      (2 * edgeLength);
    const height = Math.sqrt(Math.max(0, fromP * fromP - along * along));
    const side = Math.sign(edge.x * (previousLayout[previousThird].y - p.y) -
      edge.y * (previousLayout[previousThird].x - p.x)) || 1;
    const outward = new THREE.Vector2(-edge.y, edge.x).multiplyScalar(-side / edgeLength);
    const thirdPoint = p.clone().addScaledVector(edge, along / edgeLength)
      .addScaledVector(outward, height);
    const layout = [];
    layout[after[0]] = p.clone();
    layout[after[1]] = q.clone();
    layout[third] = thirdPoint;
    return { layout, portal: [p.clone(), q.clone()] };
}

function unfoldRoute(triangles, route, neighbors) {
  const layouts = [];
  const first = triangles[route.faces[0]];
  const a = first.points[0].distanceTo(first.points[1]);
  if (a < 1e-10) return null;
  const b = first.points[0].distanceTo(first.points[2]);
  const c = first.points[1].distanceTo(first.points[2]);
  const x = (b * b + a * a - c * c) / (2 * a);
  layouts.push([new THREE.Vector2(), new THREE.Vector2(a, 0),
    new THREE.Vector2(x, Math.sqrt(Math.max(0, b * b - x * x)))]);
  const portals = [];
  for (let i = 1; i < route.faces.length; i++) {
    const adjacent = unfoldAdjacent(triangles[route.faces[i - 1]],
      triangles[route.faces[i]], layouts[i - 1], route.crossing[route.faces[i]]);
    if (!adjacent) return null;
    layouts.push(adjacent.layout);
    portals.push(adjacent.portal);
  }
  const support = route.faces.map((face, order) =>
    ({ face, layout: layouts[order], order, depth: 0 }));
  const visited = new Set(route.faces);
  for (let index = 0; index < support.length; index++) {
    const parent = support[index];
    if (parent.depth >= 2) continue;
    for (const edge of neighbors[parent.face]) {
      if (visited.has(edge.face)) continue;
      const adjacent = unfoldAdjacent(triangles[parent.face], triangles[edge.face],
        parent.layout, edge.keys);
      if (!adjacent) continue;
      visited.add(edge.face);
      support.push({ face: edge.face, layout: adjacent.layout,
        order: parent.order, depth: parent.depth + 1 });
    }
  }
  for (const entry of support) entry.triangle2D = new THREE.Triangle(
    ...entry.layout.map((corner) => new THREE.Vector3(corner.x, corner.y, 0)));
  return { layouts, portals, support };
}

function weights2D(position, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-14) return null;
  const u = ((b.y - c.y) * (position.x - c.x) +
    (c.x - b.x) * (position.y - c.y)) / denominator;
  const v = ((c.y - a.y) * (position.x - c.x) +
    (a.x - c.x) * (position.y - c.y)) / denominator;
  return [u, v, 1 - u - v];
}

function weighted(values, weights) {
  return values[0].clone().multiplyScalar(weights[0])
    .addScaledVector(values[1], weights[1])
    .addScaledVector(values[2], weights[2]);
}

function anchor2D(anchor, triangle, layout) {
  const barycentric = vector();
  THREE.Triangle.getBarycoord(anchor.point, ...triangle.points, barycentric);
  return weighted(layout, [barycentric.x, barycentric.y, barycentric.z]);
}

function crossings(start, end, portals) {
  if (!portals.length) return [];
  const direction = end.clone().sub(start);
  let previous = -1e-8;
  const direct = [];
  for (const [a, b] of portals) {
    const edge = b.clone().sub(a);
    const denominator = direction.cross(edge);
    if (Math.abs(denominator) < 1e-12) break;
    const relative = a.clone().sub(start);
    const t = relative.cross(edge) / denominator;
    const u = relative.cross(direction) / denominator;
    if (t < previous - 1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) break;
    direct.push(a.clone().addScaledVector(edge, Math.max(0, Math.min(1, u))));
    previous = t;
  }
  if (direct.length === portals.length) return direct;

  // For a bent corridor, relax each portal crossing toward the shortest
  // polyline while constraining it to its shared edge.
  const positions = portals.map(([a, b]) => a.clone().add(b).multiplyScalar(0.5));
  for (let pass = 0; pass < 24; pass++) {
    let movement = 0;
    for (let i = 0; i < portals.length; i++) {
      const [a, b] = portals[i];
      const edge = b.clone().sub(a);
      const before = i ? positions[i - 1] : start;
      const after = i + 1 < portals.length ? positions[i + 1] : end;
      const cost = (t) => {
        const point = a.clone().addScaledVector(edge, t);
        return point.distanceTo(before) + point.distanceTo(after);
      };
      let low = 0, high = 1;
      for (let step = 0; step < 20; step++) {
        const left = low + (high - low) / 3;
        const right = high - (high - low) / 3;
        if (cost(left) < cost(right)) high = right;
        else low = left;
      }
      const next = a.clone().addScaledVector(edge, (low + high) / 2);
      movement = Math.max(movement, next.distanceTo(positions[i]));
      positions[i] = next;
    }
    if (movement < 1e-6) break;
  }
  return positions;
}

function sampleOnFace(position, triangle, layout) {
  const weights = weights2D(position, layout);
  if (!weights) return null;
  return { point: weighted(triangle.points, weights),
    normal: weighted(triangle.normals, weights).normalize(),
    uv: weighted(triangle.uvs, weights), faceIndex: triangle.faceIndex };
}

function surfaceDirection(anchor, direction, triangle, layout) {
  if (direction.lengthSq() < 1e-14) return null;
  const origin = anchor2D(anchor, triangle, layout);
  const tip = anchor2D({ point: anchor.point.clone().add(direction) }, triangle, layout);
  const mapped = tip.sub(origin);
  return mapped.lengthSq() > 1e-14 ? mapped.normalize() : null;
}

function joinedDirection(incoming, outgoing) {
  if (!incoming) return outgoing?.clone() ?? null;
  if (!outgoing) return incoming.clone();
  const combined = incoming.clone().normalize().add(outgoing.clone().normalize());
  return combined.lengthSq() > 1e-10 ? combined.normalize() : outgoing.clone().normalize();
}

function sampleOnRoute(position, segment, triangles, preferred) {
  const { unfolded } = segment;
  let nearest = null, nearestDistance = Infinity;
  let inside = null, insideScore = Infinity;
  const point3D = new THREE.Vector3(position.x, position.y, 0);
  const projected = vector();
  for (const entry of unfolded.support) {
    const layout = entry.layout;
    const weights = weights2D(position, layout);
    if (weights && weights.every((weight) => weight >= -1e-7)) {
      const score = entry.depth * 2 + Math.abs(entry.order - preferred);
      if (score < insideScore) { inside = entry; insideScore = score; }
      if (score === 0) break;
      continue;
    }
    entry.triangle2D.closestPointToPoint(point3D, projected);
    const distance = projected.distanceToSquared(point3D);
    if (distance < nearestDistance - 1e-10 ||
        Math.abs(distance - nearestDistance) < 1e-10 &&
        Math.abs(entry.order - preferred) <
          Math.abs((nearest?.entry.order ?? Infinity) - preferred)) {
      nearestDistance = distance;
      nearest = { entry, position: new THREE.Vector2(projected.x, projected.y) };
    }
  }
  if (inside) return sampleOnFace(position, triangles[inside.face], inside.layout);
  return nearest ? sampleOnFace(nearest.position, triangles[nearest.entry.face],
    nearest.entry.layout) : null;
}

export function buildSurfaceCurvePath(mesh, materialIndex, anchors, width, height) {
  if (anchors.length < 2) return null;
  const triangles = surfaceTriangles(mesh, materialIndex, width, height);
  const faceLookup = new Map(triangles.map((triangle, index) => [triangle.faceIndex, index]));
  const neighbors = faceGraph(triangles);
  const samples = [];
  const segments = [];
  for (let pair = 1; pair < anchors.length; pair++) {
    const from = faceLookup.get(anchors[pair - 1].hit.faceIndex);
    const to = faceLookup.get(anchors[pair].hit.faceIndex);
    if (from === undefined || to === undefined) return null;
    const route = routeFaces(triangles, neighbors, from, to);
    if (!route) return null;
    const faces = route.faces;
    const unfolded = unfoldRoute(triangles, route, neighbors);
    if (!unfolded) return null;
    const start = anchor2D(anchors[pair - 1], triangles[from], unfolded.layouts[0]);
    const end = anchor2D(anchors[pair], triangles[to], unfolded.layouts.at(-1));
    const controls = [start, ...crossings(start, end, unfolded.portals), end];
    const localScale = faces.reduce((sum, index) =>
      sum + triangles[index].worldPerTexel, 0) / faces.length;
    const routeLength = controls.slice(1).reduce((sum, point, index) =>
      sum + point.distanceTo(controls[index]), 0);
    const first = sampleOnFace(controls[1], triangles[faces[0]], unfolded.layouts[0]);
    const last = sampleOnFace(controls.at(-2), triangles[faces.at(-1)],
      unfolded.layouts.at(-1));
    segments.push({ faces, unfolded, controls, localScale, routeLength,
      startDirection: first?.point.clone().sub(anchors[pair - 1].point).normalize(),
      endDirection: anchors[pair].point.clone().sub(last?.point ?? anchors[pair].point)
        .normalize() });
  }
  for (let pair = 0; pair < segments.length; pair++) {
    const segment = segments[pair];
    const { faces, unfolded, controls, localScale, routeLength } = segment;
    const smooth = anchors.length > 2 && routeLength > 1e-8;
    if (smooth) {
      const tangentAt = (anchorIndex, fallback) => {
        if (anchorIndex === 0 || anchorIndex === anchors.length - 1) return fallback;
        const chord = anchors[anchorIndex + 1].point.clone()
          .sub(anchors[anchorIndex - 1].point);
        const length = chord.length();
        if (length < 1e-10) return fallback;
        const face = triangles[faceLookup.get(anchors[anchorIndex].hit.faceIndex)];
        const normal = face.face.getNormal(vector());
        chord.addScaledVector(normal, -chord.dot(normal));
        return chord.length() > length * 0.15 ? chord.normalize() : fallback;
      };
      const incoming = tangentAt(pair, joinedDirection(
        segments[pair - 1]?.endDirection, segment.startDirection));
      const outgoing = tangentAt(pair + 1, joinedDirection(segment.endDirection,
        segments[pair + 1]?.startDirection));
      const startDirection = surfaceDirection(anchors[pair], incoming,
        triangles[faces[0]], unfolded.layouts[0]);
      const endDirection = surfaceDirection(anchors[pair + 1], outgoing,
        triangles[faces.at(-1)], unfolded.layouts.at(-1));
      const handle = routeLength * 0.3;
      const curve = new THREE.CubicBezierCurve(controls[0],
        controls[0].clone().addScaledVector(startDirection ??
          controls.at(-1).clone().sub(controls[0]).normalize(), handle),
        controls.at(-1).clone().addScaledVector(endDirection ??
          controls.at(-1).clone().sub(controls[0]).normalize(), -handle),
        controls.at(-1));
      const controlLength = curve.v0.distanceTo(curve.v1) +
        curve.v1.distanceTo(curve.v2) + curve.v2.distanceTo(curve.v3);
      const steps = Math.max(2, Math.min(8192, Math.ceil(controlLength /
        Math.max(1e-6, localScale * 2))));
      for (let index = pair ? 1 : 0; index <= steps; index++) {
        const t = index / steps;
        const sample = sampleOnRoute(curve.getPoint(t), segment, triangles,
          Math.floor(t * faces.length));
        if (sample && (!samples.length ||
          sample.point.distanceToSquared(samples.at(-1).point) > 1e-14))
          samples.push(sample);
      }
      continue;
    }
    const stepSize = Math.max(1e-6, localScale * 2, routeLength / 8192);
    for (let face = 0; face < faces.length; face++) {
      const fromPoint = controls[face], toPoint = controls[face + 1];
      const steps = Math.max(1, Math.ceil(fromPoint.distanceTo(toPoint) / stepSize));
      for (let index = face > 0 || pair > 0 ? 1 : 0; index <= steps; index++) {
        const position = fromPoint.clone().lerp(toPoint, index / steps);
        const sample = sampleOnFace(position, triangles[faces[face]], unfolded.layouts[face]);
        if (sample && (!samples.length ||
          sample.point.distanceToSquared(samples.at(-1).point) > 1e-14)) samples.push(sample);
      }
    }
  }
  if (samples.length < 2) return null;
  let length = 0;
  for (let index = 1; index < samples.length; index++) {
    length += samples[index - 1].point.distanceTo(samples[index].point);
    samples[index].distance = length;
  }
  samples[0].distance = 0;
  return { triangles, samples, length };
}
