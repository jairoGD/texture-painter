function clamp(value) { return Math.max(0, Math.min(255, Math.round(value))); }

function rampColor(hex) {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return [0, 0, 0];
  const value = Number.parseInt(match[1], 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}

export function colorRampAt(position, stops, interpolation = 'linear') {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (!sorted.length) return [0, 0, 0];
  if (position <= sorted[0].position) return rampColor(sorted[0].color);
  if (position >= sorted.at(-1).position) return rampColor(sorted.at(-1).color);
  for (let index = 1; index < sorted.length; index++) {
    const next = sorted[index];
    if (position > next.position) continue;
    const previous = sorted[index - 1];
    if (interpolation === 'constant') return rampColor(previous.color);
    const span = next.position - previous.position;
    if (!span) return rampColor(next.color);
    const amount = (position - previous.position) / span;
    const from = rampColor(previous.color), to = rampColor(next.color);
    return from.map((channel, channelIndex) => clamp(channel +
      (to[channelIndex] - channel) * amount));
  }
  return rampColor(sorted.at(-1).color);
}

function colorRampLut(stops, interpolation) {
  const lut = new Uint8Array(256 * 3);
  for (let value = 0; value < 256; value++)
    lut.set(colorRampAt(value / 255, stops, interpolation), value * 3);
  return lut;
}

function hueShift(red, green, blue, degrees) {
  if (!degrees) return [red, green, blue];
  let r = red / 255, g = green / 255, b = blue / 255;
  const highest = Math.max(r, g, b);
  const lowest = Math.min(r, g, b);
  const range = highest - lowest;
  if (!range) return [red, green, blue];
  let hue = highest === r ? ((g - b) / range) % 6 :
    highest === g ? (b - r) / range + 2 : (r - g) / range + 4;
  hue = ((hue * 60 + degrees) % 360 + 360) % 360;
  const chroma = range;
  const second = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = lowest;
  [r, g, b] = hue < 60 ? [chroma, second, 0] : hue < 120 ? [second, chroma, 0] :
    hue < 180 ? [0, chroma, second] : hue < 240 ? [0, second, chroma] :
      hue < 300 ? [second, 0, chroma] : [chroma, 0, second];
  return [clamp((r + match) * 255), clamp((g + match) * 255), clamp((b + match) * 255)];
}

export function adjustRgb(red, green, blue, category, settings) {
  let rgb = [red, green, blue];
  if (category === 'color') {
    rgb = hueShift(...rgb, settings.hue);
    const saturation = settings.saturation / 100;
    const gray = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    rgb = rgb.map((value) => clamp(gray + (value - gray) * saturation));
    if (settings.invert) rgb = rgb.map((value) => 255 - value);
  } else if (category === 'tone') {
    const offset = settings.luminance * 2.55;
    const brightness = settings.brightness / 100;
    const contrast = settings.contrast / 100;
    rgb = rgb.map((value) => clamp(((value + offset) * brightness - 127.5) * contrast + 127.5));
  } else if (category === 'palette' && settings.posterize < 256) {
    const steps = settings.posterize - 1;
    rgb = rgb.map((value) => clamp(Math.round(value * steps / 255) * 255 / steps));
  }
  return rgb;
}

function paletteFromPixels(pixels, mask, dirtyRect, textureWidth, maxColors) {
  const width = dirtyRect.right - dirtyRect.left;
  const height = dirtyRect.bottom - dirtyRect.top;
  const stride = Math.max(1, Math.ceil(width * height / 50000));
  const bins = new Map();
  for (let index = 0; index < width * height; index += stride) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (mask && !mask[(dirtyRect.top + y) * textureWidth + dirtyRect.left + x]) continue;
    const offset = index * 4;
    if (!pixels[offset + 3]) continue;
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    const key = (red >> 3) << 10 | (green >> 3) << 5 | (blue >> 3);
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = { count: 0, red: 0, green: 0, blue: 0,
      r5: red >> 3, g5: green >> 3, b5: blue >> 3 });
    bin.count++;
    bin.red += red;
    bin.green += green;
    bin.blue += blue;
  }
  if (!bins.size) return [];
  const boxes = [[...bins.values()]];
  while (boxes.length < maxColors) {
    let choice = -1;
    let axis = 'r5';
    let best = 0;
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index];
      if (box.length < 2) continue;
      const ranges = ['r5', 'g5', 'b5'].map((key) =>
        Math.max(...box.map((bin) => bin[key])) - Math.min(...box.map((bin) => bin[key])));
      const largest = Math.max(...ranges);
      const score = largest * Math.sqrt(box.reduce((sum, bin) => sum + bin.count, 0));
      if (score > best) { best = score; choice = index; axis = ['r5', 'g5', 'b5'][ranges.indexOf(largest)]; }
    }
    if (choice < 0) break;
    const box = boxes.splice(choice, 1)[0].sort((a, b) => a[axis] - b[axis]);
    const half = box.reduce((sum, bin) => sum + bin.count, 0) / 2;
    let count = 0;
    let split = 1;
    while (split < box.length - 1 && count + box[split - 1].count < half)
      count += box[split++ - 1].count;
    boxes.push(box.slice(0, split), box.slice(split));
  }
  return boxes.map((box) => {
    const count = box.reduce((sum, bin) => sum + bin.count, 0);
    return [
      Math.round(box.reduce((sum, bin) => sum + bin.red, 0) / count),
      Math.round(box.reduce((sum, bin) => sum + bin.green, 0) / count),
      Math.round(box.reduce((sum, bin) => sum + bin.blue, 0) / count)
    ];
  });
}

