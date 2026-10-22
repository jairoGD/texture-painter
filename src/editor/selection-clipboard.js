export function copySelectedPixels(image, selection) {
  const pixels = new Uint8ClampedArray(image.data.length);
  for (const index of selection.indices) {
    const offset = index * 4;
    pixels.set(image.data.subarray(offset, offset + 4), offset);
  }
  return { image: { width: image.width, height: image.height, data: pixels },
    alpha: selection.alpha.slice(), indices: Uint32Array.from(selection.indices),
    parts: selection.parts?.map((part) => ({ alpha: part.alpha.slice(),
      indices: Uint32Array.from(part.indices) })) ?? null };
}

export function blendSelectedPixel(destination, targetIndex, source, sourceIndex, coverage) {
  const from = sourceIndex * 4;
  const to = targetIndex * 4;
  const sourceAlpha = source[from + 3] / 255 * coverage;
  if (!sourceAlpha) return;
  const destinationAlpha = destination[to + 3] / 255;
  const remaining = destinationAlpha * (1 - sourceAlpha);
  const alpha = sourceAlpha + remaining;
  for (let channel = 0; channel < 3; channel++)
    destination[to + channel] = (source[from + channel] * sourceAlpha +
      destination[to + channel] * remaining) / alpha;
  destination[to + 3] = Math.round(alpha * 255);
}

export function pasteSelectedPixels(background, copied) {
  const output = new Uint8ClampedArray(background.data);
  for (const index of copied.indices)
    blendSelectedPixel(output, index, copied.image.data, index, copied.alpha[index] / 255);
  return output;
}

export function cutSelectedPixels(image, selection) {
  const output = new Uint8ClampedArray(image.data);
  for (const index of selection.indices) {
    const pixel = index * 4;
    output[pixel + 3] = Math.round(output[pixel + 3] * (1 - selection.alpha[index] / 255));
    if (!output[pixel + 3]) output.fill(0, pixel, pixel + 4);
  }
  return output;
}
