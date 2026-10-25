// Maps texture pixels to mesh faces and joins the two sides of UV seams.
// Built once per material and texture size; pixel colors are read separately per click.
export function surfaceWandTopology(geometry, materialIndex, width, height = width) {
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const faceCount = Math.floor((index?.count ?? uv?.count ?? 0) / 3);
  const owners = new Uint32Array(width * height);
  const adjacent = new Map();
  const portals = new Map();
  const faceParents = new Uint32Array(faceCount);
  for (let face = 0; face < faceCount; face++) faceParents[face] = face;
  if (!uv || !position) return emptyTopology(owners);

  const root = (face) => {
    while (faceParents[face] !== face) {
      faceParents[face] = faceParents[faceParents[face]];
      face = faceParents[face];
    }
    return face;
  };

  const belongs = (face) => !geometry.groups?.length || geometry.groups.some((group) =>
    face * 3 >= group.start && face * 3 + 2 < group.start + group.count &&
    group.materialIndex === materialIndex);
  const edges = new Map();
  const triangles = new Map();
  const vertex = (face, corner) => index ? index.getX(face * 3 + corner) : face * 3 + corner;
  const pointKey = (v) => [position.getX(v), position.getY(v), position.getZ(v)]
    .map((value) => Math.round(value * 100000)).join(',');
  const wrap = (value) => ((value % 1) + 1) % 1;

  for (let face = 0; face < faceCount; face++) {
    if (!belongs(face)) continue;
    const vertices = [0, 1, 2].map((corner) => vertex(face, corner));
    const points = vertices.map((v) => ({ x: uv.getX(v), y: 1 - uv.getY(v) }));
    triangles.set(face, points);
    // UVs outside 0..1 use the same repeat behavior as the material texture.
    const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
    const area = (points[1].x - points[0].x) * (points[2].y - points[0].y) -
      (points[1].y - points[0].y) * (points[2].x - points[0].x);
    if (Math.abs(area) > 1e-12) {
      for (let tileY = Math.ceil(-maxY); tileY <= Math.floor(1 - minY); tileY++) {
        for (let tileX = Math.ceil(-maxX); tileX <= Math.floor(1 - minX); tileX++) {
          const left = Math.max(0, Math.floor((minX + tileX) * width));
          const right = Math.min(width - 1, Math.ceil((maxX + tileX) * width));
          const top = Math.max(0, Math.floor((minY + tileY) * height));
          const bottom = Math.min(height - 1, Math.ceil((maxY + tileY) * height));
          for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
            const px = (x + 0.5) / width - tileX - points[0].x;
            const py = (y + 0.5) / height - tileY - points[0].y;
            const ab = ((points[1].x - points[0].x) * py - (points[1].y - points[0].y) * px) / area;
            const bc = (px * (points[2].y - points[0].y) - py * (points[2].x - points[0].x)) / area;
            const ca = 1 - ab - bc;
            if (ab >= -1e-7 && bc >= -1e-7 && ca >= -1e-7)
              owners[y * width + x] = face + 1;
          }
        }
      }
    }
    for (let side = 0; side < 3; side++) {
      const a = pointKey(vertices[side]), b = pointKey(vertices[(side + 1) % 3]);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ face, a: points[side], b: points[(side + 1) % 3],
        aKey: a, bKey: b });
    }
  }

  const connectPortal = (a, b) => {
    if (a === b || !a || !b) return;
    const from = a - 1, to = b - 1;
    if (!portals.has(from)) portals.set(from, new Set());
    if (!portals.has(to)) portals.set(to, new Set());
    portals.get(from).add(to);
    portals.get(to).add(from);
  };
  const nearestOnFace = (x, y, face) => {
    const px = Math.floor(wrap(x) * width), py = Math.floor(wrap(y) * height);
    for (let radius = 0; radius <= 2; radius++) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const tx = (px + dx + width) % width, ty = (py + dy + height) % height;
        const candidate = ty * width + tx;
        if (owners[candidate] === face + 1) return candidate + 1;
      }
    }
    return 0;
  };
  for (const siblings of edges.values()) {
    for (let i = 0; i < siblings.length; i++) for (let j = i + 1; j < siblings.length; j++) {
      const first = siblings[i], second = siblings[j];
      if (!adjacent.has(first.face)) adjacent.set(first.face, new Set());
      if (!adjacent.has(second.face)) adjacent.set(second.face, new Set());
      adjacent.get(first.face).add(second.face);
      adjacent.get(second.face).add(first.face);
      const secondA = first.aKey === second.aKey ? second.a : second.b;
      const secondB = first.aKey === second.aKey ? second.b : second.a;
      if (Math.hypot((first.a.x - secondA.x) * width,
        (first.a.y - secondA.y) * height) < 0.25 &&
        Math.hypot((first.b.x - secondB.x) * width,
          (first.b.y - secondB.y) * height) < 0.25) {
        faceParents[root(second.face)] = root(first.face);
        continue;
      }
      const firstLength = Math.hypot((first.b.x - first.a.x) * width,
        (first.b.y - first.a.y) * height);
      const secondLength = Math.hypot((secondB.x - secondA.x) * width,
        (secondB.y - secondA.y) * height);
      const samples = Math.max(2, Math.ceil(Math.max(firstLength, secondLength) * 2));
      for (let step = 0; step <= samples; step++) {
        const t = step / samples;
        const sample = (edge, a, b) => {
          const center = triangles.get(edge.face);
          const cx = (center[0].x + center[1].x + center[2].x) / 3;
          const cy = (center[0].y + center[1].y + center[2].y) / 3;
          const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          const dx = (cx - x) * width, dy = (cy - y) * height;
          const distance = Math.hypot(dx, dy) || 1;
          return nearestOnFace(x + dx / distance / width * 0.6,
            y + dy / distance / height * 0.6, edge.face);
        };
        connectPortal(sample(first, first.a, first.b), sample(second, secondA, secondB));
      }
    }
  }
  const portalTiles = new Map();
  for (const pixel of portals.keys()) {
    const x = pixel % width, y = Math.floor(pixel / width);
    const key = `${Math.floor(x / 64)}:${Math.floor(y / 64)}`;
    if (!portalTiles.has(key)) portalTiles.set(key, []);
    portalTiles.get(key).push(pixel);
  }
  return {
    owners, portals, portalTiles,
    islandAt(pixel) { return owners[pixel] ? root(owners[pixel] - 1) + 1 : 0; },
    seed(x, y, face) {
      const candidate = y * width + x;
      if (owners[candidate] && (face == null || owners[candidate] === face + 1)) return candidate;
      return face == null ? -1 : nearestOnFace((x + 0.5) / width,
        (y + 0.5) / height, face) - 1;
    },
    connected(a, b) {
      const first = owners[a], second = owners[b];
      return !!first && !!second && (first === second ||
        adjacent.get(first - 1)?.has(second - 1));
    }
  };
}

function emptyTopology(owners) {
  return { owners, portals: new Map(), portalTiles: new Map(),
    islandAt: () => 0, seed: () => -1, connected: () => false };
}
