import { Float32BufferAttribute } from 'three';

const materialVertices = new WeakMap();
export function clearVertexPaintCache(geometry) { materialVertices.delete(geometry); }

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

export function paintVertexColors(geometry, slotIndex, center, radius,
  kind, options, allowed = null) {
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
  const neighbors = [];
  for (const id of indices) {
    const dx = position.getX(id) - center.x;
    const dy = position.getY(id) - center.y;
    const dz = position.getZ(id) - center.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= size * 2) neighbors.push(id);
    if (distance > size) continue;
    if (allowed && !allowed.has(id)) continue;
    const coverage = distance <= size * hardness ? 1 :
      (size - distance) / Math.max(1e-6, size * (1 - hardness));
    candidates.push({ id, coverage: Math.max(0, coverage) });
  }
  if (!candidates.length) return false;
  const colors = editableColors(geometry);
  const channels = colors.itemSize;
  const original = kind === 'vertexBlur' ? new Map(neighbors.map((id) =>
    [id, [colors.getX(id), colors.getY(id), colors.getZ(id)]])) : null;
  let changed = false;
  for (const { id, coverage } of candidates) {
    const factor = strength * coverage;
    if (!factor) continue;
    const result = target ?? [0, 0, 0];
    if (!target) {
      let total = 0;
      for (const other of neighbors) {
        const distance = Math.hypot(position.getX(other) - position.getX(id),
          position.getY(other) - position.getY(id),
          position.getZ(other) - position.getZ(id));
        if (distance > size) continue;
        const weight = 1 - distance / (size * 1.1);
        total += weight;
        for (let channel = 0; channel < 3; channel++)
          result[channel] += original.get(other)[channel] * weight;
      }
      if (!total) continue;
      for (let channel = 0; channel < 3; channel++) result[channel] /= total;
    }
    for (let channel = 0; channel < 3; channel++) {
      const offset = id * channels + channel;
      const base = original ? original.get(id)[channel] : colors.array[offset];
      const next = base + (result[channel] - base) * factor;
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
