import * as THREE from 'three';

function screenPoint(point, camera, viewport) {
  const projected = point.project(camera);
  return { x: (projected.x + 1) * viewport.width / 2,
    y: (1 - projected.y) * viewport.height / 2 };
}

// A round dab in UV space becomes an ellipse on screen. Measure its diameter
// perpendicular to the visible stroke instead of treating texture pixels as
// screen pixels (which changes with zoom and camera angle).
export function projectedUvStrokeWidth(hit, camera, viewport, resolution, tangent) {
  const uv = hit?.object?.geometry?.getAttribute('uv');
  const position = hit?.object?.geometry?.getAttribute('position');
  const face = hit?.face;
  if (!uv || !position || !face || !resolution) return null;
  const ids = [face.a, face.b, face.c];
  const texels = ids.map((id) => ({ x: uv.getX(id) * resolution,
    y: (1 - uv.getY(id)) * resolution }));
  const screen = ids.map((id) => screenPoint(hit.object.localToWorld(
    new THREE.Vector3().fromBufferAttribute(position, id)), camera, viewport));
  const du1 = texels[1].x - texels[0].x, dv1 = texels[1].y - texels[0].y;
  const du2 = texels[2].x - texels[0].x, dv2 = texels[2].y - texels[0].y;
  const uvDet = du1 * dv2 - du2 * dv1;
  if (Math.abs(uvDet) < 1e-8) return null;
  const sx1 = screen[1].x - screen[0].x, sy1 = screen[1].y - screen[0].y;
  const sx2 = screen[2].x - screen[0].x, sy2 = screen[2].y - screen[0].y;
  const jxx = (sx1 * dv2 - sx2 * dv1) / uvDet;
  const jxy = (sx2 * du1 - sx1 * du2) / uvDet;
  const jyx = (sy1 * dv2 - sy2 * dv1) / uvDet;
  const jyy = (sy2 * du1 - sy1 * du2) / uvDet;
  const determinant = jxx * jyy - jxy * jyx;
  const tangentLength = Math.hypot(tangent.x, tangent.y);
  if (Math.abs(determinant) < 1e-10 || tangentLength < 1e-8) return null;
  const nx = -tangent.y / tangentLength, ny = tangent.x / tangentLength;
  const texelX = (jyy * nx - jxy * ny) / determinant;
  const texelY = (-jyx * nx + jxx * ny) / determinant;
  const width = 1 / Math.hypot(texelX, texelY);
  return Number.isFinite(width) && width > 0 ? width : null;
}

export function projectedSurfaceStrokeWidth(point, normal, tangent, worldWidth,
  camera, viewport) {
  const across = normal.clone().cross(tangent).normalize();
  if (across.lengthSq() < 1e-10) return null;
  const first = screenPoint(point.clone().addScaledVector(across, -worldWidth / 2),
    camera, viewport);
  const last = screenPoint(point.clone().addScaledVector(across, worldWidth / 2),
    camera, viewport);
  const width = Math.hypot(last.x - first.x, last.y - first.y);
  return Number.isFinite(width) && width > 0 ? width : null;
}
