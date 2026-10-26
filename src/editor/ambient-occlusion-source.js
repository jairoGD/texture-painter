import * as THREE from 'three';

export function collectAmbientOcclusionGeometry(meshes, targetMesh, targetSlot,
  { selfOcclusionOnly = false } = {}) {
  const positions = [];
  const targetTriangles = [];
  const targetUvs = [];
  const targetNormalKeys = [];
  const normalSums = new Map();
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (const mesh of meshes) {
    if (selfOcclusionOnly && mesh !== targetMesh) continue;
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute('position');
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    const uv = geometry.getAttribute('uv');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const triangleIndex = positions.length / 9;
      const ids = [0, 1, 2].map((corner) => index ?
        index.getX(offset + corner) : offset + corner);
      const corners = [];
      for (const id of ids) {
        if (mesh.getVertexPosition) mesh.getVertexPosition(id, vertex);
        else vertex.fromBufferAttribute(position, id);
        vertex.applyMatrix4(mesh.matrixWorld);
        positions.push(vertex.x, vertex.y, vertex.z);
        if (mesh === targetMesh) corners.push(vertex.clone());
        bounds.expandByPoint(vertex);
      }
      if (mesh === targetMesh) {
        const ab = corners[1].clone().sub(corners[0]);
        const ac = corners[2].clone().sub(corners[0]);
        const faceNormal = ab.cross(ac);
        for (const corner of corners) {
          const key = `${corner.x},${corner.y},${corner.z}`;
          if (!normalSums.has(key)) normalSums.set(key, new THREE.Vector3());
          normalSums.get(key).add(faceNormal);
        }
      }
      if (mesh !== targetMesh || !uv) continue;
      const matchingGroup = geometry.groups.length ? geometry.groups.some((group) =>
        offset >= group.start && offset < group.start + group.count &&
        group.materialIndex === targetSlot) : targetSlot === 0;
      if (!matchingGroup) continue;
      targetTriangles.push(triangleIndex);
      for (let corner = 0; corner < 3; corner++) {
        targetUvs.push(uv.getX(ids[corner]), 1 - uv.getY(ids[corner]));
        const point = corners[corner];
        targetNormalKeys.push(`${point.x},${point.y},${point.z}`);
      }
    }
  }
  if (!targetTriangles.length) throw new Error('Selected material has no UV faces to bake.');
  const targetNormals = [];
  for (const key of targetNormalKeys) {
    const normal = normalSums.get(key).clone().normalize();
    targetNormals.push(normal.x, normal.y, normal.z);
  }
  const diagonal = bounds.getSize(new THREE.Vector3()).length();
  return { positions: new Float32Array(positions),
    targetTriangles: new Uint32Array(targetTriangles),
    targetUvs: new Float32Array(targetUvs),
    targetNormals: new Float32Array(targetNormals), diagonal };
}
