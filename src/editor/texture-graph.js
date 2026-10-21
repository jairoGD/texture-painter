export const NODE_TYPES = {
  paint: { title: 'Paint Texture', inputs: [], outputs: ['Color'], fixed: true },
  color: { title: 'Solid Color', inputs: [], outputs: ['Color'] },
  blend: { title: 'Mix', inputs: ['Base', 'Top'], outputs: ['Color'] },
  output: { title: 'Texture Output', inputs: ['Color'], outputs: [], fixed: true }
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
  if (type === 'blend') node.opacity = 50;
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

export function renderTextureGraph(surface) {
  const { graph, canvas, compositeCanvas, compositeContext } = surface;
  const size = canvas.width;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const cache = new Map();
  const visiting = new Set();
  const input = (node, socket) => {
    const link = graph.links.find((item) => item.to === node.id && item.toSocket === socket);
    return link ? evaluate(link.from) : null;
  };
  const evaluate = (id) => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) return null;
    const node = nodes.get(id);
    if (!node) return null;
    visiting.add(id);
    let result = null;
    if (node.type === 'paint') result = canvas;
    else if (node.type === 'color') {
      result = newCanvas(size);
      const context = result.getContext('2d');
      context.fillStyle = /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : '#ffffff';
      context.fillRect(0, 0, size, size);
    } else if (node.type === 'blend') {
      result = newCanvas(size);
      const context = result.getContext('2d');
      const base = input(node, 'Base');
      const top = input(node, 'Top');
      if (base) context.drawImage(base, 0, 0);
      if (top) {
        context.globalAlpha = Math.max(0, Math.min(100, Number(node.opacity) || 0)) / 100;
        context.drawImage(top, 0, 0);
      }
    } else if (node.type === 'output') result = input(node, 'Color');
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };
  compositeContext.fillStyle = '#ffffff';
  compositeContext.fillRect(0, 0, size, size);
  const result = evaluate('output');
  if (result && result !== compositeCanvas) compositeContext.drawImage(result, 0, 0);
  surface.texture.needsUpdate = true;
}
