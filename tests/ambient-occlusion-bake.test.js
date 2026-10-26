import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAmbientOcclusionBaker } from '../src/editor/ambient-occlusion-bake.js';
import { collectAmbientOcclusionGeometry } from '../src/editor/ambient-occlusion-source.js';

const target = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const uv = [0, 1, 1, 1, 0, 0];
const options = { resolution: 32, samples: 64, strength: 100, distance: 100 };

function bake(positions) {
  const source = { positions: new Float32Array(positions),
    targetTriangles: new Uint32Array([0]), targetUvs: new Float32Array(uv),
    diagonal: 4 };
  const baker = createAmbientOcclusionBaker(source, options);
  baker.bakeTriangle(0);
  return baker.finish();
}

test('ambient occlusion leaves an unoccluded surface white', () => {
  const image = bake(target);
  const interior = (22 * 32 + 8) * 4;
  assert.equal(image.data[interior], 255);
  assert.equal(image.data[interior + 3], 255);
  assert.equal(image.data[(0 * 32 + 31) * 4 + 3], 0);
});

test('ambient occlusion darkens a surface beneath nearby geometry', () => {
  const roof = [-2, -2, 0.2, 3, -2, 0.2, -2, 3, 0.2,
    3, -2, 0.2, 3, 3, 0.2, -2, 3, 0.2];
  const image = bake([...target, ...roof]);
  const interior = (22 * 32 + 8) * 4;
  assert.ok(image.data[interior] < 200);
  assert.equal(image.data[interior + 3], 255);
});

test('ambient occlusion gathers UV faces only from the selected material', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    2, 0, 0, 3, 0, 0, 2, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1
  ], 2));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const mesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial()]);
  const source = collectAmbientOcclusionGeometry([mesh], mesh, 1);
  assert.deepEqual([...source.targetTriangles], [1]);
  assert.deepEqual([...source.targetUvs], [0, 1, 1, 1, 0, 0]);
});

test('smooth shading averages the normals across shared vertices', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 1
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1
  ], 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const source = collectAmbientOcclusionGeometry([mesh], mesh, 0);
  const first = [...source.targetNormals.slice(0, 3)];
  const shared = [...source.targetNormals.slice(9, 12)];
  assert.deepEqual(first, shared);
  assert.ok(first[0] > 0.6 && first[2] > 0.6);
});

test('shade smooth uses interpolated normals when casting AO rays', () => {
  const wall = [0.45, -2, 0, 0.45, 3, 0, 0.45, -2, 2,
    0.45, 3, 0, 0.45, 3, 2, 0.45, -2, 2];
  const source = { positions: new Float32Array([...target, ...wall]),
    targetTriangles: new Uint32Array([0]), targetUvs: new Float32Array(uv),
    targetNormals: new Float32Array([0.8, 0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6]),
    diagonal: 4 };
  const render = (shadeSmooth) => {
    const baker = createAmbientOcclusionBaker(source, { ...options, shadeSmooth });
    baker.bakeTriangle(0);
    return baker.finish().data[(22 * 32 + 8) * 4];
  };
  assert.ok(render(true) < render(false));
});

test('ignoring nearby objects removes other meshes from AO occluders', () => {
  const targetGeometry = new THREE.BufferGeometry();
  targetGeometry.setAttribute('position', new THREE.Float32BufferAttribute(target, 3));
  targetGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1
  ], 2));
  const targetMesh = new THREE.Mesh(targetGeometry, new THREE.MeshBasicMaterial());
  const roofGeometry = new THREE.BufferGeometry();
  roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -2, -2, 0.2, 3, -2, 0.2, -2, 3, 0.2,
    3, -2, 0.2, 3, 3, 0.2, -2, 3, 0.2
  ], 3));
  const roofMesh = new THREE.Mesh(roofGeometry, new THREE.MeshBasicMaterial());
  const all = collectAmbientOcclusionGeometry([targetMesh, roofMesh], targetMesh, 0);
  const isolated = collectAmbientOcclusionGeometry([targetMesh, roofMesh], targetMesh, 0,
    { selfOcclusionOnly: true });
  assert.equal(all.positions.length / 9, 3);
  assert.equal(isolated.positions.length / 9, 1);
  const pixel = (22 * 32 + 8) * 4;
  const render = (source) => {
    const baker = createAmbientOcclusionBaker(source, options);
    baker.bakeTriangle(0);
    return baker.finish().data[pixel];
  };
  assert.ok(render(all) < 200);
  assert.equal(render(isolated), 255);
});
