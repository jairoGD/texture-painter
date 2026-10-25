// Diffuse the already blurred image across mesh-connected UV seams. The
// browser handles the broad 2D blur; this small graph patch replaces only the
// neighborhood where separate UV islands would interrupt that blur.
export function surfaceSeamBlur(topology, rect, width, height, depth, sample,
  originalAlpha, mask = null, isolate = true) {
  const result = new Map();
  if (!topology?.portalTiles?.size || depth <= 0) return result;
  const reach = Math.min(32, Math.max(4, Math.ceil(depth * 2)));
  const bounds = { left: Math.max(0, rect.left - reach),
    top: Math.max(0, rect.top - reach),
    right: Math.min(width, rect.right + reach),
    bottom: Math.min(height, rect.bottom + reach) };
  const allowed = (id) => !mask || !isolate || !!mask[id];
  const ids = [], distances = [], lookup = new Map();
  const add = (id, distance) => {
    if (lookup.has(id) || !topology.owners[id] || !allowed(id)) return;
    lookup.set(id, ids.length);
    ids.push(id);
    distances.push(distance);
  };
  for (let tileY = Math.floor(bounds.top / 64); tileY <= Math.floor((bounds.bottom - 1) / 64); tileY++)
    for (let tileX = Math.floor(bounds.left / 64); tileX <= Math.floor((bounds.right - 1) / 64); tileX++)
      for (const portal of topology.portalTiles.get(`${tileX}:${tileY}`) ?? []) {
        const x = portal % width, y = Math.floor(portal / width);
        if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom ||
            !allowed(portal)) continue;
        if ([...(topology.portals.get(portal) ?? [])].some(allowed)) add(portal, 0);
      }
  if (!ids.length) return result;
  const neighbours = (id, visit) => {
    const x = id % width, y = Math.floor(id / width);
    if (x > 0 && topology.connected(id, id - 1)) visit(id - 1);
    if (x + 1 < width && topology.connected(id, id + 1)) visit(id + 1);
    if (y > 0 && topology.connected(id, id - width)) visit(id - width);
    if (y + 1 < height && topology.connected(id, id + width)) visit(id + width);
    for (const remote of topology.portals.get(id) ?? []) visit(remote);
  };
  for (let head = 0; head < ids.length; head++) {
    const id = ids[head], nextDistance = distances[head] + 1;
    if (nextDistance > reach) continue;
    neighbours(id, (neighbour) => add(neighbour, nextDistance));
  }
  const count = ids.length;
  const adjacent = new Array(count);
  let current = new Float32Array(count * 4), next = new Float32Array(count * 4);
  const uncorrected = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const list = [];
    neighbours(ids[i], (id) => {
      const other = lookup.get(id);
      if (other !== undefined) list.push(other);
    });
    adjacent[i] = list;
    const color = sample(ids[i]);
    const opacity = Math.max(color[3], originalAlpha(ids[i]));
    current.set([color[0] * opacity / 255, color[1] * opacity / 255,
      color[2] * opacity / 255, opacity], i * 4);
    uncorrected.set([color[0] * color[3] / 255, color[1] * color[3] / 255,
      color[2] * color[3] / 255, color[3]], i * 4);
  }
  const passes = Math.min(72, Math.max(4, Math.ceil(depth * depth / 2)));
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < count; i++) {
      const list = adjacent[i], base = i * 4;
      if (!list.length) { next.set(current.subarray(base, base + 4), base); continue; }
      const weight = 0.75 / list.length;
      for (let channel = 0; channel < 4; channel++) {
        let value = current[base + channel] * 0.25;
        for (const neighbour of list) value += current[neighbour * 4 + channel] * weight;
        next[base + channel] = value;
      }
    }
    [current, next] = [next, current];
  }
  for (let i = 0; i < count; i++) {
    const id = ids[i];
    const x = id % width, y = Math.floor(id / width);
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
    const t = Math.max(0, Math.min(1, (reach - distances[i]) / Math.max(1, reach / 2)));
    const influence = t * t * (3 - 2 * t);
    const base = i * 4;
    const alpha = uncorrected[base + 3] * (1 - influence) + current[base + 3] * influence;
    const color = [0, 1, 2].map((channel) => alpha ? Math.max(0, Math.min(255,
      Math.round((uncorrected[base + channel] * (1 - influence) +
        current[base + channel] * influence) * 255 / alpha))) : 0);
    result.set(id, [...color, Math.round(alpha)]);
  }
  return result;
}
