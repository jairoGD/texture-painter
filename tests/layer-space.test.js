import assert from 'node:assert/strict';
import test from 'node:test';
import { scaleLayerRegion, uvToLayerPixel } from '../src/editor/layer-space.js';

test('UV paint coordinates use each layer native resolution', () => {
  assert.deepEqual(uvToLayerPixel({ x: 0.5, y: 0.25 }, { width: 512, height: 256 }),
    { x: 256, y: 192 });
});

test('a native paint change invalidates the matching project texture area', () => {
  assert.deepEqual(scaleLayerRegion({ left: 128, top: 128, right: 256, bottom: 256 },
    { width: 512, height: 512 }, { width: 2048, height: 2048 }),
  { left: 511, top: 511, right: 1025, bottom: 1025 });
});
