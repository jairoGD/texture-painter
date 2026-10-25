import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSurfaceCurvePath, surfaceTriangles } from '../src/editor/surface-curve-path.js';
import { projectSurfaceCurve } from '../src/editor/surface-curve-paint.js';

function sleeve() {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 16, 1, true),
    new THREE.MeshBasicMaterial());
  const triangles = surfaceTriangles(mesh, 0, 128, 128);
  const ends = [triangles[0], triangles[16]];
  const anchors = ends.map((triangle) => ({ point: triangle.center.clone(),
    hit: { faceIndex: triangle.faceIndex } }));
  return { mesh, ends, anchors };
}

test('precise path crosses a face edge where the direct surface path meets it', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial());
  const start = new THREE.Vector3(-0.8, 0.8, 0);
  const end = new THREE.Vector3(0.8, 0.2, 0);
  const path = buildSurfaceCurvePath(mesh, 0, [
    { point: start, hit: { faceIndex: 0 } },
    { point: end, hit: { faceIndex: 1 } }
  ], 128, 128);
  assert.ok(path);
  assert.ok(Math.abs(path.length - start.distanceTo(end)) < 1e-5);
  const line = new THREE.Line3(start, end);
  for (const sample of path.samples) {
    const closest = line.closestPointToPoint(sample.point, true, new THREE.Vector3());
    assert.ok(sample.point.distanceTo(closest) < 1e-5);
  }
  assert.ok(path.samples.some((sample) => sample.point.distanceTo(
    new THREE.Vector3(4 / 11, 4 / 11, 0)) < 0.03));
});

test('antialiased projection combines coverage across adjacent triangle edges', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial());
  const path = buildSurfaceCurvePath(mesh, 0, [
    { point: new THREE.Vector3(-0.8, -0.8, 0), hit: { faceIndex: 0 } },
    { point: new THREE.Vector3(0.8, 0.8, 0), hit: { faceIndex: 1 } }
  ], 64, 64);
  const pixels = projectSurfaceCurve(path, null, { size: 40, lineStyle: 'solid',
    color: '#ffffff', hardness: 100, opacity: 100, antialias: true }, 64, 64);
  for (let y = 26; y <= 38; y++) for (let x = 26; x <= 38; x++)
    assert.equal(pixels.get(y * 64 + x)?.[3], 255);
});

test('precise path wraps across a bent face without snapping to its edge center', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, 0, 0, -1, 0, 0, 1, 0,
    0, -1, 0, 1, 0, 1, 0, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0.5, 0.5, 0, 0.5, 1,
    0.5, 0, 1, 0.5, 0.5, 1
  ], 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const path = buildSurfaceCurvePath(mesh, 0, [
    { point: new THREE.Vector3(-0.7, 0.25, 0), hit: { faceIndex: 0 } },
    { point: new THREE.Vector3(0.7, 0.25, 0.7), hit: { faceIndex: 1 } }
  ], 128, 128);
  assert.ok(path);
  assert.ok(path.samples.some((sample) => Math.abs(sample.point.x) < 0.02 &&
    Math.abs(sample.point.y - 0.25) < 0.03));
});

test('three precise anchors form a smooth surface Bezier through the middle point', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 4, 4),
    new THREE.MeshBasicMaterial());
  const triangles = surfaceTriangles(mesh, 0, 256, 256);
  const points = [[-1.5, -1], [0, 1], [1.5, -1]]
    .map(([x, y]) => new THREE.Vector3(x, y, 0));
  const anchors = points.map((point) => ({ point,
    hit: { faceIndex: triangles.find((triangle) =>
      triangle.face.containsPoint(point)).faceIndex } }));
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 256, 256);
  assert.ok(path);
  const middle = path.samples.findIndex((sample) =>
    sample.point.distanceToSquared(points[1]) < 1e-10);
  assert.ok(middle > 1 && middle < path.samples.length - 2);
  const incoming = points[1].clone().sub(path.samples[middle - 1].point).normalize();
  const outgoing = path.samples[middle + 1].point.clone().sub(points[1]).normalize();
  assert.ok(incoming.dot(outgoing) > 0.95);
  assert.ok(path.samples.every((sample) => Math.abs(sample.point.z) < 1e-8));
});

test('precise path follows connected faces around a cylinder', () => {
  const { mesh, anchors } = sleeve();
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 128, 128);
  assert.ok(path);
  assert.ok(path.length > anchors[0].point.distanceTo(anchors[1].point) * 1.4);
  assert.ok(path.samples.length > 20);
  assert.ok(path.samples.some((sample) => Math.abs(sample.point.x) > 0.7));
});

