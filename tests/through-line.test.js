import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { sampleThroughLine } from '../src/editor/through-line.js';

test('through line starts outside the model and keeps front and back paths separate', () => {
  const object = {};
  const hitAt = (x) => x < 2 || x > 8 ? [] : [
    { object, faceIndex: x < 5 ? 0 : 1, side: 'front', uv: { x, y: 0 } },
    { object, faceIndex: x < 5 ? 2 : 3, side: 'back', uv: { x, y: 1 } }
  ];
  const paths = sampleThroughLine({ x: 0, y: 0 }, { x: 10, y: 0 }, hitAt, 1);
  assert.equal(paths.length, 2);
  assert.equal(paths[0][0], null);
  assert.equal(paths[1].at(-1), null);
  assert.ok(paths[0].some((hit) => hit?.faceIndex === 0));
  assert.ok(paths[0].some((hit) => hit?.faceIndex === 1));
  assert.ok(paths[0].every((hit) => !hit || hit.side === 'front'));
  assert.ok(paths[1].every((hit) => !hit || hit.side === 'back'));
});

test('double-sided raycasting reaches both sides of a closed mesh', () => {
  const geometry = new BoxGeometry(2, 2, 2);
  const material = new MeshBasicMaterial({ side: FrontSide });
  const mesh = new Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(0.2, 0.3, 5), new Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(mesh).every((hit) => hit.point.z > 0));
  material.side = DoubleSide;
  const hits = ray.intersectObject(mesh);
  material.side = FrontSide;
  assert.ok(hits.some((hit) => Math.abs(hit.point.z - 1) < 1e-8));
  assert.ok(hits.some((hit) => Math.abs(hit.point.z + 1) < 1e-8));
  geometry.dispose();
  material.dispose();
});
