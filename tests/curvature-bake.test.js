import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCurvatureBaker } from '../src/editor/curvature-bake.js';
import { collectAmbientOcclusionGeometry } from '../src/editor/ambient-occlusion-source.js';

const face = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const convexNeighbor = [1, 0, 0, 0, 0, 0, 0, 0, -1];
const concaveNeighbor = [1, 0, 0, 0, 0, 0, 0, 0, 1];
const uv = [0, 1, 1, 1, 0, 0];

function render(positions, mode = 'convex', overrides = {}) {
  const source = { positions: new Float32Array(positions),
    targetTriangles: new Uint32Array([0]), targetUvs: new Float32Array(uv),
    diagonal: 2, ...(overrides.cornerNormals ? {
      cornerNormals: new Float32Array(overrides.cornerNormals) } : {}) };
  const baker = createCurvatureBaker(source,
    { resolution: 64, width: 5, strength: 100, mode, ...overrides });
  baker.bakeTriangle(0);
  return baker.finish();
}

function value(image, x, y) { return image.data[(y * image.width + x) * 4]; }

test('curvature highlights a convex shared edge and fades into the face', () => {
  const image = render([...face, ...convexNeighbor]);
  assert.ok(value(image, 16, 61) > 100);
  assert.ok(value(image, 16, 61) > value(image, 16, 42));
  assert.equal(image.data[(0 * 64 + 63) * 4 + 3], 0);
});

test('curvature distinguishes concave edges from convex edges', () => {
  const positions = [...face, ...concaveNeighbor];
  const convex = render(positions, 'convex');
  const cavity = render(positions, 'cavity');
  const signed = render(positions, 'signed');
  assert.equal(value(convex, 16, 61), 0);
  assert.ok(value(cavity, 16, 61) > 100);
  assert.ok(value(signed, 16, 61) < 128);
});

test('coplanar triangles and UV splits do not create a false curvature edge', () => {
  const second = [1, 0, 0, 1, 1, 0, 0, 1 + 1e-8, 0];
  const image = render([...face, ...second]);
  assert.equal(value(image, 16, 61), 0);
  assert.equal(value(image, 16, 42), 0);
});

test('smooth curved surfaces produce broad curvature without a triangle grid', () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8),
    new THREE.MeshBasicMaterial());
  const source = collectAmbientOcclusionGeometry([mesh], mesh, 0);
  const baker = createCurvatureBaker(source,
    { resolution: 64, width: 2, strength: 100, mode: 'convex' });
  for (let index = 0; index < baker.triangleCount; index++) baker.bakeTriangle(index);
  const image = baker.finish();
  const values = [];
  for (let index = 0; index < image.data.length; index += 4)
    if (image.data[index + 3]) values.push(image.data[index]);
  values.sort((a, b) => a - b);
  assert.ok(values[values.length >> 1] > 60);
  assert.ok(values.at(-1) - values[0] < 30);
});

test('minimum angle excludes folds below the chosen threshold', () => {
  const positions = [...face, ...convexNeighbor];
  const included = value(render(positions, 'convex', { angle: 45 }), 16, 61);
  const excluded = value(render(positions, 'convex', { angle: 100 }), 16, 61);
  assert.ok(included > 100);
  assert.ok(excluded < included / 2);
});

test('marked sharp mode follows discontinuous imported normals, not UV splits', () => {
  const positions = [...face, ...convexNeighbor];
  const smooth = [
    0, -0.7071, 0.7071, 0, -0.7071, 0.7071, 0, 0, 1,
    0, -0.7071, 0.7071, 0, -0.7071, 0.7071, 0, -1, 0
  ];
  const split = [
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, -1, 0, 0, -1, 0, 0, -1, 0
  ];
  const options = { markedSharpOnly: true, angle: 10 };
  assert.equal(value(render(positions, 'convex', { ...options,
    cornerNormals: smooth }), 16, 61), 0);
  assert.ok(value(render(positions, 'convex', { ...options,
    cornerNormals: split }), 16, 61) > 100);
});

test('curvature source preserves imported corner normals for sharp edge detection', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...face, ...convexNeighbor
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1
  ], 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, -1, 0, 0, -1, 0, 0, -1, 0
  ], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const source = collectAmbientOcclusionGeometry([mesh], mesh, 0,
    { includeCornerNormals: true });
  assert.equal(source.cornerNormals.length, source.positions.length);
  assert.equal(source.cornerNormals[2], 1);
  assert.equal(source.cornerNormals[10], -1);
});
