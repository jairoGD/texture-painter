import * as THREE from 'three';

export function createModelMirror(root, meshes) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const localToRoot = inverseRoot.clone().multiply(mesh.matrixWorld);
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(localToRoot));
  }
  const centerX = bounds.getCenter(new THREE.Vector3()).x;
  const radius = Math.max(new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() / 2, 0.001);
  const planePoint = root.localToWorld(new THREE.Vector3(centerX, 0, 0));
  const planeNormal = new THREE.Vector3(1, 0, 0)
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(root.matrixWorld)).normalize();
  const raycaster = new THREE.Raycaster();
  const offset = radius * 0.05;
  const tolerance = radius * 0.025;

  return (hit) => {
    if (!hit?.point || !hit.face || !hit.uv) return null;
    const signedDistance = hit.point.clone().sub(planePoint).dot(planeNormal);
    if (Math.abs(signedDistance) < radius * 0.0001) return null;
    const reflectedPoint = hit.point.clone().addScaledVector(planeNormal, -2 * signedDistance);
    const normal = hit.face.normal.clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
      .reflect(planeNormal);
    raycaster.set(reflectedPoint.clone().addScaledVector(normal, offset), normal.clone().negate());
    raycaster.far = offset * 2;
    const opposite = raycaster.intersectObjects(meshes, false)
      .filter((candidate) => candidate.uv && candidate.point.distanceTo(reflectedPoint) <= tolerance)
      .sort((a, b) => a.point.distanceToSquared(reflectedPoint) - b.point.distanceToSquared(reflectedPoint))[0];
    return opposite ?? null;
  };
}
