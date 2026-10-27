// Face selection follows geometric edges, including edges split by UV seams.
export function materialFaces(geometry, slotIndex) {
  const position = geometry?.getAttribute('position');
  if (!position) return [];
  const count = geometry.index?.count ?? position.count;
  const faces = [];
  for (let offset = 0; offset + 2 < count; offset += 3) {
    if (geometry.groups.length ? !geometry.groups.some((group) =>
      offset >= group.start && offset < group.start + group.count &&
      group.materialIndex === slotIndex) : slotIndex !== 0) continue;
    faces.push(offset / 3);
  }
  return faces;
}

export function meshFaces(geometry) {
  const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Array.from({ length: Math.floor(count / 3) }, (_, face) => face);
}

export function invertVertexFaces(geometry, slotIndex, selected) {
  return new Set(materialFaces(geometry, slotIndex).filter((face) => !selected.has(face)));
}

export function connectedVertexFaces(geometry, slotIndex, seeds, available = null) {
  const faces = available ?? new Set(slotIndex == null ? meshFaces(geometry) :
    materialFaces(geometry, slotIndex));
  const selected = new Set([...seeds].filter((face) => faces.has(face)));
  if (!selected.size) return selected;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const edges = new Map();
  const vertexKey = (id) => [position.getX(id), position.getY(id), position.getZ(id)]
    .map((value) => Math.round(value * 1e5)).join(',');
  for (const face of faces) {
    const corners = [0, 1, 2].map((corner) => vertexKey(index ?
      index.getX(face * 3 + corner) : face * 3 + corner));
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const touching = edges.get(key) ?? [];
      touching.push(face);
      edges.set(key, touching);
    }
  }
  const neighbors = new Map();
  for (const touching of edges.values()) for (const face of touching) {
    const linked = neighbors.get(face) ?? new Set();
    for (const other of touching) if (other !== face) linked.add(other);
    neighbors.set(face, linked);
  }
  const queue = [...selected];
  for (let offset = 0; offset < queue.length; offset++)
    for (const neighbor of neighbors.get(queue[offset]) ?? [])
      if (!selected.has(neighbor)) {
        selected.add(neighbor);
        queue.push(neighbor);
      }
  return selected;
}

export function resizeVertexFaces(geometry, slotIndex, selected, amount, expand) {
  const faces = slotIndex == null ? meshFaces(geometry) : materialFaces(geometry, slotIndex);
  if (!faces.length || !selected.size || !Number.isInteger(amount) || amount < 1) return new Set(selected);
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const vertexKeys = Array.from({ length: position.count }, (_, id) =>
    [position.getX(id), position.getY(id), position.getZ(id)]
      .map((value) => Math.round(value * 1e5)).join(','));
  const edges = new Map();
  const neighbors = new Map(faces.map((face) => [face, new Set()]));
  const boundary = new Set();
  for (const face of faces) {
    const corners = [0, 1, 2].map((corner) => vertexKeys[index ?
      index.getX(face * 3 + corner) : face * 3 + corner]);
    for (let edge = 0; edge < 3; edge++) {
      const a = corners[edge], b = corners[(edge + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const touching = edges.get(key) ?? [];
      touching.push(face);
      edges.set(key, touching);
    }
  }
  for (const touching of edges.values()) {
    if (touching.length === 1) boundary.add(touching[0]);
    for (const face of touching) for (const other of touching)
      if (face !== other) neighbors.get(face).add(other);
  }
  let result = new Set([...selected].filter((face) => neighbors.has(face)));
  for (let step = 0; step < amount && result.size; step++) {
    const next = new Set(result);
    for (const face of result) {
      if (expand) for (const other of neighbors.get(face)) next.add(other);
      else if (boundary.has(face) || [...neighbors.get(face)].some((other) => !result.has(other)))
        next.delete(face);
    }
    if (next.size === result.size) break;
    result = next;
  }
  return result;
}
