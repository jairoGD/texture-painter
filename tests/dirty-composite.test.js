import assert from 'node:assert/strict';
import test from 'node:test';
import { addDirtyRegion, dirtyArea } from '../src/editor/dirty-regions.js';
import { addGraphLayer, moveGraphLayerTo } from '../src/editor/layer-graph.js';
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
    graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
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

test('transparent material composition clears the base instead of painting it white', () => {
  const calls = [];
  const graph = createTextureGraph();
  const layer = addGraphLayer(graph, 'image');
  layer.source.imageKey = 'image-1';
  const image = { width: 64, height: 64 };
  const surface = {
    graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
    transparentBase: true, imageAssets: new Map([['image-1', { canvas: image }]]),
    texture: { needsUpdate: false },
    compositeContext: { save() {}, restore() {},
      clearRect(...args) { calls.push(['clear', ...args]); },
      fillRect(...args) { calls.push(['fill', ...args]); },
      drawImage(...args) { calls.push(['draw', ...args]); } }
  };
  assert.equal(renderTextureGraph(surface, { left: 4, top: 5, right: 12, bottom: 15 }), true);
  assert.deepEqual(calls[0], ['clear', 4, 5, 8, 10]);
  assert.deepEqual(calls[1], ['draw', image, 4, 5, 8, 10, 4, 5, 8, 10]);
  assert.ok(!calls.some(([operation]) => operation === 'fill'));
});

test('a hidden parent removes its child from the fast layer composite', () => {
  const graph = createTextureGraph();
  const parent = addGraphLayer(graph, 'image');
  const child = addGraphLayer(graph, 'image');
  parent.source.imageKey = 'parent';
  child.source.imageKey = 'child';
  moveGraphLayerTo(graph, child.mix.id, parent.mix.id, 'inside');
  parent.mix.layerVisible = false;
  const draws = [];
  const surface = {
    graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
    imageAssets: new Map([['parent', { canvas: { width: 64, height: 64 } }],
      ['child', { canvas: { width: 64, height: 64 } }]]),
    compositeContext: { save() {}, restore() {}, fillRect() {},
      drawImage(...args) { draws.push(args); } }
  };
  assert.equal(renderTextureGraph(surface, { left: 0, top: 0, right: 8, bottom: 8 }), true);
  assert.equal(draws.length, 0);
});

test('a native-resolution layer covers the project UV canvas without padding', () => {
  const oldDocument = globalThis.document;
  const draws = [];
  globalThis.document = { createElement: () => {
    const context = { clearRect() {}, drawImage(...args) { draws.push(args); } };
    return { width: 0, height: 0, getContext: () => context };
  } };
  try {
    const graph = createTextureGraph();
    const layer = addGraphLayer(graph, 'image');
    layer.source.imageKey = 'native';
    const image = { width: 16, height: 8 };
    const surface = {
      graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
      imageAssets: new Map([['native', { canvas: image }]]),
      texture: { needsUpdate: false },
      compositeContext: { save() {}, restore() {}, fillRect() {}, drawImage(...args) { draws.push(args); } }
    };
    assert.equal(renderTextureGraph(surface, { left: 4, top: 5, right: 12, bottom: 15 }), true);
    assert.deepEqual(draws[0], [image, -4, -5, 64, 64]);
    assert.equal(draws[1][0].width, 8);
    assert.equal(draws[1][0].height, 10);
  } finally { globalThis.document = oldDocument; }
});

test('painting a mask recomposes only the dirty rectangle through the factor graph', () => {
  const oldDocument = globalThis.document;
  const created = [];
  globalThis.document = { createElement: () => {
    const canvas = { width: 0, height: 0 };
    const context = {
      fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {},
      getImageData(x, y, width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
      },
      createImageData(width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
      }
    };
    canvas.getContext = () => context;
    created.push(canvas);
    return canvas;
  } };
  try {
    const graph = createTextureGraph();
    const mask = addGraphLayer(graph, 'image');
    const child = addGraphLayer(graph, 'image');
    mask.source.imageKey = 'mask-image';
    child.source.imageKey = 'paint-image';
    mask.mix.layerIsMask = true;
    assert.equal(moveGraphLayerTo(graph, child.mix.id, mask.mix.id, 'inside'), true);
    const composites = [];
    const surface = {
      graph, canvas: { width: 2048, height: 2048 },
      compositeCanvas: { width: 2048 }, texture: { needsUpdate: false },
      imageAssets: new Map([
        ['mask-image', { canvas: { width: 2048, height: 2048 } }],
        ['paint-image', { canvas: { width: 512, height: 512 } }]
      ]),
      compositeContext: {
        save() {}, restore() {},
        fillRect(...args) { composites.push(['fill', ...args]); },
        drawImage(...args) { composites.push(['draw', ...args]); }
      }
    };
    const region = { left: 120, top: 180, right: 136, bottom: 192 };
    assert.equal(renderTextureGraph(surface, region), true);
    assert.ok(created.length > 0);
    assert.ok(created.every((canvas) => canvas.width === 16 && canvas.height === 12));
    assert.deepEqual(composites[0], ['fill', 120, 180, 16, 12]);
    assert.equal(surface.texture.needsUpdate, false);
  } finally { globalThis.document = oldDocument; }
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
      const surface = { graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
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
    const surface = { graph, canvas: { width: 64, height: 64 }, compositeCanvas: { width: 64 },
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

test('an imported editable layer composites locally while retaining its original asset', () => {
  const calls = [];
  const graph = createTextureGraph();
  const layer = addGraphLayer(graph, 'image');
  layer.source.imageKey = 'imported';
  layer.source.extension = 'clip';
  const originalCanvas = { width: 13, height: 7 };
  const canvas = { width: 64, height: 64 };
  const surface = { graph, canvas, compositeCanvas: { width: 64 },
    imageAssets: new Map([['imported', { imported: true, originalCanvas, canvas }]]),
    texture: { needsUpdate: false },
    compositeContext: { save() {}, restore() {}, fillRect() {},
      drawImage(...args) { calls.push(args); } } };
  assert.equal(renderTextureGraph(surface, { left: 8, top: 16, right: 24, bottom: 32 }), true);
  assert.deepEqual(calls[0], [canvas, 8, 16, 16, 16, 8, 16, 16, 16]);
  assert.deepEqual([originalCanvas.width, originalCanvas.height], [13, 7]);
});

test('changing image scale keeps flat clipped layers on partial recomposition', () => {
  const oldDocument = globalThis.document;
  const draws = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ clearRect() {}, drawImage(...args) { draws.push(args); } }) }) };
  try {
    const graph = createTextureGraph();
    const layer = addGraphLayer(graph, 'image');
    layer.source.imageKey = 'image-1';
    layer.source.extension = 'clip';
    layer.source.scale = 2;
    const canvas = { width: 64, height: 64 };
    const surface = { graph, canvas, compositeCanvas: { width: 64 },
      imageAssets: new Map([['image-1', { canvas }]]), texture: { needsUpdate: false },
      compositeContext: { save() {}, restore() {}, fillRect() {}, drawImage() {} } };
    assert.equal(renderTextureGraph(surface, { left: 8, top: 9, right: 16, bottom: 17 }), true);
    assert.deepEqual(draws[0], [canvas, -8, 23, 32, 32]);
  } finally {
    globalThis.document = oldDocument;
  }
});
