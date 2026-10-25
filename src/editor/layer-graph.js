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

function linkSource(link) {
  return link ? { from: link.from, fromSocket: link.fromSocket } : null;
}

function sameSource(link, source) {
  return !!link && !!source && link.from === source.from && link.fromSocket === source.fromSocket;
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
    const topNode = nodes.get(top?.from);
    const sourceLink = topNode?.type === 'invert' ? incoming(graph, topNode.id, 'Color') : top;
    const source = nodes.get(sourceLink?.from);
    if (!source || source.id !== mix.layerSourceId || !layerSources.has(source.type)) break;
    visited.add(mix.id);
    layers.push({ id: mix.id, mix, source, type: source.type,
      label: mix.layerName || source.imageName || layerSources.get(source.type).label });
    current = incoming(graph, mix.id, 'A');
  }
  return { layers, base: current };
}

export function layerAncestors(layers, layer) {
  const byId = new Map(layers.map((item) => [item.id, item]));
  const ancestors = [];
  const seen = new Set([layer.id]);
  let parent = byId.get(layer.mix.layerParentId);
  while (parent && !seen.has(parent.id)) {
    ancestors.push(parent);
    seen.add(parent.id);
    parent = byId.get(parent.mix.layerParentId);
  }
  return ancestors;
}

function positionGeneratedMasks(graph, layers) {
  for (const [index, layer] of layers.entries()) {
    const generated = graph.nodes.filter((node) => node.layerGeneratedFor === layer.id);
    generated.forEach((node, maskIndex) => {
      node.x = layer.mix.x - 210 - maskIndex * 190;
      node.y = 475 + index * 60;
    });
  }
}

export function syncLayerMasks(graph) {
  const { layers } = readLayerStack(graph);
  const generatedIds = new Set(graph.nodes.filter((node) => node.layerGeneratedFor)
    .map((node) => node.id));
  // Keep a user's Factor connection when the layer hierarchy supplies its own mask link.
  for (const layer of layers) {
    const factor = incoming(graph, layer.id, 'Factor');
    if (factor && !generatedIds.has(factor.from) &&
        !sameSource(factor, layer.mix.layerAutoFactor))
      layer.mix.layerManualFactor = linkSource(factor);
    else if (!factor && !layer.mix.layerAutoFactor) layer.mix.layerManualFactor = null;
  }
  graph.nodes = graph.nodes.filter((node) => !generatedIds.has(node.id));
  graph.links = graph.links.filter((link) => !generatedIds.has(link.from) &&
    !generatedIds.has(link.to) &&
    !(layers.some((layer) => layer.id === link.to) &&
      (link.toSocket === 'Factor' || link.toSocket === 'B')));

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const layerColors = new Map();
  for (const layer of layers) {
    const source = { from: layer.source.id, fromSocket: layerSources.get(layer.type).output };
    const needsInvert = layer.mix.layerIsMask ? !layer.mix.layerInvert : Boolean(layer.mix.layerInvert);
    if (needsInvert) {
      const inverted = addTextureNode(graph, 'invert', { x: 0, y: 0 });
      inverted.layerGeneratedFor = layer.id;
      inverted.layerInvertOwner = layer.id;
      connectTextureNodes(graph, source.from, source.fromSocket, inverted.id, 'Color');
      source.from = inverted.id;
      source.fromSocket = 'Color';
    }
    connectTextureNodes(graph, source.from, source.fromSocket, layer.id, 'B');
    layerColors.set(layer.id, source);
  }
  for (const layer of layers) {
    let factor = layer.mix.layerManualFactor;
    if (factor && !nodeIds.has(factor.from)) factor = null;
    const masks = layer.mix.layerIsMask ? [] : layerAncestors(layers, layer)
      .filter((ancestor) => ancestor.mix.layerIsMask && ancestor.mix.layerVisible !== false)
      .reverse();
    for (const mask of masks) {
      const source = layerColors.get(mask.id);
      if (!factor) { factor = source; continue; }
      const combined = addTextureNode(graph, 'layerMask', { x: 0, y: 0 });
      combined.layerGeneratedFor = layer.id;
      combined.layerMaskOwner = mask.id;
      connectTextureNodes(graph, factor.from, factor.fromSocket, combined.id, 'Base');
      connectTextureNodes(graph, source.from, source.fromSocket, combined.id, 'Mask');
      factor = { from: combined.id, fromSocket: 'Factor' };
    }
    if (factor) connectTextureNodes(graph, factor.from, factor.fromSocket, layer.id, 'Factor');
    layer.mix.layerAutoFactor = masks.length ? factor : null;
  }
  positionGeneratedMasks(graph, layers);
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
  for (const node of graph.nodes) if (node.layerGeneratedFor) managed.add(node.id);
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
  positionGeneratedMasks(graph, layers);
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
  mix.layerInvert = false;
  connectTextureNodes(graph, source.id, definition.output, mix.id, 'B');
  const next = [{ id: mix.id, mix, source, type }, ...layers];
  reconnect(graph, next, base);
  syncLayerMasks(graph);
  arrange(graph, next);
  return { mix, source };
}

