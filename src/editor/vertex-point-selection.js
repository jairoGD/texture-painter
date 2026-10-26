import { materialVertexIndices } from './vertex-paint.js';
import { materialFaces } from './vertex-face-selection.js';

function vertexTopology(geometry, slotIndex) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const vertexKeys = Array.from({ length: position.count }, (_, id) =>
    [position.getX(id), position.getY(id), position.getZ(id)]
      .map((value) => Math.round(value * 1e5)).join(','));
  const idsByPosition = new Map();
  for (const id of materialVertexIndices(geometry, slotIndex)) {
    const key = vertexKeys[id];
    if (!idsByPosition.has(key)) idsByPosition.set(key, []);
    idsByPosition.get(key).push(id);
  }
  const neighbors = new Map([...idsByPosition.keys()].map((key) => [key, new Set()]));
  const edgeFaces = new Map();
  for (const face of materialFaces(geometry, slotIndex)) {
    const corners = [0, 1, 2].map((corner) => vertexKeys[index ?
      index.getX(face * 3 + corner) : face * 3 + corner]);
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 3];
      if (a === b) continue;
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = edgeFaces.get(key);
      if (entry) entry.count++;
      else edgeFaces.set(key, { a, b, count: 1 });
    }
  }
  const boundary = new Set();
  for (const { a, b, count } of edgeFaces.values())
    if (count === 1) { boundary.add(a); boundary.add(b); }
  return { vertexKeys, idsByPosition, neighbors, boundary };
}

function selectedPositions(selected, vertexKeys, idsByPosition) {
  return new Set([...selected].map((id) => vertexKeys[id])
    .filter((key) => idsByPosition.has(key)));
}

function vertexIds(positions, idsByPosition) {
  return new Set([...positions].flatMap((key) => idsByPosition.get(key) ?? []));
}

export function invertVertexPoints(geometry, slotIndex, selected) {
  const topology = vertexTopology(geometry, slotIndex);
  const chosen = selectedPositions(selected, topology.vertexKeys, topology.idsByPosition);
  return vertexIds(new Set([...topology.idsByPosition.keys()]
    .filter((key) => !chosen.has(key))), topology.idsByPosition);
}

export function resizeVertexPoints(geometry, slotIndex, selected, amount, expand) {
  if (!selected.size || !Number.isInteger(amount) || amount < 1) return new Set(selected);
  const topology = vertexTopology(geometry, slotIndex);
  let chosen = selectedPositions(selected, topology.vertexKeys, topology.idsByPosition);
  for (let step = 0; step < amount && chosen.size; step++) {
    const next = new Set(chosen);
    for (const key of chosen) {
      const neighbors = topology.neighbors.get(key);
      if (expand) for (const other of neighbors) next.add(other);
      else if (topology.boundary.has(key) || [...neighbors].some((other) => !chosen.has(other)))
        next.delete(key);
    }
    if (next.size === chosen.size) break;
    chosen = next;
  }
  return vertexIds(chosen, topology.idsByPosition);
}
