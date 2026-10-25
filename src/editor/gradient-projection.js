import * as THREE from 'three';

// Rasterize the selected material in UV space, while evaluating the gradient in
// screen space. This keeps the projection continuous across UV seams.
export function projectGradient({ mesh, materialIndex, camera, width, height,
  viewportWidth, viewportHeight, start, end, visibleUv = null, selection = null,
  mirrorPlane = null, side = null, includePlane = true, flipScreenX = false }) {
  const geometry = mesh.geometry;
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  if (!uv || !position) return null;
  mesh.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const world = mesh.matrixWorld.elements;
  const view = camera.matrixWorldInverse.elements;
  const projection = camera.projectionMatrix.elements;
  const clip = new Array(16);
  const viewWorld = new Array(16);
  const multiply = (a, b, out) => {
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
  };
  multiply(view, world, viewWorld);
  multiply(projection, viewWorld, clip);
  const values = new Uint8Array(width * height);
  const covered = new Uint8Array(width * height);
  const index = geometry.index;
  const skinnedPosition = mesh.isSkinnedMesh ? new THREE.Vector3() : null;
  const groups = geometry.groups.length ? geometry.groups :
    [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = Math.max(1, dx * dx + dy * dy);
  const vertex = (id) => {
    if (skinnedPosition) mesh.getVertexPosition(id, skinnedPosition);
    const x = skinnedPosition ? skinnedPosition.x : position.getX(id);
    const y = skinnedPosition ? skinnedPosition.y : position.getY(id);
    const z = skinnedPosition ? skinnedPosition.z : position.getZ(id);
    const signedDistance = mirrorPlane ?
      (world[0] * x + world[4] * y + world[8] * z + world[12] - mirrorPlane.point.x) *
        mirrorPlane.normal.x +
      (world[1] * x + world[5] * y + world[9] * z + world[13] - mirrorPlane.point.y) *
        mirrorPlane.normal.y +
      (world[2] * x + world[6] * y + world[10] * z + world[14] - mirrorPlane.point.z) *
        mirrorPlane.normal.z : 0;
    return [clip[0] * x + clip[4] * y + clip[8] * z + clip[12],
      clip[1] * x + clip[5] * y + clip[9] * z + clip[13],
      clip[2] * x + clip[6] * y + clip[10] * z + clip[14],
      clip[3] * x + clip[7] * y + clip[11] * z + clip[15], signedDistance];
  };
  for (const group of groups) {
    if (group.materialIndex !== materialIndex) continue;
    for (let offset = group.start; offset + 2 < group.start + group.count; offset += 3) {
      const ids = [0, 1, 2].map((i) => index ? index.getX(offset + i) : offset + i);
      const u = ids.map((id) => uv.getX(id));
      const v = ids.map((id) => uv.getY(id));
      const p = ids.map(vertex);
      const minU = Math.min(...u), maxU = Math.max(...u);
      const minV = Math.min(...v), maxV = Math.max(...v);
      for (let tileU = Math.floor(minU); tileU <= Math.floor(maxU); tileU++) {
        for (let tileV = Math.floor(minV); tileV <= Math.floor(maxV); tileV++) {
          const left = Math.max(0, Math.floor((minU - tileU) * width));
          const right = Math.min(width - 1, Math.ceil((maxU - tileU) * width));
          const top = Math.max(0, Math.floor((1 - maxV + tileV) * height));
          const bottom = Math.min(height - 1, Math.ceil((1 - minV + tileV) * height));
          if (right < left || bottom < top) continue;
          const determinant = (v[1] - v[2]) * (u[0] - u[2]) +
            (u[2] - u[1]) * (v[0] - v[2]);
          if (Math.abs(determinant) < 1e-12) continue;
          const tolerance = 1e-6;
          for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
            const U = tileU + (x + 0.5) / width;
            const V = tileV + 1 - (y + 0.5) / height;
            const a = ((v[1] - v[2]) * (U - u[2]) + (u[2] - u[1]) * (V - v[2])) / determinant;
            const b = ((v[2] - v[0]) * (U - u[2]) + (u[0] - u[2]) * (V - v[2])) / determinant;
            const c = 1 - a - b;
            if (a < -tolerance || b < -tolerance || c < -tolerance) continue;
            if (side !== null) {
              const distance = a * p[0][4] + b * p[1][4] + c * p[2][4];
              if (side * distance < -1e-7 || (!includePlane &&
                  Math.abs(distance) <= 1e-7)) continue;
            }
            const pixel = y * width + x;
            if (selection && !selection[pixel]) continue;
            const w = a * p[0][3] + b * p[1][3] + c * p[2][3];
            if (w <= 0) continue;
            const sx = ((a * p[0][0] + b * p[1][0] + c * p[2][0]) / w + 1) * 0.5 * viewportWidth;
            const sy = (1 - (a * p[0][1] + b * p[1][1] + c * p[2][1]) / w) * 0.5 * viewportHeight;
            if (sx < 0 || sy < 0 || sx >= viewportWidth || sy >= viewportHeight) continue;
            if (visibleUv && !visibleUv((x + 0.5) / width, (y + 0.5) / height,
              sx, sy)) continue;
            const gradientX = flipScreenX ? viewportWidth - sx : sx;
            values[pixel] = Math.round(Math.max(0, Math.min(1,
              ((gradientX - start.x) * dx + (sy - start.y) * dy) / lengthSquared)) * 255);
            covered[pixel] = 1;
          }
        }
      }
    }
  }
  return { values, covered };
}
