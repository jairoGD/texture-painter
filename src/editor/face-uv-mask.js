export function faceUvTriangle(geometry, faceIndex) {
  const uv = geometry.getAttribute('uv');
  if (!uv || faceIndex < 0) return null;
  const index = geometry.getIndex();
  const first = faceIndex * 3;
  if (first + 2 >= (index?.count ?? uv.count)) return null;
  const points = [];
  for (let corner = 0; corner < 3; corner++) {
    const vertex = index ? index.getX(first + corner) : first + corner;
    points.push({ x: uv.getX(vertex), y: 1 - uv.getY(vertex) });
  }
  return points;
}

export function faceUvMask(geometry, faceIndices, size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.beginPath();
  for (const faceIndex of faceIndices) {
    const points = faceUvTriangle(geometry, faceIndex);
    if (!points) continue;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const cross = (points[1].x - points[0].x) * (points[2].y - points[0].y) -
      (points[1].y - points[0].y) * (points[2].x - points[0].x);
    if (cross < 0) [points[1], points[2]] = [points[2], points[1]];
    for (let offsetY = Math.floor(-maxY); offsetY <= Math.ceil(1 - minY); offsetY++) {
      if (maxY + offsetY <= 0 || minY + offsetY >= 1) continue;
      for (let offsetX = Math.floor(-maxX); offsetX <= Math.ceil(1 - minX); offsetX++) {
        if (maxX + offsetX <= 0 || minX + offsetX >= 1) continue;
        context.moveTo((points[0].x + offsetX) * size,
          (points[0].y + offsetY) * size);
        context.lineTo((points[1].x + offsetX) * size,
          (points[1].y + offsetY) * size);
        context.lineTo((points[2].x + offsetX) * size,
          (points[2].y + offsetY) * size);
        context.closePath();
      }
    }
  }
  context.fill();
  return canvas;
}

