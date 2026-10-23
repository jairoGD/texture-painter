import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Euler, Quaternion, Vector3 } from 'three';
import { resizeWarpProjection, warpProjectedUv, warpProjectionInverse,
  warpProjectionTransform } from '../src/editor/image-projection.js';

test('warp projector starts centered on the mesh bounds', () => {
  const geometry = new BoxGeometry(2, 4, 1);
  geometry.translate(3, 5, 2);
  const transform = warpProjectionTransform({}, geometry);
  assert.deepEqual(transform.position, [3, 5, 2]);
  assert.deepEqual(transform.scale, [2, 4, 4]);
  assert.deepEqual(warpProjectedUv([3, 5, 2], warpProjectionInverse(transform)), [0.5, 0.5]);
  geometry.dispose();
});

test('moving, rotating and scaling warp projection changes the sampled UV', () => {
  const base = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] };
  assert.deepEqual(warpProjectedUv([0.5, 0, 0], warpProjectionInverse(base)), [0.75, 0.5]);
  assert.deepEqual(warpProjectedUv([0.5, 0, 0], warpProjectionInverse({
    ...base, position: [0.5, 0, 0] })), [0.5, 0.5]);
  const rotated = warpProjectedUv([0.5, 0, 0], warpProjectionInverse({
    ...base, rotation: [0, 0, Math.PI / 2] }));
  assert.ok(Math.abs(rotated[0] - 0.5) < 1e-10);
  assert.ok(Math.abs(rotated[1] - 0.25) < 1e-10);
  assert.deepEqual(warpProjectedUv([0.5, 0, 0], warpProjectionInverse({
    ...base, scale: [4, 2, 2] })), [0.625, 0.5]);
  assert.equal(warpProjectedUv([2, 0, 0], warpProjectionInverse(base)), null);
});

test('box handles resize from a face or corner while anchoring the opposite side', () => {
  const original = { position: [1, 2, 3], rotation: [0, 0, Math.PI / 2],
    scale: [2, 4, 6] };
  const opposite = (transform, signs) => {
    const rotation = new Quaternion().setFromEuler(new Euler(...transform.rotation));
    return new Vector3(...transform.position).add(new Vector3(...signs.map((sign, axis) =>
      -sign * transform.scale[axis] / 2)).applyQuaternion(rotation));
  };
  for (const signs of [[1, 0, 0], [1, -1, 1]]) {
    const resized = resizeWarpProjection(original, signs, 1.5);
    assert.ok(opposite(resized, signs).distanceTo(opposite(original, signs)) < 1e-10);
    signs.forEach((sign, axis) => assert.equal(resized.scale[axis],
      original.scale[axis] * (sign ? 1.5 : 1)));
  }
});
