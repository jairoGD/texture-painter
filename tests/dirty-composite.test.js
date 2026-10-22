import assert from 'node:assert/strict';
import test from 'node:test';
import { addDirtyRegion, dirtyArea } from '../src/editor/dirty-regions.js';
import { addGraphLayer } from '../src/editor/layer-graph.js';
import { createTextureGraph, renderTextureGraph } from '../src/editor/texture-graph.js';

test('neighboring brush marks merge while distant mirrored marks stay separate', () => {
  const regions = [];
  addDirtyRegion(regions, { left: 8, top: 8, right: 20, bottom: 20 }, 100, 100);
  addDirtyRegion(regions, { left: 18, top: 8, right: 30, bottom: 20 }, 100, 100);
  addDirtyRegion(regions, { left: 80, top: 8, right: 92, bottom: 20 }, 100, 100);
  assert.deepEqual(regions, [
    { left: 8, top: 8, right: 30, bottom: 20 },
    { left: 80, top: 8, right: 92, bottom: 20 }
  ]);
  assert.equal(dirtyArea(regions), 408);
});

test('a simple layer stack composites only the dirty rectangle', () => {
  const calls = [];
  const graph = createTextureGraph();
  const layer = addGraphLayer(graph, 'image');
  layer.source.imageKey = 'image-1';
  const image = { width: 64, height: 64 };
  const surface = {
    graph, canvas: { width: 64 }, compositeCanvas: { width: 64 },
    imageAssets: new Map([['image-1', { canvas: image }]]),
    texture: { needsUpdate: false },
    compositeContext: {
      save() {}, restore() {}, fillRect(...args) { calls.push(['fill', ...args]); },
      drawImage(...args) { calls.push(['draw', ...args]); }
    }
  };
  assert.equal(renderTextureGraph(surface, { left: 4, top: 5, right: 12, bottom: 15 }), true);
  assert.deepEqual(calls[0], ['fill', 4, 5, 8, 10]);
  assert.deepEqual(calls[1], ['draw', image, 4, 5, 8, 10, 4, 5, 8, 10]);
  assert.equal(surface.texture.needsUpdate, false);
});
