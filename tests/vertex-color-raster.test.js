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

test('overlapping UVs keep the original first face without changing UVs', () => {
  const geometry = new BufferGeometry();
  const originalUv = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  geometry.setAttribute('uv', new Float32BufferAttribute(originalUv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1
  ], 3));
  const pixels = rasterizeVertexColors(geometry, 0, 32);
  const center = (24 * 32 + 8) * 4;
  assert.equal(pixels[center], 255);
  assert.equal(pixels[center + 2], 0);
  assert.deepEqual(Array.from(geometry.getAttribute('uv').array), originalUv);
  assert.equal(geometry.getAttribute('uv1'), undefined);
});

test('the original half wins regardless of its X orientation', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    1, 0, 0, 2, 0, 0, 1, 1, 0,
    -2, 0, 0, -1, 0, 0, -2, 1, 0
  ], 3));
  const originalUv = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  geometry.setAttribute('uv', new Float32BufferAttribute(originalUv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1
  ], 3));
  const pixel = (24 * 32 + 8) * 4;
  const pixels = rasterizeVertexColors(geometry, 0, 32);
  assert.equal(pixels[pixel], 255);
  assert.equal(pixels[pixel + 2], 0);
  assert.deepEqual(Array.from(geometry.getAttribute('uv').array), originalUv);
  assert.equal(geometry.getAttribute('uv1'), undefined);
});

test('vertex color bake pads UV island edges without filling the empty atlas', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0.25, 0.25, 0.75, 0.25, 0.25, 0.75
  ], 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0
  ], 3));
  const size = 64;
  const pixels = rasterizeVertexColors(geometry, 0, size);
  const pixel = (x, y) => (y * size + x) * 4;
  assert.equal(pixels[pixel(15, 32) + 3], 255);
  assert.ok(pixels[pixel(15, 32) + 1] > 0);
  assert.equal(pixels[pixel(8, 32) + 3], 0);
});

test('vertex color edge padding wraps across the UV atlas boundary', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0, 0, 0.5, 0, 0, 0.5
  ], 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1
  ], 3));
  const size = 64;
  const pixels = rasterizeVertexColors(geometry, 0, size);
  const wrapped = (48 * size + size - 1) * 4;
  assert.equal(pixels[wrapped + 2], 255);
  assert.equal(pixels[wrapped + 3], 255);
});

test('vertex color gutter extends past the former four-pixel limit at project resolution', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0.25, 0.25, 0.75, 0.25, 0.25, 0.75
  ], 2));
  geometry.setAttribute('color', new Float32BufferAttribute([
    0, 0.25, 0, 0, 0.25, 0, 0, 0.25, 0
  ], 3));
  const size = 1024;
  const pixels = rasterizeVertexColors(geometry, 0, size);
  const alpha = (x, y) => pixels[(y * size + x) * 4 + 3];
  assert.equal(alpha(249, 512), 255);
  assert.equal(alpha(240, 512), 0);
});
