import { Float32BufferAttribute } from 'three';

const materialVertices = new WeakMap();
const blurTopology = new WeakMap();
export function clearVertexPaintCache(geometry) {
  materialVertices.delete(geometry);
  blurTopology.delete(geometry);
}

export function materialVertexIndices(geometry, slotIndex) {
  let slots = materialVertices.get(geometry);
  if (!slots) { slots = new Map(); materialVertices.set(geometry, slots); }
  if (slots.has(slotIndex)) return slots.get(slotIndex);
  const index = geometry.index;
  const count = index ? index.count : geometry.getAttribute('position').count;
  const selected = new Set();
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    if (geometry.groups.length ? !geometry.groups.some((group) =>
      triangle >= group.start && triangle < group.start + group.count &&
      group.materialIndex === slotIndex) : slotIndex !== 0) continue;
    for (let corner = 0; corner < 3; corner++)
      selected.add(index ? index.getX(triangle + corner) : triangle + corner);
  }
  const result = Uint32Array.from(selected);
  slots.set(slotIndex, result);
  return result;
}

function editableColors(geometry) {
  const existing = geometry.getAttribute('color');
  if (existing?.array instanceof Float32Array && !existing.normalized) return existing;
  const count = geometry.getAttribute('position').count;
  const channels = existing?.itemSize === 4 ? 4 : 3;
  const values = new Float32Array(count * channels);
  for (let i = 0; i < count; i++) {
    values[i * channels] = existing?.getX(i) ?? 1;
    values[i * channels + 1] = existing?.getY(i) ?? 1;
    values[i * channels + 2] = existing?.getZ(i) ?? 1;
    if (channels === 4) values[i * channels + 3] = existing.getW(i);
  }
  const result = new Float32BufferAttribute(values, channels);
  geometry.setAttribute('color', result);
  return result;
}

function hexToLinear(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [16, 8, 0].map((shift) => {
    const srgb = ((value >> shift) & 255) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
}

function materialBlurTopology(geometry, slotIndex) {
  let slots = blurTopology.get(geometry);
  if (!slots) { slots = new Map(); blurTopology.set(geometry, slots); }
  if (slots.has(slotIndex)) return slots.get(slotIndex);

  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const parent = new Int32Array(position.count);
  for (let id = 0; id < parent.length; id++) parent[id] = id;
  const find = (id) => {
    while (parent[id] !== id) {
      parent[id] = parent[parent[id]];
      id = parent[id];
    }
    return id;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };
  const key = (id) => [position.getX(id), position.getY(id), position.getZ(id)]
    .map((value) => Math.round(value * 1e5)).join(',');
  const keys = new Map();
  const vertexKey = (id) => {
    if (!keys.has(id)) keys.set(id, key(id));
    return keys.get(id);
  };
  const edges = new Map();
  const faces = [];
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    if (geometry.groups.length ? !geometry.groups.some((group) =>
      triangle >= group.start && triangle < group.start + group.count &&
      group.materialIndex === slotIndex) : slotIndex !== 0) continue;
    const face = [0, 1, 2].map((corner) => index ?
      index.getX(triangle + corner) : triangle + corner);
    faces.push({ triangle: triangle / 3, corners: face });
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]],
      [face[2], face[0]]]) {
      const ka = vertexKey(a);
      const kb = vertexKey(b);
      if (ka === kb) continue;
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const previous = edges.get(edgeKey);
      if (previous) {
        union(a, vertexKey(previous[0]) === ka ? previous[0] : previous[1]);
        union(b, vertexKey(previous[1]) === kb ? previous[1] : previous[0]);
      } else edges.set(edgeKey, [a, b]);
    }
  }

  // Blender averages every corner of each face incident to the painted point.
  // Match split UV vertices across a shared geometric edge, but not points that
  // merely occupy the same location on disconnected pieces of geometry.
  const incident = new Map();
  for (const [faceIndex, face] of faces.entries()) {
    for (const root of new Set(face.corners.map(find))) {
      if (!incident.has(root)) incident.set(root, []);
      incident.get(root).push(faceIndex);
    }
  }
  const vertices = new Map();
  for (const id of materialVertexIndices(geometry, slotIndex))
    vertices.set(id, incident.get(find(id)) ?? []);
  const result = { faces, vertices };
  slots.set(slotIndex, result);
  return result;
}