function reduceColors(pixels, mask, dirtyRect, textureWidth, maxColors) {
  const palette = paletteFromPixels(pixels, mask, dirtyRect, textureWidth, maxColors);
  if (!palette.length) return;
  const width = dirtyRect.right - dirtyRect.left;
  const cache = new Map();
  for (let index = 0; index < pixels.length / 4; index++) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (mask && !mask[(dirtyRect.top + y) * textureWidth + dirtyRect.left + x]) continue;
    const offset = index * 4;
    if (!pixels[offset + 3]) continue;
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    const key = (red >> 3) << 10 | (green >> 3) << 5 | (blue >> 3);
    let chosen = cache.get(key);
    if (!chosen) {
      let distance = Infinity;
      for (const color of palette) {
        const delta = (red - color[0]) ** 2 * 0.3 + (green - color[1]) ** 2 * 0.59 +
          (blue - color[2]) ** 2 * 0.11;
        if (delta < distance) { distance = delta; chosen = color; }
      }
      cache.set(key, chosen);
    }
    pixels[offset] = chosen[0];
    pixels[offset + 1] = chosen[1];
    pixels[offset + 2] = chosen[2];
  }
}

function canvasFromPixels(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  return canvas;
}

function blurredPixels(source, sourceRect, textureWidth, mask, depth, isolate) {
  const pixels = new Uint8ClampedArray(source.data);
  let maskImage = null;
  if (mask && isolate) {
    maskImage = new ImageData(source.width, source.height);
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const index = y * source.width + x;
      const coverage = mask[(sourceRect.top + y) * textureWidth + sourceRect.left + x];
      pixels[index * 4 + 3] = Math.round(pixels[index * 4 + 3] * coverage / 255);
      maskImage.data[index * 4] = 255;
      maskImage.data[index * 4 + 1] = 255;
      maskImage.data[index * 4 + 2] = 255;
      maskImage.data[index * 4 + 3] = coverage;
    }
  }
  const input = canvasFromPixels(new ImageData(pixels, source.width, source.height));
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d');
  context.filter = `blur(${depth}px)`;
  context.drawImage(input, 0, 0);
  const blurred = context.getImageData(0, 0, source.width, source.height).data;
  if (!maskImage) return { pixels: blurred, maskBlur: null };
  const maskInput = canvasFromPixels(maskImage);
  const maskOutput = document.createElement('canvas');
  maskOutput.width = source.width;
  maskOutput.height = source.height;
  const maskContext = maskOutput.getContext('2d');
  maskContext.filter = `blur(${depth}px)`;
  maskContext.drawImage(maskInput, 0, 0);
  return { pixels: blurred,
    maskBlur: maskContext.getImageData(0, 0, source.width, source.height).data };
}

