// Size is a fraction of the model's longest dimension. Convert it to screen
// pixels at the touched face so zoom changes the preview, not the world footprint.
export function stampScreenSize(size, modelExtent, camera, point, viewportHeight) {
  if (!point || !camera || !Number.isFinite(viewportHeight)) return 0;
  camera.updateMatrixWorld();
  const worldWidth = Math.max(1, Number(size) || 64) *
    Math.max(1e-6, Number(modelExtent) || 1) / 512;
  const verticalScale = Math.abs(camera.projectionMatrix.elements[5]) * viewportHeight / 2;
  if (camera.isOrthographicCamera) return worldWidth * verticalScale;
  const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
  return depth > 0 ? worldWidth * verticalScale / depth : 0;
}

export function stampPlacement(start, end, image, options = {}) {
  if (!image?.width || !image?.height || !start) return null;
  const baseWidth = Math.max(1, Number(options.size) || 64);
  const dx = (end?.x ?? start.x) - start.x;
  const dy = (end?.y ?? start.y) - start.y;
  const dragLength = Math.hypot(dx, dy);
  const stretching = Boolean(options.stroke) && dragLength >= 2;
  const width = stretching && options.proportionalStroke !== false ?
    Math.max(1, dragLength * image.width / image.height) : baseWidth;
  const height = stretching ? dragLength : width * image.height / image.width;
  const angle = (stretching ? Math.atan2(dy, dx) - Math.PI / 2 : 0) +
    (Number(options.rotation) || 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const center = stretching ? {
    x: start.x - sin * height / 2,
    y: start.y + cos * height / 2
  } : { x: start.x, y: start.y };
  const halfWidth = width / 2, halfHeight = height / 2;
  const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos
  }));
  return { center, width, height, angle, cos, sin, corners,
    bounds: { left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)) } };
}

export function createStampTextureSampler(image, placement, options = {}) {
  if (!image?.data || !placement) return null;
  const { width, height, center, cos, sin } = placement;
  const opacity = Math.max(0, Math.min(1, Number(options.opacity ?? 100) / 100));
  const antialias = options.antialias !== false;
  const read = (x, y) => {
    x = Math.max(0, Math.min(image.width - 1, x));
    y = Math.max(0, Math.min(image.height - 1, y));
    const offset = (y * image.width + x) * 4;
    return [image.data[offset], image.data[offset + 1],
      image.data[offset + 2], image.data[offset + 3]];
  };
  return (x, y) => {
    const dx = x - center.x, dy = y - center.y;
    const u = (dx * cos + dy * sin) / width + 0.5;
    const v = (-dx * sin + dy * cos) / height + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const fx = Math.max(0, Math.min(image.width - 1, u * image.width - 0.5));
    const fy = Math.max(0, Math.min(image.height - 1, v * image.height - 0.5));
    if (!antialias) {
      const color = read(Math.round(fx), Math.round(fy));
      color[3] *= opacity;
      return color[3] > 0 ? color : null;
    }
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const samples = [[ix, iy, (1 - tx) * (1 - ty)],
      [ix + 1, iy, tx * (1 - ty)], [ix, iy + 1, (1 - tx) * ty],
      [ix + 1, iy + 1, tx * ty]];
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (const [px, py, weight] of samples) {
      const color = read(px, py);
      const covered = color[3] * weight;
      alpha += covered;
      red += color[0] * covered;
      green += color[1] * covered;
      blue += color[2] * covered;
    }
    return alpha > 0 && opacity > 0 ?
      [red / alpha, green / alpha, blue / alpha, alpha * opacity] : null;
  };
}
