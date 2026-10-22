import assert from 'node:assert/strict';
import test from 'node:test';
import { canConnectSurfaceHits, sampleScreenStroke } from '../src/editor/surface-stroke.js';

test('a screen stroke follows both sides of a UV seam without bridging the atlas', () => {
  const mesh = {};
  const hitAt = (x) => ({ object: mesh, faceIndex: x < 5 ? 0 : 1,
    uv: { x: x < 5 ? x / 100 : 0.7 + x / 100, y: 0.5 } });
  const hits = sampleScreenStroke({ x: 0, y: 0 }, { x: 10, y: 0 }, hitAt, 2);
  const before = hits.filter((hit) => hit.faceIndex === 0).at(-1);
  const after = hits.find((hit) => hit.faceIndex === 1);
  assert.ok(before.uv.x > 0.04, 'the first island is painted up to its edge');
  assert.ok(after.uv.x < 0.76, 'the second island starts at its edge');
  assert.equal(canConnectSurfaceHits(before, after,
    { x: before.uv.x * 1024, y: 0 }, { x: after.uv.x * 1024, y: 0 }, 1024), false);
  assert.equal(canConnectSurfaceHits(hits[0], hits[1],
    { x: 0, y: 0 }, { x: hits[1].uv.x * 1024, y: 0 }, 1024), true);
});
