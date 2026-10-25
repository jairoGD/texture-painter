import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { projectGradient, rasterizeProjectedUv } from '../src/editor/gradient-projection.js';
import { reflectedCamera } from '../src/editor/model-mirror.js';

function fixture() {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return { mesh, camera };
}

test('gradient projects its endpoints across the UV image', () => {
  const { mesh, camera } = fixture();
  const { values, covered } = projectGradient({ mesh, materialIndex: 0, camera,
    width: 16, height: 16, viewportWidth: 100, viewportHeight: 100,
    start: { x: 0, y: 50 }, end: { x: 100, y: 50 } });
  assert.equal(covered[8 * 16 + 2], 1);
  assert.equal(covered[8 * 16 + 13], 1);
  assert.ok(values[8 * 16 + 2] < values[8 * 16 + 13]);
});

test('projected UV raster reports the screen footprint of a texel', () => {
  const { mesh, camera } = fixture();
  let footprint = null;
  rasterizeProjectedUv({ mesh, materialIndex: 0, camera, width: 10, height: 10,
    viewportWidth: 100, viewportHeight: 100, screenDerivatives: true },
  (pixel, sx, sy, derivatives) => {
    if (pixel === 5 * 10 + 5) footprint = derivatives;
  });
  assert.ok(footprint);
  assert.ok(Math.abs(footprint[0] - 10) < 1e-5);
  assert.ok(Math.abs(footprint[3] - 10) < 1e-5);
});

test('gradient respects the selected pixels and selected material', () => {
  const { mesh, camera } = fixture();
  const selection = new Uint8Array(16 * 16);
  selection[8 * 16 + 8] = 255;
  const settings = { mesh, camera, width: 16, height: 16,
    viewportWidth: 100, viewportHeight: 100, start: { x: 0, y: 0 },
    end: { x: 100, y: 100 }, selection };
  const selected = projectGradient({ ...settings, materialIndex: 0 });
  assert.equal(selected.covered.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(projectGradient({ ...settings, materialIndex: 1 }).covered[8 * 16 + 8], 0);
});

test('front projection consults visibility, X-ray includes hidden pixels', () => {
  const { mesh, camera } = fixture();
  const settings = { mesh, materialIndex: 0, camera, width: 8, height: 8,
    viewportWidth: 100, viewportHeight: 100, start: { x: 0, y: 0 },
    end: { x: 100, y: 100 } };
  const front = projectGradient({ ...settings, visibleUv: () => false });
  const xray = projectGradient(settings);
  assert.equal(front.covered[4 * 8 + 4], 0);
  assert.equal(xray.covered[4 * 8 + 4], 1);
});

test('mirrored gradient gives symmetric model points identical color values', () => {
  const { camera } = fixture();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 2, 1),
    new THREE.MeshBasicMaterial());
  const plane = { point: new THREE.Vector3(0, 0, 0),
    normal: new THREE.Vector3(1, 0, 0) };
  const settings = { mesh, materialIndex: 0, width: 16, height: 16,
    viewportWidth: 100, viewportHeight: 100, start: { x: 0, y: 50 },
    end: { x: 100, y: 50 }, mirrorPlane: plane };
  const source = projectGradient({ ...settings, camera, side: -1 });
  const mirror = projectGradient({ ...settings,
    camera: reflectedCamera(camera, plane.point, plane.normal),
    side: 1, includePlane: false, flipScreenX: true });
  assert.equal(source.covered[8 * 16 + 3], 1);
  assert.equal(mirror.covered[8 * 16 + 12], 1);
  assert.equal(source.values[8 * 16 + 3], mirror.values[8 * 16 + 12]);
});
