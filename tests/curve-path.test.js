import assert from 'node:assert/strict';
import test from 'node:test';
import { curveScreenPoints } from '../src/editor/curve-path.js';

test('curve previews a straight segment, then two adjustable Bezier handles', () => {
  const points = [
    { x: 0, y: 0 }, { x: 10, y: 0 },
    { x: 0, y: 10 }, { x: 10, y: 10 }
  ];
  const straight = curveScreenPoints(points, 0, 1);
  const firstHandle = curveScreenPoints(points, 1, 1);
  const bothHandles = curveScreenPoints(points, 2, 1);
  for (const path of [straight, firstHandle, bothHandles]) {
    assert.deepEqual(path[0], points[0]);
    assert.deepEqual(path.at(-1), points[1]);
  }
  assert.ok(straight.every((point) => point.y === 0));
  assert.ok(firstHandle.some((point) => point.y > 0));
  assert.ok(bothHandles.some((point) => point.y > 0));
  assert.notDeepEqual(firstHandle, bothHandles);
});