export function copyGraphLayerTree(graph, layerId) {
  const { layers } = readLayerStack(graph);
  const root = layers.find((layer) => layer.id === layerId);
  if (!root) return null;
  return layers.filter((layer) => layer.id === layerId ||
    layerAncestors(layers, layer).some((ancestor) => ancestor.id === layerId))
    .map((layer) => ({ id: layer.id, parentId: layer.mix.layerParentId,
      label: layer.label, mix: structuredClone(layer.mix),
      source: structuredClone(layer.source) }));
}

export function pasteGraphLayerTree(graph, copied, beforeId = null) {
  if (!copied?.length) return null;
  const ids = new Map(), siblings = new Map(), created = [];
  for (const item of copied) {
    const layer = addGraphLayer(graph, item.source.type);
    if (!layer) return null;
    const { mix, source } = layer;
    const mixId = mix.id, sourceId = source.id;
    const { id: oldMixId, x: mixX, y: mixY, layerSourceId,
      layerParentId, layerAutoFactor, layerManualFactor, ...mixSettings } = item.mix;
    const { id: oldSourceId, x: sourceX, y: sourceY, imageKey,
      ...sourceSettings } = item.source;
    Object.assign(mix, mixSettings, { id: mixId, layerSourceId: sourceId,
      layerName: `${item.label} copy`, layerParentId: null });
    Object.assign(source, sourceSettings, { id: sourceId, imageKey: null });
    ids.set(item.id, mixId);
    ids.set(item.source.id, sourceId);
    const parentId = ids.get(item.parentId);
    const previousSibling = siblings.get(item.parentId);
    if (parentId) moveGraphLayerTo(graph, mixId, previousSibling ?? parentId,
      previousSibling ? 'after' : 'inside');
    else if (beforeId) moveGraphLayerTo(graph, mixId, beforeId, 'before');
    siblings.set(item.parentId, mixId);
    created.push({ original: item, mix, source, manualFactor: layerManualFactor });
  }
  for (const layer of created) {
    const factor = layer.manualFactor;
    if (factor) layer.mix.layerManualFactor = {
      from: ids.get(factor.from) ?? factor.from, fromSocket: factor.fromSocket
    };
  }
  syncLayerMasks(graph);
  return created;
}

export function removeGraphLayer(graph, layerId) {
  const { layers, base } = readLayerStack(graph);
  const selected = layers.find((layer) => layer.id === layerId);
  if (!selected) return false;
  for (const layer of layers) if (layer.mix.layerParentId === selected.id)
    layer.mix.layerParentId = selected.mix.layerParentId ?? null;
  const next = layers.filter((layer) => layer.id !== layerId);
  removeTextureNode(graph, selected.mix.id);
  reconnect(graph, next, base);
  syncLayerMasks(graph);
  if (!graph.links.some((link) => link.from === selected.source.id))
    removeTextureNode(graph, selected.source.id);
  arrange(graph, next);
  return true;
}

export function moveGraphLayer(graph, layerId, direction) {
  const { layers } = readLayerStack(graph);
  const selected = layers.find((layer) => layer.id === layerId);
  if (!selected) return false;
  const siblings = layers.filter((layer) =>
    (layer.mix.layerParentId ?? null) === (selected.mix.layerParentId ?? null));
  const index = siblings.findIndex((layer) => layer.id === layerId);
  const target = siblings[index + direction];
  return target ? moveGraphLayerTo(graph, layerId, target.id,
    direction < 0 ? 'before' : 'after') : false;
}

export function moveGraphLayerTo(graph, layerId, targetId, placement) {
  const { layers, base } = readLayerStack(graph);
  const moving = layers.find((layer) => layer.id === layerId);
  const target = layers.find((layer) => layer.id === targetId);
  if (!moving || (placement !== 'root' && !target) ||
      (placement === 'inside' && targetId === layerId)) return false;
  const movingIds = new Set(layers.filter((layer) => layer.id === layerId ||
    layerAncestors(layers, layer).some((ancestor) => ancestor.id === layerId))
    .map((layer) => layer.id));
  if (target && movingIds.has(target.id)) return false;
  const block = layers.filter((layer) => movingIds.has(layer.id));
  const remaining = layers.filter((layer) => !movingIds.has(layer.id));
  let insertAt = remaining.length;
  if (placement === 'before') insertAt = remaining.findIndex((layer) => layer.id === targetId);
  else if (placement === 'inside') insertAt = remaining.findIndex((layer) => layer.id === targetId) + 1;
  else if (placement === 'after') {
    const targetTree = new Set(remaining.filter((layer) => layer.id === targetId ||
      layerAncestors(remaining, layer).some((ancestor) => ancestor.id === targetId))
      .map((layer) => layer.id));
    insertAt = remaining.findLastIndex((layer) => targetTree.has(layer.id)) + 1;
  } else if (placement !== 'root') return false;
  moving.mix.layerParentId = placement === 'inside' ? targetId :
    placement === 'root' ? null : target.mix.layerParentId ?? null;
  remaining.splice(insertAt, 0, ...block);
  reconnect(graph, remaining, base);
  syncLayerMasks(graph);
  arrange(graph, remaining);
  return true;
}
