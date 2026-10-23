import assert from 'node:assert/strict';
import test from 'node:test';
import { addDirtyRegion, dirtyArea } from '../src/editor/dirty-regions.js';
import { addGraphLayer } from '../src/editor/layer-graph.js';
import { BLEND_MODES, createTextureGraph, renderTextureGraph } from '../src/editor/texture-graph.js';

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

test('every layer blend mode keeps the dirty rectangle path', () => {
  const oldDocument = globalThis.document;
  const region = { left: 4, top: 5, right: 5, bottom: 6 };
  globalThis.document = { createElement: () => {
    const context = {
      clearRect() {}, drawImage() {},
      getImageData: () => ({ data: Uint8ClampedArray.of(255, 0, 0, 255) })
    };
    return { width: 0, height: 0, getContext: () => context };
  } };
  try {
    for (const [mode] of BLEND_MODES) {
      const calls = [];
      const graph = createTextureGraph();
      const layer = addGraphLayer(graph, 'image');
      layer.source.imageKey = 'image-1';
      layer.mix.mode = mode;
      const compositeContext = {
        save() {}, restore() {}, fillRect(...args) { calls.push(['fill', ...args]); },
        drawImage(...args) { calls.push(['draw', ...args]); },
        getImageData(...args) {
          calls.push(['read', ...args]);
          return { data: Uint8ClampedArray.of(255, 255, 255, 255) };
        },
        putImageData(...args) { calls.push(['write', ...args]); }
      };
      const surface = { graph, canvas: { width: 64 }, compositeCanvas: { width: 64 },
        imageAssets: new Map([['image-1', { canvas: { width: 64, height: 64 } }]]),
        compositeContext, texture: { needsUpdate: false } };
      assert.equal(renderTextureGraph(surface, region), true, mode);
      assert.deepEqual(calls[0], ['fill', 4, 5, 1, 1], mode);
      assert.equal(surface.texture.needsUpdate, false, mode);
      if (mode === 'mix') continue;
      if (['linearLight', 'subtract', 'divide', 'value'].includes(mode))
        assert.ok(calls.some((call) => call[0] === 'read' &&
          call[1] === 4 && call[2] === 5 && call[3] === 1 && call[4] === 1), mode);
      else assert.ok(calls.some((call) => call[0] === 'draw' && call[1] ===
        surface.imageAssets.get('image-1').canvas), mode);
    }
  } finally {
    globalThis.document = oldDocument;
  }
});

test('custom blend mode composites only the painted pixel with its original color math', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ clearRect() {}, drawImage() {},
      getImageData: () => ({ data: Uint8ClampedArray.of(255, 0, 0, 255) }) }) }) };
  try {
    const graph = createTextureGraph();
    const layer = addGraphLayer(graph, 'image');
    layer.source.imageKey = 'image-1';
    layer.mix.mode = 'linearLight';
    let written = null;
    const surface = { graph, canvas: { width: 64 }, compositeCanvas: { width: 64 },
      imageAssets: new Map([['image-1', { canvas: { width: 64, height: 64 } }]]),
      texture: { needsUpdate: false },
      compositeContext: { save() {}, restore() {}, fillRect() {},
        getImageData: () => ({ data: Uint8ClampedArray.of(255, 255, 255, 255) }),
        putImageData(image, x, y) { written = { pixels: [...image.data], x, y }; } } };
    assert.equal(renderTextureGraph(surface, { left: 8, top: 9, right: 9, bottom: 10 }), true);
    assert.deepEqual(written, { pixels: [255, 0, 0, 255], x: 8, y: 9 });
  } finally {
    globalThis.document = oldDocument;
  }
});
