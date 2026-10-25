import { bakeImageToUv, drawFlatImageRegion } from './image-projection.js';

export const NODE_TYPES = {
  color: { title: 'Solid Color', inputs: [], outputs: ['Color'] },
  invert: { title: 'Invert', inputs: ['Color'], outputs: ['Color'] },
  blend: { title: 'Mix', inputs: ['A', 'B', 'Factor'], outputs: ['Result'] },
  layerMask: { title: 'Layer Mask', inputs: ['Base', 'Mask'], outputs: ['Factor'] },
  image: { title: 'Image', inputs: [], outputs: ['Color', 'Alpha'] },
  output: { title: 'Texture Output', inputs: ['Color'], outputs: [], fixed: true }
};

export const BLEND_MODES = [
  ['mix', 'Mix'], ['darken', 'Darken'], ['multiply', 'Multiply'], ['colorBurn', 'Color Burn'],
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['colorDodge', 'Color Dodge'], ['add', 'Add'],
  ['overlay', 'Overlay'], ['softLight', 'Soft Light'], ['linearLight', 'Linear Light'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['subtract', 'Subtract'],
  ['divide', 'Divide'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
  ['value', 'Value']
];

const CANVAS_BLEND_MODES = {
  darken: 'darken', multiply: 'multiply', colorBurn: 'color-burn',
  lighten: 'lighten', screen: 'screen', colorDodge: 'color-dodge', add: 'lighter',
  overlay: 'overlay', softLight: 'soft-light', difference: 'difference',
  exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color'
};

export function createTextureGraph() {
  return {
    version: 1,
    nodes: [{ id: 'output', type: 'output', x: 540, y: 90 }],
    links: []
  };
}

export function cloneTextureGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

export function layerVisibleInHierarchy(node, nodes) {
  const visited = new Set();
  while (node?.layerSourceId) {
    if (node.layerVisible === false || visited.has(node.id)) return false;
    visited.add(node.id);
    node = nodes.get(node.layerParentId);
  }
  return true;
}

export function addTextureNode(graph, type, position) {
  if (!NODE_TYPES[type] || NODE_TYPES[type].fixed) return null;
  const node = {
    id: `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type, x: Math.round(position.x), y: Math.round(position.y)
  };
  if (type === 'color') node.color = '#2f80ed';
  if (type === 'blend') Object.assign(node, {
    mode: 'mix', factor: 0.5, colorA: '#ffffff', colorB: '#2f80ed'
  });
  if (type === 'image') Object.assign(node, {
    imageKey: null, imageName: '', interpolation: 'linear', projection: 'flat',
    extension: 'repeat', scale: 1, offsetU: 0, offsetV: 0
  });
  graph.nodes.push(node);
  return node;
}

export function connectTextureNodes(graph, from, fromSocket, to, toSocket) {
  const source = graph.nodes.find((node) => node.id === from);
  const target = graph.nodes.find((node) => node.id === to);
  if (!source || !target || from === to ||
      !NODE_TYPES[source.type]?.outputs.includes(fromSocket) ||
      !NODE_TYPES[target.type]?.inputs.includes(toSocket)) return false;
  const links = graph.links.filter((link) => !(link.to === to && link.toSocket === toSocket));
  if (links.some((link) => link.from === from && link.to === to && link.toSocket === toSocket)) return false;
  const visited = new Set();
  const pending = [to];
  while (pending.length) {
    const id = pending.pop();
    if (id === from) return false;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...links.filter((link) => link.from === id).map((link) => link.to));
  }
  graph.links = links;
  graph.links.push({ from, fromSocket, to, toSocket });
  return true;
}

export function removeTextureNode(graph, id) {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node || NODE_TYPES[node.type].fixed) return false;
  graph.nodes = graph.nodes.filter((item) => item.id !== id);
  graph.links = graph.links.filter((link) => link.from !== id && link.to !== id);
  return true;
}

function newCanvas(size, height = size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  return canvas;
}

function solidCanvas(size, color, height = size) {
  const canvas = newCanvas(size, height);
  const context = canvas.getContext('2d');
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
  context.fillRect(0, 0, size, height);
  return canvas;
}

export function invertCanvas(source, size, height = size) {
  if (!source) return null;
  const canvas = newCanvas(size, height);
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, size, height);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    pixels.data[offset] = 255 - pixels.data[offset];
    pixels.data[offset + 1] = 255 - pixels.data[offset + 1];
    pixels.data[offset + 2] = 255 - pixels.data[offset + 2];
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function rgbToHsv([r, g, b]) {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue / 6 + 1) % 1;
  }
  return [hue, maximum ? delta / maximum : 0, maximum];
}

function hsvToRgb([h, s, v]) {
  const sector = h * 6;
  const chroma = v * s;
  const second = chroma * (1 - Math.abs(sector % 2 - 1));
  const offset = v - chroma;
  const colors = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] :
    sector < 3 ? [0, chroma, second] : sector < 4 ? [0, second, chroma] :
      sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return colors.map((channel) => channel + offset);
}

export function blendRgb(a, b, mode) {
  if (['hue', 'saturation', 'color', 'value'].includes(mode)) {
    const base = rgbToHsv(a);
    const top = rgbToHsv(b);
    if (mode === 'hue' || mode === 'color') base[0] = top[0];
    if (mode === 'saturation' || mode === 'color') base[1] = top[1];
    if (mode === 'value') base[2] = top[2];
    return hsvToRgb(base);
  }
  return a.map((base, index) => {
    const top = b[index];
    switch (mode) {
      case 'darken': return Math.min(base, top);
      case 'multiply': return base * top;
      case 'colorBurn': return top === 0 ? 0 : 1 - Math.min(1, (1 - base) / top);
      case 'lighten': return Math.max(base, top);
      case 'screen': return 1 - (1 - base) * (1 - top);
      case 'colorDodge': return top === 1 ? 1 : Math.min(1, base / (1 - top));
      case 'add': return Math.min(1, base + top);
      case 'overlay': return base < 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
      case 'softLight': return top < 0.5 ? base - (1 - 2 * top) * base * (1 - base) :
        base + (2 * top - 1) * ((base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base)) - base);
      case 'linearLight': return Math.max(0, Math.min(1, base + 2 * top - 1));
      case 'difference': return Math.abs(base - top);
      case 'exclusion': return base + top - 2 * base * top;
      case 'subtract': return Math.max(0, base - top);
      case 'divide': return top === 0 ? 1 : Math.min(1, base / top);
      default: return top;
    }
  });
}

function factorMask(mask, size, height = size) {
  if (!mask) return null;
  return mask.getContext('2d').getImageData(0, 0, size, height).data;
}

function multiplyFactorCanvases(base, mask, size, height = size) {
  const basePixels = factorMask(base, size, height);
  const maskPixels = factorMask(mask, size, height);
  const result = newCanvas(size, height);
  const context = result.getContext('2d');
  const image = context.createImageData(size, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const baseValue = basePixels ? (basePixels[offset] * .2126 +
      basePixels[offset + 1] * .7152 + basePixels[offset + 2] * .0722) / 255 *
      basePixels[offset + 3] / 255 : 1;
    const maskValue = maskPixels ? (maskPixels[offset] * .2126 +
      maskPixels[offset + 1] * .7152 + maskPixels[offset + 2] * .0722) / 255 *
      maskPixels[offset + 3] / 255 : 1;
    const value = Math.round(baseValue * maskValue * 255);
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return result;
}

export function blendCanvases(base, top, mode, factor, size, mask = null, height = size) {
  const result = newCanvas(size, height);
  const context = result.getContext('2d');
  context.drawImage(base, 0, 0);
  if (factor <= 0) return result;
  const maskPixels = factorMask(mask, size, height);
  let source = top;
  if (factor < 1 || maskPixels) {
    source = newCanvas(size, height);
    const sourceContext = source.getContext('2d');
    sourceContext.drawImage(top, 0, 0);
    const image = sourceContext.getImageData(0, 0, size, height);
    for (let index = 0; index < size * height; index++) {
      const offset = index * 4;
      const maskValue = maskPixels ? (maskPixels[offset] * .2126 +
        maskPixels[offset + 1] * .7152 + maskPixels[offset + 2] * .0722) / 255 *
        maskPixels[offset + 3] / 255 : 1;
      image.data[offset + 3] *= factor * maskValue;
    }
    sourceContext.putImageData(image, 0, 0);
  }
  if (mode === 'mix') {
    context.drawImage(source, 0, 0);
    return result;
  }
  if (CANVAS_BLEND_MODES[mode]) {
    context.globalCompositeOperation = CANVAS_BLEND_MODES[mode];
    context.drawImage(source, 0, 0);
    return result;
  }
  const basePixels = context.getImageData(0, 0, size, height);
  const topPixels = source.getContext('2d').getImageData(0, 0, size, height).data;
  const pixels = basePixels.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const baseAlpha = pixels[offset + 3] / 255;
    const topAlpha = topPixels[offset + 3] / 255;
    const outputAlpha = topAlpha + baseAlpha * (1 - topAlpha);
    if (!outputAlpha) continue;
    const baseColor = [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255];
    const topColor = [topPixels[offset] / 255, topPixels[offset + 1] / 255, topPixels[offset + 2] / 255];
    const blended = blendRgb(baseColor, topColor, mode);
    for (let channel = 0; channel < 3; channel++) {
      const modifiedTop = (1 - baseAlpha) * topColor[channel] + baseAlpha * blended[channel];
      pixels[offset + channel] = (topAlpha * modifiedTop +
        baseAlpha * (1 - topAlpha) * baseColor[channel]) / outputAlpha * 255;
    }
    pixels[offset + 3] = outputAlpha * 255;
  }
  context.putImageData(basePixels, 0, 0);
  return result;
}

export function evaluateTextureNode(surface, nodeId, socket = 'Color', graph = surface.graph) {
  const { canvas } = surface;
  const size = canvas.width;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const cache = new Map();
  const visiting = new Set();
  const input = (node, socket) => {
    const link = graph.links.find((item) => item.to === node.id && item.toSocket === socket);
    return link ? evaluate(link.from, link.fromSocket) : null;
  };
  const evaluate = (id, socket = 'Color') => {
    const cacheKey = `${id}:${socket}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (visiting.has(id)) return null;
    const node = nodes.get(id);
    if (!node) return null;
    visiting.add(id);
    let result = null;
    if (node.type === 'color') result = solidCanvas(size, node.color);
    else if (node.type === 'invert') result = invertCanvas(input(node, 'Color'), size);
    else if (node.type === 'image') {
      const asset = surface.imageAssets?.get(node.imageKey);
      if (asset) {
        const settings = [node.interpolation, node.projection, node.extension, node.scale,
          node.offsetU, node.offsetV, JSON.stringify(node.warp ?? null)].join(':');
        const imageKey = `${node.id}:${node.imageKey}:${asset.revision}:${settings}`;
        let image = surface.imageCache.get(imageKey);
        if (!image) {
          image = bakeImageToUv(surface, node, asset.canvas, size);
          for (const key of surface.imageCache.keys())
            if (key.startsWith(`${node.id}:`)) surface.imageCache.delete(key);
          if (surface.imageCache.size >= 3)
            surface.imageCache.delete(surface.imageCache.keys().next().value);
          surface.imageCache.set(imageKey, image);
        }
        if (socket === 'Alpha') {
          result = newCanvas(size);
          const context = result.getContext('2d');
          const pixels = image.getContext('2d').getImageData(0, 0, size, size);
          for (let offset = 0; offset < pixels.data.length; offset += 4) {
            const alpha = pixels.data[offset + 3];
            pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = alpha;
            pixels.data[offset + 3] = 255;
          }
          context.putImageData(pixels, 0, 0);
        } else result = image;
      }
    }
    else if (node.type === 'blend') {
      const base = input(node, 'A') ?? (surface.transparentBase && node.layerSourceId &&
        node.colorA === '#ffffff' ? newCanvas(size) : solidCanvas(size, node.colorA));
      const top = input(node, 'B') ?? solidCanvas(size, node.colorB);
      const mask = input(node, 'Factor');
      const factor = !layerVisibleInHierarchy(node, nodes) || node.layerIsMask ? 0 :
        Math.max(0, Math.min(1, Number(node.factor) || 0));
      result = blendCanvases(base, top, node.mode, factor, size, mask);
    } else if (node.type === 'layerMask')
      result = multiplyFactorCanvases(input(node, 'Base'), input(node, 'Mask'), size);
    else if (node.type === 'output') result = input(node, 'Color');
    visiting.delete(id);
    cache.set(cacheKey, result);
    return result;
  };
  return evaluate(nodeId, socket);
}

// The graph can be evaluated in UV-space tiles while painting. Every intermediate
// canvas has the dirty rectangle's dimensions, so a mask no longer forces a
// full-resolution graph render for each brush dab.
function renderGraphRegion(surface, region) {
  const width = region.right - region.left;
  const height = region.bottom - region.top;
  if (width <= 0 || height <= 0) return true;
  const { graph } = surface;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = new Map(graph.links.map((link) => [`${link.to}:${link.toSocket}`, link]));
  const cache = new Map();
  const visiting = new Set();
  let supported = true;
  const input = (node, socket) => {
    const link = links.get(`${node.id}:${socket}`);
    return link ? evaluate(link.from, link.fromSocket) : null;
  };
  const evaluate = (id, socket = 'Color') => {
    const key = `${id}:${socket}`;
    if (cache.has(key)) return cache.get(key);
    if (visiting.has(id)) { supported = false; return null; }
    const node = nodes.get(id);
    if (!node) return null;
    visiting.add(id);
    let result = null;
    if (node.type === 'color') result = solidCanvas(width, node.color, height);
    else if (node.type === 'invert') result = invertCanvas(input(node, 'Color'), width, height);
    else if (node.type === 'image') {
      const asset = surface.imageAssets?.get(node.imageKey);
      if (asset) {
        if ((node.projection ?? 'flat') !== 'flat') supported = false;
        else {
          const image = newCanvas(width, height);
          const context = image.getContext('2d');
          if (!drawFlatImageRegion(context, asset.canvas, node, region, surface.canvas.width))
            supported = false;
          else if (socket === 'Alpha') {
            const pixels = context.getImageData(0, 0, width, height);
            for (let offset = 0; offset < pixels.data.length; offset += 4) {
              const alpha = pixels.data[offset + 3];
              pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = alpha;
              pixels.data[offset + 3] = 255;
            }
            context.putImageData(pixels, 0, 0);
          }
          result = image;
        }
      }
    } else if (node.type === 'blend') {
      const base = input(node, 'A') ?? solidCanvas(width, node.colorA, height);
      const top = input(node, 'B') ?? solidCanvas(width, node.colorB, height);
      const mask = input(node, 'Factor');
      const factor = !layerVisibleInHierarchy(node, nodes) || node.layerIsMask ? 0 :
        Math.max(0, Math.min(1, Number(node.factor) || 0));
      result = blendCanvases(base, top, node.mode, factor, width, mask, height);
    } else if (node.type === 'layerMask')
      result = multiplyFactorCanvases(input(node, 'Base'), input(node, 'Mask'), width, height);
    else if (node.type === 'output') result = input(node, 'Color');
    else supported = false;
    visiting.delete(id);
    cache.set(key, result);
    return result;
  };
  const result = evaluate('output');
  if (!supported) return false;
  const context = surface.compositeContext;
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  if (surface.transparentBase) context.clearRect(region.left, region.top, width, height);
  else {
    context.fillStyle = '#ffffff';
    context.fillRect(region.left, region.top, width, height);
  }
  if (result) context.drawImage(result, region.left, region.top);
  context.restore();
  return true;
}

function renderSimpleLayerStack(surface, region = null) {
  const { graph, compositeContext, imageAssets } = surface;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = (id, socket) => graph.links.find((link) => link.to === id && link.toSocket === socket);
  let link = incoming('output', 'Color');
  if (!link) return false;
  const layers = [];
  const visited = new Set();
  while (link) {
    const blend = nodes.get(link.from);
    if (link.fromSocket !== 'Result' || blend?.type !== 'blend' ||
        !blend.layerSourceId || visited.has(blend.id) || incoming(blend.id, 'Factor')) return false;
    const sourceLink = incoming(blend.id, 'B');
    const source = nodes.get(sourceLink?.from);
    if (sourceLink?.fromSocket !== 'Color' || source?.type !== 'image' ||
        source.id !== blend.layerSourceId || !imageAssets.has(source.imageKey) ||
        (source.projection ?? 'flat') !== 'flat') return false;
    const transformed = (Number(source.scale) || 1) !== 1 ||
      Number(source.offsetU) || Number(source.offsetV);
    if (transformed && !['clip', 'repeat'].includes(source.extension ?? 'repeat')) return false;
    if (transformed && (source.extension ?? 'repeat') === 'repeat' &&
        typeof DOMMatrix === 'undefined') return false;
    visited.add(blend.id);
    layers.push({ blend, source, asset: imageAssets.get(source.imageKey) });
    link = incoming(blend.id, 'A');
    if (!link && blend.colorA !== '#ffffff') return false;
  }
  if (surface.transparentBase && layers.some(({ blend }) =>
    (blend.mode || 'mix') !== 'mix' && !CANVAS_BLEND_MODES[blend.mode])) return false;
  compositeContext.save();
  compositeContext.globalCompositeOperation = 'source-over';
  compositeContext.globalAlpha = 1;
  const left = region?.left ?? 0;
  const top = region?.top ?? 0;
  const width = region ? region.right - left : surface.canvas.width;
  const height = region ? region.bottom - top : surface.canvas.height;
  if (surface.transparentBase) compositeContext.clearRect(left, top, width, height);
  else {
    compositeContext.fillStyle = '#ffffff';
    compositeContext.fillRect(left, top, width, height);
  }
  for (const { blend, source, asset } of layers.reverse()) {
    if (!layerVisibleInHierarchy(blend, nodes) || blend.layerIsMask) continue;
    const factor = Math.max(0, Math.min(1, Number(blend.factor) || 0));
    if (!factor) continue;
    let canvas = asset.canvas;
    let sourceRegion = region;
    const transformed = (Number(source.scale) || 1) !== 1 ||
      Number(source.offsetU) || Number(source.offsetV) ||
      asset.canvas.width !== surface.canvas.width ||
      asset.canvas.height !== surface.canvas.height;
    if (transformed) {
      const left = region?.left ?? 0;
      const top = region?.top ?? 0;
      const width = region ? region.right - left : surface.canvas.width;
      const height = region ? region.bottom - top : surface.canvas.height;
      let scratch = asset.layerScratch;
      if (!scratch) asset.layerScratch = scratch = newCanvas(width, height);
      if (scratch.width < width) scratch.width = width;
      if (scratch.height < height) scratch.height = height;
      const context = scratch.getContext('2d');
      context.clearRect(0, 0, width, height);
      drawFlatImageRegion(context, asset.canvas, source,
        { left, top, right: left + width, bottom: top + height }, surface.canvas.width);
      canvas = scratch;
      sourceRegion = { left: 0, top: 0, right: width, bottom: height };
    }
    const mode = blend.mode || 'mix';
    const operation = mode === 'mix' ? 'source-over' : CANVAS_BLEND_MODES[mode];
    if (operation) {
      compositeContext.globalCompositeOperation = operation;
      compositeContext.globalAlpha = factor;
      if (region) compositeContext.drawImage(canvas, sourceRegion.left, sourceRegion.top,
        sourceRegion.right - sourceRegion.left, sourceRegion.bottom - sourceRegion.top,
        region.left, region.top, region.right - region.left, region.bottom - region.top);
      else compositeContext.drawImage(canvas, 0, 0);
      continue;
    }
    const left = region?.left ?? 0;
    const top = region?.top ?? 0;
    const width = region ? region.right - left : surface.canvas.width;
    const height = region ? region.bottom - top : surface.canvas.height;
    const basePixels = compositeContext.getImageData(left, top, width, height);
    let scratch = surface.blendScratch;
    if (!scratch) surface.blendScratch = scratch = newCanvas(width, height);
    if (scratch.width < width) scratch.width = width;
    if (scratch.height < height) scratch.height = height;
    const scratchContext = scratch.getContext('2d');
    scratchContext.clearRect(0, 0, width, height);
    scratchContext.drawImage(canvas, sourceRegion?.left ?? left, sourceRegion?.top ?? top,
      width, height, 0, 0, width, height);
    const topPixels = scratchContext.getImageData(0, 0, width, height).data;
    const pixels = basePixels.data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = topPixels[offset + 3] / 255 * factor;
      if (!alpha) continue;
      const base = [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255];
      const topColor = [topPixels[offset] / 255, topPixels[offset + 1] / 255,
        topPixels[offset + 2] / 255];
      const blended = blendRgb(base, topColor, mode);
      for (let channel = 0; channel < 3; channel++)
        pixels[offset + channel] = (base[channel] * (1 - alpha) + blended[channel] * alpha) * 255;
    }
    compositeContext.putImageData(basePixels, left, top);
  }
  compositeContext.restore();
  return true;
}

export function renderTextureGraph(surface, region = null) {
  const { canvas, compositeCanvas, compositeContext } = surface;
  const size = canvas.width;
  if (renderSimpleLayerStack(surface, region)) {
    if (!region) surface.texture.needsUpdate = true;
    return Boolean(region);
  }
  if (region && renderGraphRegion(surface, region)) return true;
  if (surface.transparentBase) compositeContext.clearRect(0, 0, size, size);
  else {
    compositeContext.fillStyle = '#ffffff';
    compositeContext.fillRect(0, 0, size, size);
  }
  const result = evaluateTextureNode(surface, 'output');
  if (result && result !== compositeCanvas) compositeContext.drawImage(result, 0, 0);
  surface.texture.needsUpdate = true;
  return false;
}
