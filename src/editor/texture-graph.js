import { bakeImageToUv } from './image-projection.js';

export const NODE_TYPES = {
  paint: { title: 'Paint Texture', inputs: [], outputs: ['Color'], fixed: true },
  color: { title: 'Solid Color', inputs: [], outputs: ['Color'] },
  blend: { title: 'Mix', inputs: ['A', 'B'], outputs: ['Result'] },
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
    nodes: [
      { id: 'paint', type: 'paint', x: 100, y: 90 },
      { id: 'output', type: 'output', x: 540, y: 90 }
    ],
    links: [{ from: 'paint', fromSocket: 'Color', to: 'output', toSocket: 'Color' }]
  };
}

export function cloneTextureGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
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

function newCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function solidCanvas(size, color) {
  const canvas = newCanvas(size);
  const context = canvas.getContext('2d');
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
  context.fillRect(0, 0, size, size);
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

function blendCanvases(base, top, mode, factor, size) {
  const result = newCanvas(size);
  const context = result.getContext('2d');
  context.drawImage(base, 0, 0);
  if (factor <= 0) return result;
  if (mode === 'mix') {
    context.globalAlpha = factor;
    context.drawImage(top, 0, 0);
    return result;
  }
  if (CANVAS_BLEND_MODES[mode]) {
    const blended = newCanvas(size);
    const blendContext = blended.getContext('2d');
    blendContext.drawImage(base, 0, 0);
    blendContext.globalCompositeOperation = CANVAS_BLEND_MODES[mode];
    blendContext.drawImage(top, 0, 0);
    context.globalAlpha = factor;
    context.drawImage(blended, 0, 0);
    return result;
  }
  const basePixels = context.getImageData(0, 0, size, size);
  const topPixels = top.getContext('2d').getImageData(0, 0, size, size).data;
  const pixels = basePixels.data;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const a = [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255];
    const b = [topPixels[offset] / 255, topPixels[offset + 1] / 255, topPixels[offset + 2] / 255];
    const blended = blendRgb(a, b, mode);
    for (let channel = 0; channel < 3; channel++)
      pixels[offset + channel] = (a[channel] + (blended[channel] - a[channel]) * factor) * 255;
  }
  context.putImageData(basePixels, 0, 0);
  return result;
}

export function renderTextureGraph(surface) {
  const { graph, canvas, compositeCanvas, compositeContext } = surface;
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
    if (node.type === 'paint') result = canvas;
    else if (node.type === 'color') result = solidCanvas(size, node.color);
    else if (node.type === 'image') {
      const asset = surface.imageAssets?.get(node.imageKey);
      if (asset) {
        const settings = [node.interpolation, node.projection, node.extension, node.scale,
          node.offsetU, node.offsetV].join(':');
        const imageKey = `${node.id}:${node.imageKey}:${asset.revision}:${settings}`;
        let image = surface.imageCache.get(imageKey);
        if (!image) {
          image = bakeImageToUv(surface, node, asset.canvas, size);
          if (surface.imageCache.size >= 8) surface.imageCache.delete(surface.imageCache.keys().next().value);
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
      const base = input(node, 'A') ?? solidCanvas(size, node.colorA);
      const top = input(node, 'B') ?? solidCanvas(size, node.colorB);
      const factor = Math.max(0, Math.min(1, Number(node.factor) || 0));
      result = blendCanvases(base, top, node.mode, factor, size);
    } else if (node.type === 'output') result = input(node, 'Color');
    visiting.delete(id);
    cache.set(cacheKey, result);
    return result;
  };
  compositeContext.fillStyle = '#ffffff';
  compositeContext.fillRect(0, 0, size, size);
  const result = evaluate('output');
  if (result && result !== compositeCanvas) compositeContext.drawImage(result, 0, 0);
  surface.texture.needsUpdate = true;
}
