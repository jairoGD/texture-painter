import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { surfaceWandTopology } from '../src/editor/surface-wand-topology.js';
import { wandSelectionMask } from '../src/editor/wand-selection.js';
import { hideGeometryFaces } from '../src/editor/face-visibility.js';

function triangleGeometry() {
  const geometry = new THREE.BufferGeometry();
  // The first two triangles share a 3D edge but live on separate UV islands.
  // The third touches the second in UV space but is disconnected in 3D.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
    5, 0, 0, 6, 0, 0, 5, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0.05, 0.05, 0.35, 0.05, 0.05, 0.95,
    0.55, 0.05, 0.85, 0.05, 0.55, 0.95,
    0.85, 0.05, 0.99, 0.05, 0.85, 0.95
  ], 2));
  return geometry;
}

test('surface wand crosses a UV seam but not a disconnected face touching in UV', () => {
  const width = 64;
  const geometry = triangleGeometry();
  const topology = surfaceWandTopology(geometry, 0, width);
  const image = { width, height: width, data: new Uint8ClampedArray(width * width * 4) };
  const first = topology.owners.indexOf(1);
  const second = topology.owners.indexOf(2);
  const third = topology.owners.indexOf(3);
  assert.ok(first >= 0 && second >= 0 && third >= 0);
  const x = first % width, y = Math.floor(first / width);
  const surface = wandSelectionMask(image, x, y, 0, false, topology, 0);
  assert.equal(surface[first], 255);
  assert.equal(surface[second], 255);
  assert.equal(surface[third], 0);
  const uv = wandSelectionMask(image, x, y, 0);
  assert.equal(uv[second], 255); // Empty atlas pixels remain connected in UV mode.
});

test('surface wand stops at a painted boundary on the neighboring UV island', () => {
  const width = 64;
  const topology = surfaceWandTopology(triangleGeometry(), 0, width);
  const data = new Uint8ClampedArray(width * width * 4);
  for (let i = 0; i < topology.owners.length; i++) {
    if (topology.owners[i] !== 2) continue;
    data[i * 4] = 255;
    data[i * 4 + 3] = 255;
  }
  const first = topology.owners.indexOf(1);
  const second = topology.owners.indexOf(2);
  const mask = wandSelectionMask({ width, height: width, data },
    first % width, Math.floor(first / width), 0, false, topology, 0);
  assert.equal(mask[first], 255);
  assert.equal(mask[second], 0);
});

test('surface wand excludes faces hidden by Geometry selection', () => {
  const geometry = triangleGeometry();
  assert.equal(hideGeometryFaces(geometry, new Set([1])), true);
  const topology = surfaceWandTopology(geometry, 0, 64);
  assert.ok(topology.owners.includes(1));
  assert.equal(topology.owners.includes(2), false);
  assert.ok(topology.owners.includes(3));
});
