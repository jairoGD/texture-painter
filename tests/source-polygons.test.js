import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FBXLoader } from '../src/editor/vendor/FBXLoader.js';
import { expandSourceFaces, sourceFaceRange, sourcePolygonWireGeometry } from
  '../src/editor/source-polygons.js';

test('a triangulated FBX quad remains one selectable polygon', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 1, 1, 0.2,
    0, 0, 0, 1, 1, 0.2, 0, 1, 0
  ], 3));
  geometry.userData.sourceFaceRanges = [[0, 2]];
  geometry.addGroup(0, 6, 1);
  assert.deepEqual(sourceFaceRange(geometry, 1), [0, 2]);
  assert.deepEqual([...expandSourceFaces(geometry, new Set([1]))], [0, 1]);
  const wire = sourcePolygonWireGeometry(geometry);
  assert.equal(wire.getAttribute('position').count, 8);
  assert.equal(wire.groups[0].materialIndex, 1);
  wire.dispose();
  geometry.dispose();
});

test('meshes without FBX polygon metadata keep triangle selection', () => {
  const geometry = new THREE.BufferGeometry();
  assert.deepEqual([...expandSourceFaces(geometry, new Set([3]))], [3]);
  geometry.dispose();
});

test('FBX import retains source quad boundaries beside rendered triangles', () => {
  const ascii = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXVersion: 7400
}
Objects:  {
\tGeometry: 1, "Geometry::Quad", "Mesh" {
\t\tVertices: *12 {
\t\t\ta: 0,0,0,1,0,0,1,1,0,0,1,0
\t\t}
\t\tPolygonVertexIndex: *4 {
\t\t\ta: 0,1,2,-4
\t\t}
\t\tLayerElementUV: 0 {
\t\t\tMappingInformationType: "ByPolygonVertex"
\t\t\tReferenceInformationType: "Direct"
\t\t\tUV: *8 {
\t\t\t\ta: 0,0,1,0,1,1,0,1
\t\t\t}
\t\t}
\t}
\tModel: 2, "Model::Quad", "Mesh" {
\t}
}
Connections:  {
\tC: "OO",1,2
\tC: "OO",2,0
}`;
  const bytes = new TextEncoder().encode(ascii);
  const group = new FBXLoader().parse(bytes.buffer, '');
  const mesh = group.children.find((child) => child.isMesh);
  assert.ok(mesh);
  assert.equal(mesh.geometry.getAttribute('position').count, 6);
  assert.deepEqual(mesh.geometry.userData.sourceFaceRanges, [[0, 2]]);
  assert.equal(mesh.geometry.getAttribute('uv').count, 6);
});
