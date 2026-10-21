import { addTextureNode, connectTextureNodes, removeTextureNode } from './texture-graph.js';

const layerSources = new Map();

export function registerLayerSource(type, definition) {
  if (layerSources.has(type)) throw new Error(`Layer source already registered: ${type}`);
  layerSources.set(type, definition);
}

export function listLayerSources() {
  return [...layerSources.entries()].map(([type, definition]) => ({ type, ...definition }));
}

registerLayerSource('image', { label: 'Paint Layer', output: 'Color', paintable: true });

function incoming(graph, nodeId, socket) {
  return graph.links.find((link) => link.to === nodeId && link.toSocket === socket) ?? null;
}

export function readLayerStack(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const layers = [];
  let current = incoming(graph, 'output', 'Color');
  const visited = new Set();
  while (current) {
    const mix = nodes.get(current.from);
    if (current.fromSocket !== 'Result' || mix?.type !== 'blend' || !mix.layerSourceId || visited.has(mix.id)) break;
    const top = incoming(graph, mix.id, 'B');
    const source = nodes.get(top?.from);
    if (!source || top.from !== mix.layerSourceId || !layerSources.has(source.type)) break;
    visited.add(mix.id);
    layers.push({ id: mix.id, mix, source, type: source.type,
      label: mix.layerName || source.imageName || layerSources.get(source.type).label });
    current = incoming(graph, mix.id, 'A');
  }
  return { layers, base: current };
}

function reconnect(graph, layers, base) {
  graph.links = graph.links.filter((link) =>
    !(link.to === 'output' && link.toSocket === 'Color') &&
    !layers.some((layer) => link.to === layer.mix.id && link.toSocket === 'A'));
  let previous = base;
  for (const layer of [...layers].reverse()) {
    if (previous) connectTextureNodes(graph, previous.from, previous.fromSocket, layer.mix.id, 'A');
    previous = { from: layer.mix.id, fromSocket: 'Result' };
  }
  if (previous) connectTextureNodes(graph, previous.from, previous.fromSocket, 'output', 'Color');
}

function arrange(graph, layers) {
  const managed = new Set(layers.flatMap((layer) => [layer.mix.id, layer.source.id]));
  const other = graph.nodes.filter((node) => node.id !== 'output' && !managed.has(node.id));
  const startX = Math.max(340, ...other.map((node) => node.x + 210));
  [...layers].reverse().forEach((layer, index) => {
    layer.mix.x = startX + index * 270;
    layer.mix.y = 75;
    layer.source.x = layer.mix.x - 25;
    layer.source.y = 300 + index * 45;
  });
  const output = graph.nodes.find((node) => node.id === 'output');
  if (output) {
    output.x = startX + layers.length * 270;
    output.y = 75;
  }
}

export function addGraphLayer(graph, type) {
  const definition = layerSources.get(type);
  if (!definition) return null;
  const { layers, base } = readLayerStack(graph);
  const source = addTextureNode(graph, type, { x: 0, y: 0 });
  const mix = addTextureNode(graph, 'blend', { x: 0, y: 0 });
  if (!source || !mix) return null;
  mix.layerSourceId = source.id;
  const usedNumbers = layers.map((layer) => /^Layer (\d+)$/.exec(layer.label)?.[1])
    .filter(Boolean).map(Number);
  mix.layerName = `Layer ${Math.max(0, ...usedNumbers) + 1}`;
  mix.factor = 1;
  mix.layerVisible = true;
  connectTextureNodes(graph, source.id, definition.output, mix.id, 'B');
  const next = [{ id: mix.id, mix, source, type }, ...layers];
  reconnect(graph, next, base);
  arrange(graph, next);
  return { mix, source };
}

export function removeGraphLayer(graph, layerId) {
  const { layers, base } = readLayerStack(graph);
  const selected = layers.find((layer) => layer.id === layerId);
  if (!selected) return false;
  const next = layers.filter((layer) => layer.id !== layerId);
  removeTextureNode(graph, selected.mix.id);
  if (!graph.links.some((link) => link.from === selected.source.id))
    removeTextureNode(graph, selected.source.id);
  reconnect(graph, next, base);
  arrange(graph, next);
  return true;
}

export function moveGraphLayer(graph, layerId, direction) {
  const { layers, base } = readLayerStack(graph);
  const index = layers.findIndex((layer) => layer.id === layerId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return false;
  [layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]];
  reconnect(graph, layers, base);
  arrange(graph, layers);
  return true;
}
