import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { stampPlacement, createStampTextureSampler,
  stampScreenSize } from '../src/editor/stamp-texture.js';

const image = { width: 2, height: 2, data: new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255,
  0, 0, 255, 255, 255, 255, 255, 0
]) };

test('stamp size keeps the same world footprint as camera distance changes', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const point = new THREE.Vector3(0, 0, 0);
  camera.position.z = 5;
  const near = stampScreenSize(64, 2, camera, point, 720);
  camera.position.z = 10;
  const far = stampScreenSize(64, 2, camera, point, 720);
  assert.ok(Math.abs(near / far - 2) < 1e-10);
  const projectionScale = camera.projectionMatrix.elements[5] * 720 / 2;
  assert.ok(Math.abs(far * 10 / projectionScale - 64 * 2 / 512) < 1e-10);
});

test('a click centers the stamp and preserves image aspect ratio', () => {
  const placement = stampPlacement({ x: 50, y: 50 }, null,
    { width: 2, height: 1 }, { size: 40 });
  assert.equal(placement.width, 40);
  assert.equal(placement.height, 20);
  assert.deepEqual(placement.bounds, { left: 30, right: 70, top: 40, bottom: 60 });
});

test('stroke stretches the image from its first point along the drag', () => {
  const placement = stampPlacement({ x: 10, y: 20 }, { x: 110, y: 20 },
    image, { size: 20, stroke: true, proportionalStroke: false });
  assert.equal(placement.width, 20);
  assert.equal(placement.height, 100);
  assert.ok(Math.abs(placement.center.x - 60) < 1e-8);
  assert.ok(Math.abs(placement.center.y - 20) < 1e-8);
  assert.ok(Math.abs(placement.bounds.left - 10) < 1e-8);
  assert.ok(Math.abs(placement.bounds.right - 110) < 1e-8);
});

test('proportional stroke grows both dimensions while preserving image aspect ratio', () => {
  const source = { width: 2, height: 1 };
  const short = stampPlacement({ x: 0, y: 0 }, { x: 0, y: 20 }, source,
    { size: 64, stroke: true });
  const long = stampPlacement({ x: 0, y: 0 }, { x: 0, y: 100 }, source,
    { size: 64, stroke: true });
  assert.equal(short.width, 40);
  assert.equal(long.width, 200);
  assert.equal(long.width / long.height, source.width / source.height);
});

test('rotation changes the image direction without discarding alpha', () => {
  const placement = stampPlacement({ x: 50, y: 50 }, null,
    image, { size: 40, rotation: 90 });
  const sample = createStampTextureSampler(image, placement,
    { opacity: 50, antialias: false });
  assert.deepEqual(sample(40, 40), [0, 0, 255, 127.5]);
  assert.equal(sample(10, 10), null);
  assert.equal(sample(40, 60), null);
});
