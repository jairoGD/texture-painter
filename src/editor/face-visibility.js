// Keep face indices stable for picking and selection while hiding triangles.
// UVs, vertex colors and every other attribute stay untouched.
const hiddenByGeometry = new WeakMap();

export function hideGeometryFaces(geometry, faces) {
  const position = geometry.getAttribute('position');
  if (!position || geometry.index) return false;
  const count = Math.floor(position.count / 3);
  let state = hiddenByGeometry.get(geometry);
  if (!state) {
    const original = new Float32Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex++) {
      original[vertex * 3] = position.getX(vertex);
      original[vertex * 3 + 1] = position.getY(vertex);
      original[vertex * 3 + 2] = position.getZ(vertex);
    }
    state = { original, hidden: new Set() };
    hiddenByGeometry.set(geometry, state);
  }
  let changed = false;
  for (const face of faces) {
    if (!Number.isInteger(face) || face < 0 || face >= count || state.hidden.has(face)) continue;
    const first = face * 9;
    for (let corner = 1; corner < 3; corner++)
      position.setXYZ(face * 3 + corner,
        state.original[first], state.original[first + 1], state.original[first + 2]);
    state.hidden.add(face);
    changed = true;
  }
  if (changed) position.needsUpdate = true;
  return changed;
}

export function showAllGeometryFaces(geometry) {
  const state = hiddenByGeometry.get(geometry);
  if (!state?.hidden.size) return false;
  const position = geometry.getAttribute('position');
  for (const face of state.hidden) {
    const first = face * 9;
    for (let corner = 0; corner < 3; corner++) {
      const offset = first + corner * 3;
      position.setXYZ(face * 3 + corner, state.original[offset],
        state.original[offset + 1], state.original[offset + 2]);
    }
  }
  position.needsUpdate = true;
  hiddenByGeometry.delete(geometry);
  return true;
}

export function visibleGeometryFaces(geometry, faces) {
  const hidden = hiddenByGeometry.get(geometry)?.hidden;
  return hidden ? new Set([...faces].filter((face) => !hidden.has(face))) : faces;
}

export function invertVisibleGeometryFaces(geometry, faces, selected) {
  return new Set([...visibleGeometryFaces(geometry, faces)]
    .filter((face) => !selected.has(face)));
}
