import * as THREE from 'three';
import { hiddenGeometryFaces, visibleGeometryFaces } from './face-visibility.js';
import { materialFaces } from './vertex-face-selection.js';

// FBXLoader renders polygons as triangles. These ranges retain the original
// polygon membership without changing positions, UVs, or triangle indices.
export function sourceFaceRange(geometry, triangle) {
  const ranges = geometry?.userData?.sourceFaceRanges;
  if (!ranges?.length || !Number.isInteger(triangle)) return null;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [first, count] = ranges[mid];
    if (triangle < first) high = mid - 1;
    else if (triangle >= first + count) low = mid + 1;
    else return ranges[mid];
  }
  return null;
}

export function expandSourceFaces(geometry, triangles) {
  const result = new Set();
  for (const triangle of triangles) {
    const range = sourceFaceRange(geometry, triangle);
    if (range) for (let face = range[0]; face < range[0] + range[1]; face++)
      result.add(face);
    else result.add(triangle);
  }
  return result;
}

export function bitmapSourceFaces(geometry, slotIndex, triangles) {
  const expanded = expandSourceFaces(geometry, triangles);
  const materialScope = geometry.groups.length ?
    new Set(materialFaces(geometry, slotIndex)) : null;
  const scoped = materialScope ?
    new Set([...expanded].filter((face) => materialScope.has(face))) : expanded;
  return visibleGeometryFaces(geometry, scoped);
}

export function sourcePolygonWireGeometry(geometry) {
  const ranges = geometry?.userData?.sourceFaceRanges;
  if (!ranges?.length) return new THREE.EdgesGeometry(geometry, 1);
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const hidden = hiddenGeometryFaces(geometry);
  const coordinates = (face, corner) => {
    const id = index ? index.getX(face * 3 + corner) : face * 3 + corner;
    return [position.getX(id), position.getY(id), position.getZ(id)];
  };
  const key = (point) => point.join(',');
  const linesByMaterial = new Map();
  const emitted = new Set();
  let materialGroup = 0;
  for (const [first, count] of ranges) {
    const polygonEdges = new Map();
    for (let face = first; face < first + count; face++) {
      if (hidden?.has(face)) continue;
      while (materialGroup + 1 < geometry.groups.length &&
        face * 3 >= geometry.groups[materialGroup].start + geometry.groups[materialGroup].count)
        materialGroup++;
      const group = geometry.groups[materialGroup];
      const materialIndex = group && face * 3 >= group.start &&
        face * 3 < group.start + group.count ? group.materialIndex : 0;
      const vertices = [0, 1, 2].map((corner) => coordinates(face, corner));
      for (let corner = 0; corner < 3; corner++) {
        const a = vertices[corner], b = vertices[(corner + 1) % 3];
        const ak = key(a), bk = key(b);
        if (ak === bk) continue;
        const edgeKey = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
        const edge = polygonEdges.get(edgeKey);
        if (edge) edge.count++;
        else polygonEdges.set(edgeKey, { a, b, count: 1, materialIndex });
      }
    }
    for (const [edgeKey, edge] of polygonEdges) {
      const emissionKey = `${edge.materialIndex}:${edgeKey}`;
      if (edge.count !== 1 || emitted.has(emissionKey)) continue;
      emitted.add(emissionKey);
      const lines = linesByMaterial.get(edge.materialIndex) ?? [];
      lines.push(...edge.a, ...edge.b);
      linesByMaterial.set(edge.materialIndex, lines);
    }
  }
  const result = new THREE.BufferGeometry();
  const lines = [];
  for (const [materialIndex, materialLines] of linesByMaterial) {
    result.addGroup(lines.length / 3, materialLines.length / 3, materialIndex);
    for (const value of materialLines) lines.push(value);
  }
  result.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return result;
}
