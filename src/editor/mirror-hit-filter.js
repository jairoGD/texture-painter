export function isDuplicateMirrorHit(hit, mirrored, resolution, geometric = false) {
  if (hit.object !== mirrored.object ||
      hit.face?.materialIndex !== mirrored.face?.materialIndex) return false;
  if (geometric) return hit.faceIndex === mirrored.faceIndex &&
    hit.point.distanceToSquared(mirrored.point) < 1e-12;
  const gap = (a, b) => {
    const difference = Math.abs(a - b) % 1;
    return Math.min(difference, 1 - difference);
  };
  return gap(hit.uv.x, mirrored.uv.x) < 1 / resolution &&
    gap(hit.uv.y, mirrored.uv.y) < 1 / resolution;
}
