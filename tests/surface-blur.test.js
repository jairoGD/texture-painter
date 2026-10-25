import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { executePaintCommand } from '../src/editor/paint-operations.js';
import { renderFilterRegion } from '../src/editor/filter-effects.js';
import { surfaceWandTopology } from '../src/editor/surface-wand-topology.js';

function seamGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0.05, 0.05, 0.35, 0.05, 0.05, 0.95,
    0.55, 0.05, 0.85, 0.05, 0.55, 0.95
  ], 2));
  return geometry;
}

function paintSurface(width, topology) {
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let index = 0; index < topology.owners.length; index++) {
    if (!topology.owners[index]) continue;
    pixels.set(topology.owners[index] === 1 ? [255, 0, 0, 255] : [0, 0, 255, 255],
      index * 4);
  }
  const surface = { canvas: { width, height: width }, requestComposite() {},
    context: {
      getImageData(left, top, areaWidth, areaHeight) {
        const data = new Uint8ClampedArray(areaWidth * areaHeight * 4);
        for (let y = 0; y < areaHeight; y++) for (let x = 0; x < areaWidth; x++)
          data.set(pixels.subarray(((top + y) * width + left + x) * 4,
            ((top + y) * width + left + x) * 4 + 4), (y * areaWidth + x) * 4);
        return { width: areaWidth, height: areaHeight, data };
      },
      putImageData(image, left, top) {
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
          pixels.set(image.data.subarray((y * image.width + x) * 4,
            (y * image.width + x) * 4 + 4), ((top + y) * width + left + x) * 4);
      }
    } };
  return { surface, pixels };
}

test('surface blur samples color across a UV seam while UV blur does not', () => {
  const width = 64;
  const topology = surfaceWandTopology(seamGeometry(), 0, width);
  const portal = [...topology.portals.keys()].find((index) => topology.owners[index] === 1);
  assert.ok(portal !== undefined);
  const x = portal % width, y = Math.floor(portal / width);
  const options = { size: 9, spread: 4, hardness: 100, strength: 100 };
  const uv = paintSurface(width, topology);
  const surface = paintSurface(width, topology);
  const remote = [...topology.portals.get(portal)]
    .find((index) => topology.owners[index] === 2);
  assert.ok(remote !== undefined);
  executePaintCommand({ kind: 'blur', surface: uv.surface,
    point: { x: x + 0.5, y: y + 0.5 }, previous: null, options });
  const command = { kind: 'blur', surface: surface.surface,
    point: { x: x + 0.5, y: y + 0.5 }, previous: null, options, topology };
  executePaintCommand(command);
  assert.equal(uv.pixels[portal * 4 + 2], 0);
  assert.ok(surface.pixels[portal * 4 + 2] > 0);
  assert.equal(uv.pixels[remote * 4], 0);
  assert.ok(surface.pixels[remote * 4] > 0,
    'a dab on one UV island must also change the connected island');
  assert.ok(command.dirtyRegions.some((region) =>
    remote % width >= region.left && remote % width < region.right &&
    Math.floor(remote / width) >= region.top && Math.floor(remote / width) < region.bottom),
  'the remote island must be included in compositing and undo');
});

test('isolated selection prevents surface blur from sampling across its boundary', () => {
  const width = 64;
  const topology = surfaceWandTopology(seamGeometry(), 0, width);
  const portal = [...topology.portals.keys()].find((index) => topology.owners[index] === 1);
  const x = portal % width, y = Math.floor(portal / width);
  const { surface, pixels } = paintSurface(width, topology);
  const alpha = Uint8Array.from(topology.owners, (owner) => owner === 1 ? 255 : 0);
  executePaintCommand({ kind: 'blur', surface, topology,
    point: { x: x + 0.5, y: y + 0.5 }, previous: null,
    options: { size: 9, spread: 4, hardness: 100, strength: 100 },
    mask: { alpha }, isolateBlur: true });
  assert.equal(pixels[portal * 4 + 2], 0);
});

test('blur filter reads the connected UV island in surface mode', () => {
  const width = 64;
  const topology = surfaceWandTopology(seamGeometry(), 0, width);
  const portal = [...topology.portals.keys()].find((index) => topology.owners[index] === 1);
  const { pixels } = paintSurface(width, topology);
  const source = { width, height: width, data: pixels };
  const rect = { left: 0, top: 0, right: width, bottom: width };
  const oldDocument = globalThis.document, oldImageData = globalThis.ImageData;
  // The small canvas stub passes pixels through. This isolates the filter's
  // seam sampling from the browser's own Gaussian implementation.
  globalThis.ImageData = class {
    constructor(data, imageWidth, imageHeight) {
      if (typeof data === 'number') {
        this.width = data; this.height = imageWidth;
        this.data = new Uint8ClampedArray(data * imageWidth * 4);
      } else {
        this.width = imageWidth; this.height = imageHeight; this.data = data;
      }
    }
  };
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, pixels: null };
    canvas.getContext = () => ({
      putImageData(image) { canvas.pixels = new Uint8ClampedArray(image.data); },
      drawImage(input) { canvas.pixels = new Uint8ClampedArray(input.pixels); },
      getImageData() { return { width: canvas.width, height: canvas.height,
        data: new Uint8ClampedArray(canvas.pixels) }; }
    });
    return canvas;
  } };
  try {
    const args = { source, sourceRect: rect, dirtyRect: rect, textureWidth: width,
      category: 'blur', settings: { depth: 4, mosaic: 1 }, fullSource: source };
    const uv = renderFilterRegion(args);
    const surface = renderFilterRegion({ ...args, topology });
    assert.equal(uv.data[portal * 4 + 2], 0);
    assert.ok(surface.data[portal * 4 + 2] > 0);
  } finally {
    globalThis.document = oldDocument;
    globalThis.ImageData = oldImageData;
  }
});
