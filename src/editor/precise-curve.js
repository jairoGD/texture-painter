import * as THREE from 'three';

// Keep anchors in model space so the guide stays on the same 3D points when
// the view changes. Painting raycasts this projected spline back onto the mesh.
export function preciseCurveScreenPoints(points, camera, rect, spacing = 2) {
  if (points.length < 2) return [];
  const positions = points.map((point) => point.point ?? point);
  const curve = positions.length > 2 ? new THREE.CatmullRomCurve3(positions,
    false, 'centripetal') : null;
  const projected = positions.map((point) => point.clone().project(camera));
  const screenLength = projected.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot((point.x - projected[index].x) * rect.width / 2,
      (point.y - projected[index].y) * rect.height / 2), 0);
  const steps = Math.max(1, Math.min(4096, Math.ceil(screenLength / spacing)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const world = curve ? curve.getPoint(t) : positions[0].clone().lerp(positions[1], t);
    const view = world.project(camera);
    return { x: rect.left + (view.x + 1) * rect.width / 2,
      y: rect.top + (1 - view.y) * rect.height / 2 };
  });
}
