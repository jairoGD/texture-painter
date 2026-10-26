import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import { projectedSurfaceStrokeWidth, projectedUvStrokeWidth } from
  '../src/editor/curve-preview-width.js';

test('curve preview converts texture pixels to screen pixels at the current zoom', () => {
  const mesh = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial());
  mesh.updateMatrixWorld();
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const hit = { object: mesh, face: { a: 0, b: 2, c: 1 } };
  const viewport = { width: 1000, height: 1000 };
  const near = projectedUvStrokeWidth(hit, camera, viewport, 100, { x: 1, y: 0 });
  assert.ok(Math.abs(near - 2 / 100 * 1000 / (2 * 5 * Math.tan(Math.PI / 6))) < 1e-4);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const far = projectedUvStrokeWidth(hit, camera, viewport, 100, { x: 1, y: 0 });
  assert.ok(Math.abs(far - near / 2) < 1e-4);
});

test('precise preview projects the stroke width across its surface normal', () => {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const width = projectedSurfaceStrokeWidth(new Vector3(), new Vector3(0, 0, 1),
    new Vector3(1, 0, 0), 0.2, camera, { width: 1000, height: 1000 });
  assert.ok(Math.abs(width - 0.2 * 1000 / (2 * 5 * Math.tan(Math.PI / 6))) < 1e-4);
});
