import assert from 'node:assert/strict';
import test from 'node:test';
import { addGraphLayer, moveGraphLayerTo } from '../src/editor/layer-graph.js';
import { createTextureGraph } from '../src/editor/texture-graph.js';
import { renderTextureGraph } from '../src/editor/texture-graph.js';

test('painting another layer composites only the dirty region when triplanar is cached', () => {
  const projected = { width: 16, height: 16 };
  const painted = { width: 16, height: 16 };
  const draws = [];
  const compositeContext = {
    save() {}, restore() {}, clearRect() {},
    drawImage(...args) { draws.push(args); }
  };
  const source = { id: 'image', type: 'image', imageKey: 'asset',
    interpolation: 'linear', projection: 'triplanar', extension: 'repeat',
    scale: 1, rotation: 0, offsetU: 0, offsetV: 0 };
  const graph = { nodes: [
    { id: 'output', type: 'output' },
    { id: 'paintBlend', type: 'blend', layerSourceId: 'paintImage',
      mode: 'mix', factor: 1, colorA: '#ffffff' },
    { id: 'paintImage', type: 'image', imageKey: 'paintAsset', projection: 'flat',
      scale: 1, rotation: 0, offsetU: 0, offsetV: 0 },
    { id: 'blend', type: 'blend', layerSourceId: 'image',
      mode: 'mix', factor: 1, colorA: '#ffffff' },
    source
  ], links: [
    { from: 'image', fromSocket: 'Color', to: 'blend', toSocket: 'B' },
    { from: 'blend', fromSocket: 'Result', to: 'paintBlend', toSocket: 'A' },
    { from: 'paintImage', fromSocket: 'Color', to: 'paintBlend', toSocket: 'B' },
    { from: 'paintBlend', fromSocket: 'Result', to: 'output', toSocket: 'Color' }
  ] };
  const settings = ['linear', 'triplanar', 'repeat', 1, 0, 0, 0, 'null'].join(':');
  const surface = { canvas: { width: 16, height: 16 }, compositeContext, graph, transparentBase: true,
    imageAssets: new Map([
      ['asset', { revision: 0, canvas: { width: 16, height: 16 } }],
      ['paintAsset', { revision: 1, canvas: painted }]
    ]),
    imageCache: new Map([[`image:asset:0:${settings}`, projected]]),
    texture: { needsUpdate: false } };
  const region = { left: 2, top: 3, right: 5, bottom: 7 };
  assert.equal(renderTextureGraph(surface, region), true);
  assert.strictEqual(draws[0][0], projected);
  assert.deepEqual(draws[0].slice(1), [2, 3, 3, 4, 2, 3, 3, 4]);
  assert.strictEqual(draws[1][0], painted);
  assert.deepEqual(draws[1].slice(1), [2, 3, 3, 4, 2, 3, 3, 4]);
  assert.equal(surface.texture.needsUpdate, false);
});

test('a triplanar mask stays on the dirty-region graph path', () => {
  const previousDocument = globalThis.document;
  const created = [];
  globalThis.document = { createElement: () => {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({
      fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {},
      getImageData(_x, _y, width, height) {
        return { data: new Uint8ClampedArray(width * height * 4) };
      },
      createImageData(width, height) {
        return { data: new Uint8ClampedArray(width * height * 4) };
      }
    });
    created.push(canvas);
    return canvas;
  } };
  try {
    const graph = createTextureGraph();
    const mask = addGraphLayer(graph, 'image');
    const child = addGraphLayer(graph, 'image');
    mask.source.imageKey = 'mask';
    mask.source.projection = 'triplanar';
    mask.mix.layerIsMask = true;
    child.source.imageKey = 'paint';
    moveGraphLayerTo(graph, child.mix.id, mask.mix.id, 'inside');
    const settings = ['linear', 'triplanar', 'repeat', 1, 0, 0, 0, 'null'].join(':');
    const surface = { graph, canvas: { width: 64, height: 64 },
      compositeContext: { save() {}, restore() {}, fillRect() {}, drawImage() {} },
      texture: { needsUpdate: false },
      imageAssets: new Map([
        ['mask', { revision: 0, canvas: { width: 64, height: 64 } }],
        ['paint', { revision: 1, canvas: { width: 64, height: 64 } }]
      ]),
      imageCache: new Map([[`${mask.source.id}:mask:0:${settings}`,
        { width: 64, height: 64 }]]) };
    const region = { left: 4, top: 5, right: 12, bottom: 13 };
    assert.equal(renderTextureGraph(surface, region), true);
    assert.ok(created.length > 0);
    assert.ok(created.every((canvas) => canvas.width === 8 && canvas.height === 8));
    assert.equal(surface.texture.needsUpdate, false);
  } finally { globalThis.document = previousDocument; }
});