test('3D projection paints both visible and hidden sides without camera input', () => {
  const { mesh, ends, anchors } = sleeve();
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 128, 128);
  const pixels = projectSurfaceCurve(path, null, { size: 10, lineStyle: 'solid',
    color: '#ff0000', hardness: 100, opacity: 100, antialias: true }, 128, 128);
  const at = (triangle) => {
    const uv = triangle.uvs[0].clone().add(triangle.uvs[1]).add(triangle.uvs[2])
      .multiplyScalar(1 / 3);
    return Math.floor((1 - uv.y) * 128) * 128 + Math.floor(uv.x * 128);
  };
  assert.ok(pixels.size > 100);
  assert.ok(pixels.has(at(ends[0])));
  assert.ok(pixels.has(at(ends[1])));
});

test('3D texture strip keeps source alpha and colors on the sleeve', () => {
  const { mesh, anchors } = sleeve();
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 128, 128);
  const image = { width: 2, height: 2, data: new Uint8ClampedArray([
    255, 0, 0, 255, 255, 0, 0, 255,
    0, 0, 255, 255, 0, 0, 255, 255
  ]) };
  const pixels = projectSurfaceCurve(path, image, { size: 10, lineStyle: 'texture',
    opacity: 100, antialias: true, seamlessTexture: true }, 128, 128);
  assert.ok(pixels.size > 100);
  assert.ok([...pixels.values()].some((color) => color[0] > color[2]));
  assert.ok([...pixels.values()].some((color) => color[2] > color[0]));
});

test('surface route and paint cross the cylinder UV seam', () => {
  const { mesh } = sleeve();
  const triangles = surfaceTriangles(mesh, 0, 128, 128);
  const ends = [triangles[0], triangles[31]];
  const anchors = ends.map((triangle) => ({ point: triangle.center.clone(),
    hit: { faceIndex: triangle.faceIndex } }));
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 128, 128);
  assert.ok(path);
  const pixels = projectSurfaceCurve(path, null, { size: 12, lineStyle: 'solid',
    color: '#ffffff', hardness: 100, opacity: 100, antialias: true }, 128, 128);
  assert.ok([...pixels.keys()].some((pixel) => pixel % 128 < 8));
  assert.ok([...pixels.keys()].some((pixel) => pixel % 128 > 120));
});

test('mirror duplicates the 3D strip on the opposite side of the cylinder', () => {
  const { mesh, anchors } = sleeve();
  const path = buildSurfaceCurvePath(mesh, 0, anchors, 128, 128);
  const options = { size: 10, lineStyle: 'solid', color: '#00ff00',
    hardness: 100, opacity: 100, antialias: false };
  const original = projectSurfaceCurve(path, null, options, 128, 128);
  const mirrored = projectSurfaceCurve(path, null, options, 128, 128, null,
    { point: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(1, 0, 0) });
  assert.ok(mirrored.size > original.size * 1.4);
});

test('mirrored texture strip keeps its outer image edge on both outer sides', () => {
  const positions = [], uvs = [];
  const quad = (left, right, firstU, lastU) => {
    const corners = [[left, 0, 0, firstU, 0], [right, 0, 0, lastU, 0],
      [left, 2, 0, firstU, 1], [right, 2, 0, lastU, 1]];
    for (const index of [0, 1, 2, 1, 3, 2]) {
      positions.push(...corners[index].slice(0, 3));
      uvs.push(...corners[index].slice(3));
    }
  };
  quad(-1.5, -0.5, 0, 0.5);
  quad(0.5, 1.5, 0.5, 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const normal = new THREE.Vector3(0, 0, 1);
  const path = { triangles: surfaceTriangles(mesh, 0, 256, 256),
    samples: [
      { point: new THREE.Vector3(1, 0.4, 0), normal, distance: 0 },
      { point: new THREE.Vector3(1, 1.6, 0), normal, distance: 1.2 }
    ], length: 1.2 };
  const image = { width: 2, height: 2, data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 255, 255,
    255, 0, 0, 255, 0, 0, 255, 255
  ]) };
  const painted = projectSurfaceCurve(path, image, { size: 100,
    lineStyle: 'texture', opacity: 100, antialias: false }, 256, 256, null,
  { point: new THREE.Vector3(), normal: new THREE.Vector3(1, 0, 0) });
  const colorAt = (u) => painted.get(128 * 256 + Math.floor(u * 256));
  assert.deepEqual(colorAt(0.15), colorAt(0.85));
  assert.deepEqual(colorAt(0.35), colorAt(0.65));
  assert.ok(colorAt(0.15)[0] > colorAt(0.15)[2]);
  assert.ok(colorAt(0.35)[2] > colorAt(0.35)[0]);
});
