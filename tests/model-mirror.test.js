import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createModelMirror } from '../src/editor/model-mirror.js';

test('mirror finds the opposite surface of a transformed model', () => {
  const root = new THREE.Group();
  root.position.set(3, 0, 0);
  root.rotation.y = Math.PI / 5;
  root.scale.setScalar(2);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateWorldMatrix(true, true);
  const right = root.localToWorld(new THREE.Vector3(3, 0, 0));
  const direction = root.localToWorld(new THREE.Vector3(2, 0, 0)).sub(right).normalize();
  const hit = new THREE.Raycaster(right, direction).intersectObject(mesh)[0];
  const mirrored = createModelMirror(root, [mesh])(hit);
  assert.ok(mirrored?.uv);
  assert.ok(Math.abs(root.worldToLocal(mirrored.point.clone()).x + 1) < 1e-5);
  assert.equal(createModelMirror(root, [mesh])(null), null);
});
