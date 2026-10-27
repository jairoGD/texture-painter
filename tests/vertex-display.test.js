import test from 'node:test';
import assert from 'node:assert/strict';
import { graphBelowVertexLayer, vertexDisplayPlan } from '../src/editor/vertex-display.js';

function layeredGraph() {
  return {
    nodes: [
      { id: 'output', type: 'output' },
      { id: 'base', type: 'image' },
      { id: 'baseMix', type: 'blend', layerSourceId: 'base', mode: 'mix', factor: 1 },
      { id: 'vertex', type: 'image', vertexColor: true },
      { id: 'vertexMix', type: 'blend', layerSourceId: 'vertex', mode: 'mix', factor: 0.5 }
    ],
    links: [
      { from: 'base', fromSocket: 'Color', to: 'baseMix', toSocket: 'B' },
      { from: 'baseMix', fromSocket: 'Result', to: 'vertexMix', toSocket: 'A' },
      { from: 'vertex', fromSocket: 'Color', to: 'vertexMix', toSocket: 'B' },
      { from: 'vertexMix', fromSocket: 'Result', to: 'output', toSocket: 'Color' }
    ]
  };
}

test('vertex display composites top vertex colors over the lower image graph', () => {
  const graph = layeredGraph();
  const plan = vertexDisplayPlan(graph);
  assert.deepEqual(plan, { mixId: 'vertexMix', factor: 0.5 });
  const below = graphBelowVertexLayer(graph, plan);
  assert.deepEqual(below.links.find((link) => link.to === 'output'),
    { from: 'baseMix', fromSocket: 'Result', to: 'output', toSocket: 'Color' });
  assert.equal(graph.links.find((link) => link.to === 'output').from, 'vertexMix');
});

test('vertex display avoids graph operations that need UV based blending', () => {
  const graph = layeredGraph();
  graph.links.push({ from: 'base', fromSocket: 'Alpha', to: 'vertexMix', toSocket: 'Factor' });
  assert.equal(vertexDisplayPlan(graph), null);
});
