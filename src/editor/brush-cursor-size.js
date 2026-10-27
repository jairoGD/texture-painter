import { Vector3 } from 'three';

function screen(point, camera, viewport) {
  const projected = point.clone().project(camera);
  return { x: (projected.x + 1) * viewport.width / 2,
    y: (1 - projected.y) * viewport.height / 2 };
}

// A texture dab is circular in UV space. Its screen outline can stretch on a
// slanted or distorted face, so the cursor circle preserves its projected area.
export function bitmapBrushDiameter(hit, camera, viewport, resolution, size) {
  const geometry = hit?.object?.geometry;
  const uv = geometry?.getAttribute('uv');
  if (!uv || !hit.face || !resolution) return null;
  const width = typeof resolution === 'number' ? resolution : resolution.width;
  const height = typeof resolution === 'number' ? resolution : resolution.height;
  if (!width || !height) return null;
  const ids = [hit.face.a, hit.face.b, hit.face.c];
  const texels = ids.map((id) => ({ x: uv.getX(id) * width,
    y: (1 - uv.getY(id)) * height }));
  const [first, second, third] = ids.map((id) =>
    hit.object.getVertexPosition(id, new Vector3()).applyMatrix4(hit.object.matrixWorld));
  const du1 = texels[1].x - texels[0].x, dv1 = texels[1].y - texels[0].y;
  const du2 = texels[2].x - texels[0].x, dv2 = texels[2].y - texels[0].y;
  const determinant = du1 * dv2 - du2 * dv1;
  if (Math.abs(determinant) < 1e-8) return null;
  const edge1 = second.sub(first), edge2 = third.sub(first);
  const alongU = edge1.clone().multiplyScalar(dv2)
    .addScaledVector(edge2, -dv1).divideScalar(determinant);
  const alongV = edge2.multiplyScalar(du1)
    .addScaledVector(edge1, -du2).divideScalar(determinant);
  const center = screen(hit.point, camera, viewport);
  const u = screen(hit.point.clone().add(alongU), camera, viewport);
  const v = screen(hit.point.clone().add(alongV), camera, viewport);
  const area = Math.abs((u.x - center.x) * (v.y - center.y) -
    (u.y - center.y) * (v.x - center.x));
  const diameter = Math.max(1, Number(size) || 1) * Math.sqrt(area);
  return Number.isFinite(diameter) && diameter > 0 ? diameter : null;
}

// Match paintVertex's local sphere radius, then measure its projected footprint.
export function vertexBrushDiameter(hit, camera, viewport, size) {
  if (!hit?.point || !hit.object || !camera?.fov) return null;
  const distance = hit.point.distanceTo(camera.position);
  const worldRadius = distance * Math.tan(camera.fov * Math.PI / 360) *
    Math.max(1, Number(size) || 1) / Math.max(1, viewport.height);
  const scale = hit.object.getWorldScale(new Vector3()).length() / Math.sqrt(3);
  const radius = worldRadius / Math.max(1e-6, scale);
  const local = hit.object.worldToLocal(hit.point.clone());
  const center = screen(hit.point, camera, viewport);
  const vectors = [[radius, 0, 0], [0, radius, 0], [0, 0, radius]].map((offset) => {
    const point = hit.object.localToWorld(local.clone().add(new Vector3(...offset)));
    const projected = screen(point, camera, viewport);
    return { x: projected.x - center.x, y: projected.y - center.y };
  });
  const xx = vectors.reduce((sum, vector) => sum + vector.x ** 2, 0);
  const xy = vectors.reduce((sum, vector) => sum + vector.x * vector.y, 0);
  const yy = vectors.reduce((sum, vector) => sum + vector.y ** 2, 0);
  const diameter = 2 * Math.max(0, xx * yy - xy * xy) ** 0.25;
  return Number.isFinite(diameter) && diameter > 0 ? diameter : null;
}
