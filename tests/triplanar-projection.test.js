import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaneGeometry } from 'three';
import { sampleTriplanarImage, triplanarCoordinates } from '../src/editor/image-projection.js';
import { getTriplanarLookup, shadeTriplanarLookup } from '../src/editor/triplanar-raster.js';

test('triplanar projection uses the matching plane on an axis aligned face', () => {
  const coordinates = triplanarCoordinates([0.25, 0.5, 0.75], [1, 0, 0]);
  assert.deepEqual(coordinates, [[0.25, 0.5, 1], [0.25, 0.75, 0], [0.25, 0.5, 0]]);
});

test('triplanar projection blends neighboring planes without darkening transparency', () => {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  pixels.set([255, 0, 0, 255], (1 * 2 + 0) * 4);
  pixels.set([0, 0, 255, 0], (1 * 2 + 1) * 4);
  const color = sampleTriplanarImage(pixels, 2, 2, [0.25, 0.25, 0.25],
    [1, 1, 0], 'closest', 'extend');
  assert.deepEqual(color, [255, 0, 0, 127.5]);
});

test('cached projection updates scale and rotation without rebuilding geometry coverage', () => {
  const geometry = new PlaneGeometry(2, 2);
  const lookup = getTriplanarLookup(geometry, 0, 4);
  assert.strictEqual(getTriplanarLookup(geometry, 0, 4), lookup);
  const source = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]);
  const plain = new Uint8ClampedArray(4 * 4 * 4);
  const rotated = new Uint8ClampedArray(4 * 4 * 4);
  shadeTriplanarLookup(lookup, source, 2, 2, plain,
    { interpolation: 'closest', extension: 'extend', scale: 1, rotation: 0 });
  shadeTriplanarLookup(lookup, source, 2, 2, rotated,
    { interpolation: 'closest', extension: 'extend', scale: 1, rotation: 90 });
  assert.deepEqual([...plain.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...rotated.slice(0, 4)], [0, 0, 255, 255]);
  geometry.dispose();
});

test('cached projection preserves RGB when one blended plane is transparent', () => {
  const lookup = { coordinates: new Uint16Array([16384, 16384, 16384]),
    weights: new Uint16Array([32768, 0]), flags: new Uint8Array([8 | 1 | 4]) };
  const source = new Uint8ClampedArray(2 * 2 * 4);
  source.set([255, 0, 0, 255], (1 * 2 + 0) * 4);
  source.set([0, 0, 255, 0], (1 * 2 + 1) * 4);
  const target = new Uint8ClampedArray(4);
  shadeTriplanarLookup(lookup, source, 2, 2, target,
    { interpolation: 'closest', extension: 'extend', scale: 1, rotation: 0 });
  assert.deepEqual([...target], [255, 0, 0, 127]);
});

test('cached sampler matches the reference across interpolation and edge modes', () => {
  const position = [0.13, 0.62, 0.89];
  const coordinates = new Uint16Array(position.map((value) => Math.round(value * 65535)));
  const lookup = { coordinates, weights: new Uint16Array([32768, 0]),
    flags: new Uint8Array([8 | 1 | 4]) };
  const source = new Uint8ClampedArray([
    255, 20, 0, 255, 0, 255, 20, 100, 20, 0, 255, 255,
    200, 90, 30, 0, 40, 180, 240, 255, 250, 250, 20, 128
  ]);
  for (const interpolation of ['closest', 'linear']) {
    for (const extension of ['repeat', 'mirror', 'clip', 'extend']) {
      const node = { interpolation, extension, scale: 1.7, rotation: 30,
        offsetU: -0.3, offsetV: 0.25 };
      const target = new Uint8ClampedArray(4);
      shadeTriplanarLookup(lookup, source, 3, 2, target, node);
      const angle = node.rotation * Math.PI / 180;
      const cosine = Math.cos(angle); const sine = Math.sin(angle);
      const transform = (u, v) => [
        (0.5 + cosine * (u - 0.5) - sine * (v - 0.5)) * node.scale + node.offsetU,
        (0.5 + sine * (u - 0.5) + cosine * (v - 0.5)) * node.scale + node.offsetV
      ];
      const decoded = [...coordinates].map((value) => value / 65535);
      const expected = sampleTriplanarImage(source, 3, 2, decoded, [1, 0, 1],
        interpolation, extension, transform);
      expected.forEach((value, channel) =>
        assert.ok(Math.abs(target[channel] - value) <= 1,
          `${interpolation}/${extension} channel ${channel}: ${target[channel]} vs ${value}`));
    }
  }
});
