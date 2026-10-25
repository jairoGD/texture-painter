import test from 'node:test';
import assert from 'node:assert/strict';
import { joinedSeamPixels, selectionBorderAt } from '../src/editor/lasso-selection.js';

test('a selected UV seam does not create an internal Wand outline', () => {
  const width = 8;
  const left = 3 * width + 2;
  const right = 3 * width + 5;
  const alpha = new Uint8Array(width * width);
  alpha[left] = alpha[right] = 255;
  const owners = new Uint32Array(alpha.length);
  owners[left] = 1;
  owners[right] = 2;
  const topology = { owners, portals: new Map([[left, new Set([right])],
    [right, new Set([left])]]) };
  const joined = joinedSeamPixels(alpha, topology, width);
  assert.equal(selectionBorderAt(alpha, topology, joined, left, left + 1), false);
  assert.equal(selectionBorderAt(alpha, topology, joined, right, right - 1), false);
  assert.equal(selectionBorderAt(alpha, topology, joined, left, right), false);
  owners[left + width] = 1;
  assert.equal(selectionBorderAt(alpha, topology, joined, left, left + width), true);
});

test('an unselected face across a seam keeps a visible boundary', () => {
  const width = 8;
  const left = 3 * width + 2;
  const right = 3 * width + 5;
  const alpha = new Uint8Array(width * width);
  alpha[left] = 255;
  const owners = new Uint32Array(alpha.length);
  owners[left] = 1;
  owners[right] = 2;
  const topology = { owners, portals: new Map([[left, new Set([right])]]) };
  const joined = joinedSeamPixels(alpha, topology, width);
  assert.equal(selectionBorderAt(alpha, topology, joined, left, left + 1), true);
});
