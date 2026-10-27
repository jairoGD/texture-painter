import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector2, Vector3 } from 'three';
import { isDuplicateMirrorHit } from '../src/editor/mirror-hit-filter.js';

test('vertex mirror accepts a different surface at the same UV', () => {
  const object = {};
  const hit = { object, face: { materialIndex: 0 }, faceIndex: 0,
    uv: new Vector2(0.3, 0.4), point: new Vector3(-1, 0, 0) };
  const mirror = { object, face: { materialIndex: 0 }, faceIndex: 1,
    uv: new Vector2(0.3, 0.4), point: new Vector3(1, 0, 0) };
  assert.equal(isDuplicateMirrorHit(hit, mirror, 1024), true);
  assert.equal(isDuplicateMirrorHit(hit, mirror, 1024, true), false);
});
