import { hiddenGeometryFaces } from './face-visibility.js';

const topologyCache = new WeakMap();

function edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function sourceTopology(geometry) {
  const ranges = geometry?.userData?.sourceFaceRanges;
  const vertices = geometry?.userData?.sourceFaceVertices;
  if (!ranges?.length || vertices?.length !== ranges.length) return null;
  const cached = topologyCache.get(geometry);
  if (cached?.ranges === ranges && cached.vertices === vertices) return cached;
  const edges = new Map();
  const faceEdges = [];
  const triangleToFace = [];
  for (let face = 0; face < vertices.length; face++) {
    const polygon = vertices[face];
    faceEdges[face] = polygon.map((vertex, corner) => {
      const key = edgeKey(vertex, polygon[(corner + 1) % polygon.length]);
      const touching = edges.get(key) ?? [];
      touching.push(face);
      edges.set(key, touching);
      return key;
    });
    const [first, count] = ranges[face];
    for (let triangle = first; triangle < first + count; triangle++)
      triangleToFace[triangle] = face;
  }
  const topology = { ranges, vertices, edges, faceEdges, triangleToFace };
  topologyCache.set(geometry, topology);
  return topology;
}

function polygonVisible(topology, face, hidden) {
  if (!hidden?.size) return true;
  const [first, count] = topology.ranges[face];
  for (let triangle = first; triangle < first + count; triangle++)
    if (hidden.has(triangle)) return false;
  return true;
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

// project receives a position in mesh-local coordinates and returns screen pixels.
export function pickFaceLoopEdge(geometry, triangle, point, project, radius = 12) {
  const topology = sourceTopology(geometry);
  const face = topology?.triangleToFace[triangle];
  const positions = geometry?.userData?.sourceVertexPositions;
  if (face === undefined || !positions ||
      topology.vertices[face].length !== 4 ||
      !polygonVisible(topology, face, hiddenGeometryFaces(geometry))) return null;
  const polygon = topology.vertices[face];
  let nearest = null;
  let distance = radius;
  for (let corner = 0; corner < 4; corner++) {
    const a = polygon[corner], b = polygon[(corner + 1) % 4];
    const start = project(positions.slice(a * 3, a * 3 + 3));
    const end = project(positions.slice(b * 3, b * 3 + 3));
    if (!start || !end) continue;
    const candidate = segmentDistance(point, start, end);
    if (candidate <= distance) { distance = candidate; nearest = edgeKey(a, b); }
  }
  return nearest;
}

export function selectFaceLoop(geometry, pickedEdge) {
  const topology = sourceTopology(geometry);
  const touching = topology?.edges.get(pickedEdge);
  if (!touching?.length || touching.length > 2) return new Set();
  const hidden = hiddenGeometryFaces(geometry);
  const selected = new Set();
  for (const start of touching) {
    let face = start;
    let incoming = pickedEdge;
    const visited = new Set();
    while (topology.vertices[face]?.length === 4 &&
        polygonVisible(topology, face, hidden)) {
      const state = `${face}:${incoming}`;
      if (visited.has(state)) break;
      visited.add(state);
      selected.add(face);
      const edges = topology.faceEdges[face];
      const at = edges.indexOf(incoming);
      if (at < 0) break;
      const opposite = edges[(at + 2) % 4];
      const neighbors = topology.edges.get(opposite);
      if (neighbors?.length !== 2) break;
      const next = neighbors[0] === face ? neighbors[1] : neighbors[0];
      if (next === face) break;
      face = next;
      incoming = opposite;
    }
  }
  const triangles = new Set();
  for (const face of selected) {
    const [first, count] = topology.ranges[face];
    for (let triangle = first; triangle < first + count; triangle++)
      triangles.add(triangle);
  }
  return triangles;
}
