import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three';
import { rasterizeVertexColors } from '../src/editor/vertex-color-raster.js';

test('vertex colors interpolate across UV triangles and encode linear color for an sRGB texture', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    0.5, 0, 0, 1, 0.5, 0, 0, 0, 0.5
  ], 3));
  const pixels = rasterizeVertexColors(geometry, 0, 4);
  const inside = (2 * 4 + 1) * 4;
  assert.ok(pixels[inside] > 0 && pixels[inside] <= 188);
  assert.ok(pixels[inside + 1] > 0 && pixels[inside + 1] < 188);
  assert.equal(pixels[inside + 3], 255);
  assert.equal(pixels[(0 * 4 + 3) * 4 + 3], 0);
});

test('vertex color bake respects indexed material groups and vertex alpha', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1
  ], 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    1, 0, 0, 0.5, 1, 0, 0, 0.5,
    0, 0, 1, 1, 0, 0, 1, 1
  ], 4));
  geometry.setIndex(new Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const first = rasterizeVertexColors(geometry, 0, 4);
  const second = rasterizeVertexColors(geometry, 1, 4);
  const lowerRight = (3 * 4 + 2) * 4;
  const upperLeft = (0 * 4 + 1) * 4;
  assert.ok(first[lowerRight + 3] > 0);
  assert.equal(second[lowerRight + 3], 0);
  assert.equal(first[upperLeft + 3], 0);
  assert.ok(second[upperLeft + 3] > 0);
});
