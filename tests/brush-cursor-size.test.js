import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Vector3 } from 'three';
import { bitmapBrushDiameter, vertexBrushDiameter } from
  '../src/editor/brush-cursor-size.js';

function fixture() {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([
    -1, -1, 0, 1, -1, 0, -1, 1, 0
  ], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.updateWorldMatrix(true, false);
  const camera = new PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return { mesh, camera, hit: { object: mesh, point: new Vector3(-0.5, -0.5, 0),
    face: { a: 0, b: 1, c: 2 } }, viewport: { width: 1000, height: 1000 } };
}

test('bitmap cursor follows texture texels and camera zoom', () => {
  const { camera, hit, viewport } = fixture();
  const diameter = bitmapBrushDiameter(hit, camera, viewport, 100, 20);
  assert.ok(Math.abs(diameter - 20) < 0.1);
  assert.ok(Math.abs(bitmapBrushDiameter(hit, camera, viewport,
    { width: 200, height: 100 }, 20) - 20 / Math.SQRT2) < 0.1);
  camera.position.z = 5;
  camera.updateMatrixWorld(true);
  assert.ok(Math.abs(bitmapBrushDiameter(hit, camera, viewport, 100, 20) - 40) < 0.1);
});

test('vertex cursor matches the size of the local paint sphere', () => {
  const { camera, hit, viewport } = fixture();
  const diameter = vertexBrushDiameter(hit, camera, viewport, 40);
  assert.ok(diameter > 39 && diameter < 42);
  assert.ok(Math.abs(vertexBrushDiameter(hit, camera, viewport, 80) / diameter - 2) < 0.05);
});