function blendSelection(output, original, mask, rect, textureWidth) {
  if (!mask) return;
  const width = rect.right - rect.left;
  for (let index = 0; index < output.length / 4; index++) {
    const x = index % width;
    const y = Math.floor(index / width);
    const coverage = mask[(rect.top + y) * textureWidth + rect.left + x] / 255;
    const offset = index * 4;
    if (coverage === 1) continue;
    if (!coverage) { output.set(original.subarray(offset, offset + 4), offset); continue; }
    const oldAlpha = original[offset + 3] / 255 * (1 - coverage);
    const newAlpha = output[offset + 3] / 255 * coverage;
    const total = oldAlpha + newAlpha;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = total ?
      clamp((original[offset + channel] * oldAlpha + output[offset + channel] * newAlpha) / total) : 0;
    output[offset + 3] = clamp(total * 255);
  }
}

export function renderFilterRegion({ source, sourceRect, dirtyRect, textureWidth,
  mask = null, category, settings, isolateBlur = true }) {
  const width = dirtyRect.right - dirtyRect.left;
  const height = dirtyRect.bottom - dirtyRect.top;
  const output = new Uint8ClampedArray(width * height * 4);
  const original = new Uint8ClampedArray(output.length);
  const blurred = category === 'blur' && settings.depth > 0 ?
    blurredPixels(source, sourceRect, textureWidth, mask, settings.depth, isolateBlur) : null;
  const working = blurred?.pixels ?? source.data;
  const mosaic = category === 'blur' ? settings.mosaic : 1;
  const rampLut = category === 'ramp' ? colorRampLut(settings.stops, settings.interpolation) : null;
  const blocks = new Map();

  function pixelAt(globalX, globalY) {
    const offset = ((globalY - sourceRect.top) * source.width + globalX - sourceRect.left) * 4;
    const alpha = blurred?.maskBlur ?
      (blurred.maskBlur[offset + 3] ? clamp(working[offset + 3] * 255 /
        blurred.maskBlur[offset + 3]) : 0) : working[offset + 3];
    return [working[offset], working[offset + 1], working[offset + 2], alpha];
  }

  function mosaicPixel(globalX, globalY) {
    const blockX = Math.floor(globalX / mosaic) * mosaic;
    const blockY = Math.floor(globalY / mosaic) * mosaic;
    const key = `${blockX}:${blockY}`;
    let color = blocks.get(key);
    if (color) return color;
    let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
    for (let y = Math.max(blockY, sourceRect.top); y < Math.min(blockY + mosaic, sourceRect.bottom); y++)
      for (let x = Math.max(blockX, sourceRect.left); x < Math.min(blockX + mosaic, sourceRect.right); x++) {
        const pixel = pixelAt(x, y);
        const weight = pixel[3] / 255;
        red += pixel[0] * weight;
        green += pixel[1] * weight;
        blue += pixel[2] * weight;
        alpha += pixel[3];
        count++;
      }
    const averageAlpha = count ? alpha / count : 0;
    const alphaWeight = alpha / 255;
    color = [alphaWeight ? clamp(red / alphaWeight) : 0,
      alphaWeight ? clamp(green / alphaWeight) : 0,
      alphaWeight ? clamp(blue / alphaWeight) : 0, clamp(averageAlpha)];
    blocks.set(key, color);
    return color;
  }

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const globalX = dirtyRect.left + x;
    const globalY = dirtyRect.top + y;
    const sourceOffset = ((globalY - sourceRect.top) * source.width + globalX - sourceRect.left) * 4;
    const target = (y * width + x) * 4;
    original.set(source.data.subarray(sourceOffset, sourceOffset + 4), target);
    if (mask && !mask[globalY * textureWidth + globalX]) {
      output.set(original.subarray(target, target + 4), target);
      continue;
    }
    const pixel = mosaic > 1 ? mosaicPixel(globalX, globalY) : pixelAt(globalX, globalY);
    const luminance = rampLut && pixel[3] ?
      clamp(pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114) : 0;
    const rgb = rampLut ? (pixel[3] ? rampLut.subarray(luminance * 3, luminance * 3 + 3) :
      pixel) : adjustRgb(pixel[0], pixel[1], pixel[2], category, settings);
    output[target] = rgb[0]; output[target + 1] = rgb[1]; output[target + 2] = rgb[2];
    output[target + 3] = pixel[3];
  }
  if (category === 'palette' && settings.colorCount)
    reduceColors(output, mask, dirtyRect, textureWidth, 2 ** (9 - settings.colorCount));
  blendSelection(output, original, mask, dirtyRect, textureWidth);
  return { width, height, data: output };
}
