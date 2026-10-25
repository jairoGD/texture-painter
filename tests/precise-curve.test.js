import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { preciseCurveScreenPoints } from '../src/editor/precise-curve.js';

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 2);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
const rect = { left: 10, top: 20, width: 200, height: 200 };

test('precise anchors remain on their projected 3D positions', () => {
  const anchors = [
    { point: new THREE.Vector3(-0.5, 0, 0) },
    { point: new THREE.Vector3(0, 0.5, 0.2) },
    { point: new THREE.Vector3(0.5, 0, 0) }
  ];
  const points = preciseCurveScreenPoints(anchors, camera, rect, 2);
  assert.ok(points.length > 10);
  assert.ok(Math.abs(points[0].x - 60) < 1e-6);
  assert.ok(Math.abs(points[0].y - 120) < 1e-6);
  assert.ok(Math.abs(points.at(-1).x - 160) < 1e-6);
  assert.ok(Math.abs(points.at(-1).y - 120) < 1e-6);
  assert.ok(points.some((point) => point.y < 100));
});

test('two anchors form a connected surface guide', () => {
  const points = preciseCurveScreenPoints([
    new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 0, 0)
  ], camera, rect, 2);
  assert.equal(points[0].x, 60);
  assert.equal(points.at(-1).x, 160);
  assert.ok(points.every((point) => Math.abs(point.y - 120) < 1e-6));
});
