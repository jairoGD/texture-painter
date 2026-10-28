import { hiddenGeometryFaces } from './face-visibility.js';
import { materialFaces } from './vertex-face-selection.js';

const graphCache = new WeakMap();

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function edgePoint(a, b, centerA, centerB) {
  const u = a.map((value, i) => b[i] - value);
  const v = centerA.map((value, i) => centerB[i] - value);
  const w = a.map((value, i) => value - centerA[i]);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v);
  const denominator = uu * vv - uv * uv;
  const factor = denominator > 1e-12 ?
    Math.max(0, Math.min(1, (uv * dot(v, w) - vv * dot(u, w)) / denominator)) : 0.5;
  return a.map((value, i) => value + factor * u[i]);
}

// Blender's face path cost goes through the common edge and favors a straight
// crossing. The first and last face start/end at their edges, not centers.
function crossingCost(a, b, edge, from, to) {
  const middle = edgePoint(edge.a, edge.b, a.center, b.center);
  const first = middle.map((value, i) => value - a.center[i]);
  const second = middle.map((value, i) => b.center[i] - value);
  const firstLength = Math.hypot(...first), secondLength = Math.hypot(...second);
  const alignment = firstLength && secondLength ?
    Math.min(1, Math.abs(dot(first, second) / (firstLength * secondLength))) : 1;
  const length = (a.id === from ? 0 : firstLength) +
    (b.id === to ? 0 : secondLength);
  return length * (1 + 0.5 * (2 - Math.sqrt(alignment)));
}

function faceGraph(geometry) {
  const cached = graphCache.get(geometry);
  if (cached?.position === geometry.getAttribute('position') &&
      cached.positionVersion === geometry.getAttribute('position')?.version &&
      cached.sourceFaces === geometry.userData.sourceFaceVertices) return cached;
  const position = geometry.getAttribute('position');
  if (!position) return null;
  const sourceFaces = geometry.userData.sourceFaceVertices;
  const sourceRanges = geometry.userData.sourceFaceRanges;
  const sourcePositions = geometry.userData.sourceVertexPositions;
  const source = sourceFaces?.length && sourceRanges?.length === sourceFaces.length &&
    sourcePositions?.length ? true : false;
  const polygons = source ? sourceFaces :
    Array.from({ length: Math.floor((geometry.index?.count ?? position.count) / 3) },
      (_, triangle) => [0, 1, 2].map((corner) => geometry.index ?
        geometry.index.getX(triangle * 3 + corner) : triangle * 3 + corner));
  const pointAt = (id) => source ? sourcePositions.slice(id * 3, id * 3 + 3) :
    [position.getX(id), position.getY(id), position.getZ(id)];
  const nodes = [];
  const triangleToNode = [];
  const edges = new Map();
  for (let id = 0; id < polygons.length; id++) {
    const polygon = polygons[id];
    const points = polygon.map(pointAt);
    const center = [0, 1, 2].map((axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length);
    const [first, count] = source ? sourceRanges[id] : [id, 1];
    const triangles = [];
    for (let triangle = first; triangle < first + count; triangle++) {
      triangles.push(triangle);
      triangleToNode[triangle] = id;
    }
    nodes.push({ id, triangles, center, neighbors: [] });
    for (let corner = 0; corner < polygon.length; corner++) {
      const next = (corner + 1) % polygon.length;
      const a = points[corner], b = points[next];
      const keyA = source ? String(polygon[corner]) : a.map((value) =>
        Math.round(value * 1e5)).join(',');
      const keyB = source ? String(polygon[next]) : b.map((value) =>
        Math.round(value * 1e5)).join(',');
      if (keyA === keyB) continue;
      const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
      const touching = edges.get(key) ?? [];
      touching.push({ id, a, b });
      edges.set(key, touching);
    }
  }
  for (const touching of edges.values()) {
    for (let i = 0; i < touching.length; i++) for (let j = i + 1; j < touching.length; j++) {
      const a = touching[i], b = touching[j];
      if (a.id === b.id) continue;
      nodes[a.id].neighbors.push({ id: b.id, a: a.a, b: a.b });
      nodes[b.id].neighbors.push({ id: a.id, a: a.a, b: a.b });
    }
  }
  const graph = { nodes, triangleToNode, position, positionVersion: position.version,
    sourceFaces };
  graphCache.set(geometry, graph);
  return graph;
}

function heapPush(heap, item) {
  let at = heap.length;
  heap.push(item);
  while (at) {
    const parent = (at - 1) >> 1;
    if (heap[parent].cost <= item.cost) break;
    heap[at] = heap[parent];
    at = parent;
  }
  heap[at] = item;
}

function heapPop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length) {
    let at = 0;
    while (at * 2 + 1 < heap.length) {
      let child = at * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost)
        child++;
      if (last.cost <= heap[child].cost) break;
      heap[at] = heap[child];
      at = child;
    }
    heap[at] = last;
  }
  return first;
}

export function shortestFacePath(geometry, fromTriangle, toTriangle, slotIndex = null) {
  const graph = faceGraph(geometry);
  const from = graph?.triangleToNode[fromTriangle];
  const to = graph?.triangleToNode[toTriangle];
  if (from === undefined || to === undefined) return null;
  const hidden = hiddenGeometryFaces(geometry);
  const material = slotIndex === null ? null : new Set(materialFaces(geometry, slotIndex));
  const eligible = (node) => node.triangles.every((triangle) =>
    !hidden?.has(triangle) && (!material || material.has(triangle)));
  if (!eligible(graph.nodes[from]) || !eligible(graph.nodes[to])) return null;
  const costs = new Float64Array(graph.nodes.length).fill(Infinity);
  const previous = new Int32Array(graph.nodes.length).fill(-1);
  const heap = [];
  costs[from] = 0;
  heapPush(heap, { id: from, cost: 0 });
  while (heap.length) {
    const current = heapPop(heap);
    if (current.cost !== costs[current.id]) continue;
    if (current.id === to) break;
    const node = graph.nodes[current.id];
    for (const edge of node.neighbors) {
      const next = graph.nodes[edge.id];
      if (!eligible(next)) continue;
      const cost = current.cost + crossingCost(node, next, edge, from, to);
      if (cost >= costs[next.id]) continue;
      costs[next.id] = cost;
      previous[next.id] = node.id;
      heapPush(heap, { id: next.id, cost });
    }
  }
  if (!Number.isFinite(costs[to])) return null;
  const result = new Set();
  for (let at = to; at !== -1; at = previous[at])
    for (const triangle of graph.nodes[at].triangles) result.add(triangle);
  return result;
}
