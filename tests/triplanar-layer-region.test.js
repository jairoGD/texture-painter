import assert from 'node:assert/strict';
import test from 'node:test';
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