export function paintVertexColors(geometry, slotIndex, center, radius,
  kind, options, allowed = null, selectedFaces = null) {
  const position = geometry.getAttribute('position');
  if (!position || !center) return false;
  if (kind === 'vertexBlur' && !geometry.getAttribute('color')) return false;
  const indices = materialVertexIndices(geometry, slotIndex);
  if (!indices.length) return false;
  const size = Math.max(radius, 1e-6);
  const hardness = Math.max(0, Math.min(1, (options.hardness ?? 100) / 100));
  const strength = Math.max(0, Math.min(1, (kind === 'vertexBlur' ?
    options.strength : options.opacity) / 100));
  const target = kind === 'vertexBrush' ? hexToLinear(options.color) : null;
  const candidates = [];
  for (const id of indices) {
    const dx = position.getX(id) - center.x;
    const dy = position.getY(id) - center.y;
    const dz = position.getZ(id) - center.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > size) continue;
    if (allowed && !allowed.has(id)) continue;
    const coverage = distance <= size * hardness ? 1 :
      (size - distance) / Math.max(1e-6, size * (1 - hardness));
    candidates.push({ id, coverage: Math.max(0, coverage) });
  }
  if (!candidates.length) return false;
  const colors = editableColors(geometry);
  const channels = colors.itemSize;
  const original = kind === 'vertexBlur' ? colors.array.slice() : null;
  const topology = original ? materialBlurTopology(geometry, slotIndex) : null;
  let changed = false;
  for (const { id, coverage } of candidates) {
    const factor = strength * coverage;
    if (!factor) continue;
    const faceIndices = topology?.vertices.get(id);
    if (original && !faceIndices?.length) continue;
    for (let channel = 0; channel < (original ? channels : 3); channel++) {
      const offset = id * channels + channel;
      const base = original ? original[offset] : colors.array[offset];
      let value = target?.[channel];
      if (original) {
        let sum = 0;
        let count = 0;
        for (const faceIndex of faceIndices) {
          const face = topology.faces[faceIndex];
          if (selectedFaces && !selectedFaces.has(face.triangle)) continue;
          for (const other of face.corners) {
            const color = original[other * channels + channel];
            sum += color * color;
            count++;
          }
        }
        if (!count) continue;
        value = Math.sqrt(sum / count);
      }
      const next = base + (value - base) * factor;
      if (Math.abs(next - colors.array[offset]) > 1e-6) changed = true;
      colors.array[offset] = next;
    }
  }
  if (changed) colors.needsUpdate = true;
  return changed;
}

export function fillVertexColors(geometry, slotIndex, options, allowed = null) {
  if (!geometry.getAttribute('position')) return false;
  const ids = materialVertexIndices(geometry, slotIndex);
  if (!ids.length) return false;
  const colors = editableColors(geometry);
  const target = hexToLinear(options.color);
  const factor = Math.max(0, Math.min(1, (options.opacity ?? 100) / 100));
  let changed = false;
  for (const id of ids) {
    if (allowed && !allowed.has(id)) continue;
    for (let channel = 0; channel < 3; channel++) {
      const offset = id * colors.itemSize + channel;
      const next = colors.array[offset] * (1 - factor) + target[channel] * factor;
      if (Math.abs(next - colors.array[offset]) > 1e-6) changed = true;
      colors.array[offset] = next;
    }
  }
  if (changed) colors.needsUpdate = true;
  return changed;
}
