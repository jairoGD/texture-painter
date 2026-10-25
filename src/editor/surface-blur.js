// Adds the missing half of a blur kernel at a UV seam. Each portal links
// texels on the two sides of the same mesh edge; unrelated UV islands are
// excluded using the connected chart id from the topology.
export function seamBlurCorrections(topology, rect, width, height, sigma, sample,
  mask = null) {
  const result = new Map();
  if (!topology?.portalTiles?.size || sigma <= 0) return result;
  const reach = Math.ceil(sigma * 3);
  const leftTile = Math.max(0, Math.floor((rect.left - reach) / 64));
  const rightTile = Math.min(Math.ceil(width / 64) - 1,
    Math.floor((rect.right - 1 + reach) / 64));
  const topTile = Math.max(0, Math.floor((rect.top - reach) / 64));
  const bottomTile = Math.min(Math.ceil(height / 64) - 1,
    Math.floor((rect.bottom - 1 + reach) / 64));
  const gaussian = Array.from({ length: reach * reach + 1 }, (_, squared) =>
    Math.exp(-squared / (2 * sigma * sigma)));
  for (let tileY = topTile; tileY <= bottomTile; tileY++)
    for (let tileX = leftTile; tileX <= rightTile; tileX++)
      for (const portal of topology.portalTiles.get(`${tileX}:${tileY}`) ?? []) {
        const px = portal % width, py = Math.floor(portal / width);
        if (px < rect.left - reach || px >= rect.right + reach ||
            py < rect.top - reach || py >= rect.bottom + reach) continue;
        const island = topology.islandAt(portal);
        if (!island) continue;
        for (const remote of topology.portals.get(portal) ?? []) {
          const coverage = mask ? mask[remote] / 255 : 1;
          if (!coverage) continue;
          const color = sample(remote);
          if (!color) continue;
          const alpha = color[3] / 255;
          for (let y = Math.max(rect.top, py - reach); y < Math.min(rect.bottom, py + reach + 1); y++)
            for (let x = Math.max(rect.left, px - reach); x < Math.min(rect.right, px + reach + 1); x++) {
              const squared = (x - px) ** 2 + (y - py) ** 2;
              if (squared > reach * reach) continue;
              const pixel = y * width + x;
              if (topology.islandAt(pixel) !== island) continue;
              const weight = gaussian[squared] * coverage;
              let correction = result.get(pixel);
              if (!correction) result.set(pixel, correction = {
                red: 0, green: 0, blue: 0, alpha: 0, weight: 0, nearest: squared,
                sigmaSquared: sigma * sigma
              });
              correction.red += color[0] * alpha * weight;
              correction.green += color[1] * alpha * weight;
              correction.blue += color[2] * alpha * weight;
              correction.alpha += color[3] * weight;
              correction.weight += weight;
              correction.nearest = Math.min(correction.nearest, squared);
            }
        }
      }
  return result;
}

export function mixSeamBlur(pixel, correction, originalAlpha = 0) {
  if (!correction?.weight) return pixel;
  const influence = 0.5 * Math.exp(-correction.nearest /
    (2 * correction.sigmaSquared));
  const remoteAlpha = correction.alpha / correction.weight;
  const blendedAlpha = pixel[3] * (1 - influence) + remoteAlpha * influence;
  const nextAlpha = Math.max(originalAlpha, blendedAlpha);
  const colors = ['red', 'green', 'blue'].map((channel, index) => blendedAlpha ?
    Math.round((pixel[index] * pixel[3] / 255 * (1 - influence) +
      correction[channel] / correction.weight * influence) * 255 / blendedAlpha) : 0);
  return [...colors, Math.round(nextAlpha)];
}

export function canvasPixelSampler(context, width, height, tileSize = 64) {
  const tiles = new Map();
  return (pixel) => {
    const x = pixel % width, y = Math.floor(pixel / width);
    const left = Math.floor(x / tileSize) * tileSize;
    const top = Math.floor(y / tileSize) * tileSize;
    const key = `${left}:${top}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = context.getImageData(left, top, Math.min(tileSize, width - left),
        Math.min(tileSize, height - top));
      tiles.set(key, tile);
    }
    const offset = ((y - top) * tile.width + x - left) * 4;
    return tile.data.subarray(offset, offset + 4);
  };
}
