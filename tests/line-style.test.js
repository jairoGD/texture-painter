import assert from 'node:assert/strict';
import test from 'node:test';
import { lineStylePaths, styledPolylinePaths } from '../src/editor/line-style.js';

test('continuous line keeps the original endpoints', () => {
  const start = { x: 3, y: 4 }, end = { x: 43, y: 4 };
  assert.deepEqual(lineStylePaths(start, end, { lineStyle: 'solid' }), [[start, end]]);
});

test('dashed line uses exact dash and spacing lengths', () => {
  const paths = lineStylePaths({ x: 0, y: 0 }, { x: 45, y: 0 },
    { lineStyle: 'dashed', dashLength: 10, dashGap: 5 });
  assert.deepEqual(paths.map(([first, last]) => [first.x, last.x]),
    [[0, 10], [15, 25], [30, 40]]);
});

test('wavy line retains endpoints and moves to either side of the baseline', () => {
  const paths = lineStylePaths({ x: 0, y: 0 }, { x: 100, y: 0 },
    { lineStyle: 'wavy', waveHeight: 8, waveSpacing: 24 });
  assert.deepEqual(paths[0][0], { x: 0, y: 0 });
  assert.ok(Math.abs(paths[0].at(-1).x - 100) < 1e-8);
  assert.ok(Math.abs(paths[0].at(-1).y) < 1e-8);
  assert.ok(paths[0].some((point) => point.y > 7));
  assert.ok(paths[0].some((point) => point.y < -7));
});

test('curve dashes keep their phase across a bend', () => {
  const paths = styledPolylinePaths([{ x: 0, y: 0 }, { x: 20, y: 0 },
    { x: 20, y: 20 }], { lineStyle: 'dashed', dashLength: 15, dashGap: 5 });
  assert.deepEqual(paths, [
    [{ x: 0, y: 0 }, { x: 15, y: 0 }],
    [{ x: 20, y: 0 }, { x: 20, y: 15 }]
  ]);
});

test('curve waves follow the local tangent and retain both endpoints', () => {
  const paths = styledPolylinePaths([{ x: 0, y: 0 }, { x: 40, y: 0 },
    { x: 40, y: 40 }], { lineStyle: 'wavy', waveHeight: 6, waveSpacing: 20 }, 1);
  const points = paths[0];
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.ok(Math.abs(points.at(-1).x - 40) < 1e-8);
  assert.ok(Math.abs(points.at(-1).y - 40) < 1e-8);
  assert.ok(points.some((point) => point.y > 5 && point.y < 35 && point.x < 35));
  assert.ok(points.some((point) => point.y > 5 && point.y < 35 && point.x > 45));
});
