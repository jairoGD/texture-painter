import assert from 'node:assert/strict';
import test from 'node:test';
import { addGraphLayer, layerAncestors, moveGraphLayer, moveGraphLayerTo,
  readLayerStack, removeGraphLayer, syncLayerMasks } from '../src/editor/layer-graph.js';
import { addTextureNode, connectTextureNodes, createTextureGraph } from '../src/editor/texture-graph.js';

function graphWithLayers(count) {
  const graph = createTextureGraph();
  const ids = [];
  for (let index = 0; index < count; index++) ids.push(addGraphLayer(graph, 'image').mix.id);
  return { graph, ids };
}

function factorLink(graph, id) {
  return graph.links.find((link) => link.to === id && link.toSocket === 'Factor');
}

test('a mask layer feeds its child Mix factor and disappears from the color stack', () => {
  const { graph, ids: [childId, maskId] } = graphWithLayers(2);
  const mask = graph.nodes.find((node) => node.id === maskId);
  mask.layerIsMask = true;
  assert.equal(moveGraphLayerTo(graph, childId, maskId, 'inside'), true);
  const layers = readLayerStack(graph).layers;
  assert.equal(layers.find((layer) => layer.id === childId).mix.layerParentId, maskId);
  assert.equal(factorLink(graph, childId).from, layers.find((layer) => layer.id === maskId).source.id);
  assert.equal(factorLink(graph, childId).fromSocket, 'Color');
  assert.equal(mask.layerIsMask, true);
  assert.ok(graph.links.some((link) => link.from === maskId && link.fromSocket === 'Result'),
    'the mask Mix stays in the editable layer chain');
});

test('masking affects descendants only, not adjacent layers', () => {
  const { graph, ids: [childId, maskId, siblingId] } = graphWithLayers(3);
  graph.nodes.find((node) => node.id === maskId).layerIsMask = true;
  moveGraphLayerTo(graph, childId, maskId, 'inside');
  assert.ok(factorLink(graph, childId));
  assert.equal(factorLink(graph, siblingId), undefined);
});

test('parenting under a normal layer only changes organization', () => {
  const { graph, ids: [childId, parentId] } = graphWithLayers(2);
  moveGraphLayerTo(graph, childId, parentId, 'inside');
  assert.equal(readLayerStack(graph).layers.find((layer) => layer.id === childId)
    .mix.layerParentId, parentId);
  assert.equal(factorLink(graph, childId), undefined);
});

test('nested masks and an existing manual factor combine through mask nodes', () => {
  const { graph, ids: [childId, innerId, outerId] } = graphWithLayers(3);
  const manual = addTextureNode(graph, 'color', { x: 0, y: 0 });
  connectTextureNodes(graph, manual.id, 'Color', childId, 'Factor');
  graph.nodes.find((node) => node.id === innerId).layerIsMask = true;
  graph.nodes.find((node) => node.id === outerId).layerIsMask = true;
  assert.equal(moveGraphLayerTo(graph, innerId, outerId, 'inside'), true);
  assert.equal(moveGraphLayerTo(graph, childId, innerId, 'inside'), true);
  assert.equal(layerAncestors(readLayerStack(graph).layers,
    readLayerStack(graph).layers.find((layer) => layer.id === childId)).length, 2);
  const generated = graph.nodes.filter((node) => node.layerGeneratedFor === childId);
  assert.equal(generated.length, 2);
  assert.ok(graph.links.some((link) => link.from === manual.id && link.to === generated[0].id &&
    link.toSocket === 'Base'));
  assert.equal(factorLink(graph, childId).from, generated.at(-1).id);

  graph.nodes.find((node) => node.id === outerId).layerIsMask = false;
  syncLayerMasks(graph);
  assert.equal(graph.nodes.filter((node) => node.layerGeneratedFor === childId).length, 1);
  assert.equal(moveGraphLayerTo(graph, childId, null, 'root'), true);
  assert.equal(factorLink(graph, childId).from, manual.id,
    'moving out of a mask restores the original manual factor');
});

test('reordering carries descendants and deleting a parent promotes its children', () => {
  const { graph, ids: [topId, childId, parentId, bottomId] } = graphWithLayers(4);
  moveGraphLayerTo(graph, childId, parentId, 'inside');
  assert.equal(moveGraphLayer(graph, parentId, -1), true);
  const moved = readLayerStack(graph).layers.map((layer) => layer.id);
  assert.equal(moved.indexOf(childId), moved.indexOf(parentId) + 1);
  assert.equal(removeGraphLayer(graph, parentId), true);
  assert.equal(readLayerStack(graph).layers.find((layer) => layer.id === childId).mix.layerParentId,
    null);
  assert.ok(readLayerStack(graph).layers.some((layer) => layer.id === topId));
  assert.ok(readLayerStack(graph).layers.some((layer) => layer.id === bottomId));
});

test('a new Factor connection becomes the manual factor beneath the layer mask', () => {
  const { graph, ids: [childId, maskId] } = graphWithLayers(2);
  graph.nodes.find((node) => node.id === maskId).layerIsMask = true;
  moveGraphLayerTo(graph, childId, maskId, 'inside');
  const manual = addTextureNode(graph, 'color', { x: 0, y: 0 });
  connectTextureNodes(graph, manual.id, 'Color', childId, 'Factor');
  syncLayerMasks(graph);
  const generated = graph.nodes.find((node) => node.layerGeneratedFor === childId);
  assert.ok(generated);
  assert.ok(graph.links.some((link) => link.from === manual.id && link.to === generated.id &&
    link.toSocket === 'Base'));
  assert.ok(graph.links.some((link) => link.from === readLayerStack(graph).layers
    .find((layer) => layer.id === maskId).source.id && link.to === generated.id &&
    link.toSocket === 'Mask'));
  assert.equal(factorLink(graph, childId).from, generated.id);

  graph.nodes.find((node) => node.id === maskId).layerVisible = false;
  syncLayerMasks(graph);
  assert.equal(factorLink(graph, childId).from, manual.id,
    'hiding the mask leaves the manually connected factor active');
});
