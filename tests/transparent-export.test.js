import assert from 'node:assert/strict';
import test from 'node:test';
import { addGraphLayer } from '../src/editor/layer-graph.js';
import { addTextureNode, connectTextureNodes, createTextureGraph,
  renderTextureGraph } from '../src/editor/texture-graph.js';

function pixelCanvas(rgba = [0, 0, 0, 0]) {
  const canvas = { width: 1, height: 1, pixels: new Uint8ClampedArray(rgba) };
  const context = {
    fillStyle: '#ffffff', globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() {}, restore() {},
    clearRect() { canvas.pixels.fill(0); },
    fillRect() {
      const color = context.fillStyle;
      canvas.pixels.set([parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255]);
    },
    drawImage(source) {
      const top = source.pixels;
      const bottom = canvas.pixels;
      const topAlpha = top[3] / 255 * context.globalAlpha;
      const bottomAlpha = bottom[3] / 255;
      const alpha = topAlpha + bottomAlpha * (1 - topAlpha);
      if (!alpha) return;
      for (let channel = 0; channel < 3; channel++)
        bottom[channel] = (top[channel] * topAlpha +
          bottom[channel] * bottomAlpha * (1 - topAlpha)) / alpha;
      bottom[3] = alpha * 255;
    },
    getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(canvas.pixels) }; },
    createImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray(4) }; },
    putImageData(image) { canvas.pixels.set(image.data); }
  };
  canvas.getContext = () => context;
  return canvas;
}

test('export keeps layer alpha while the viewport composite stays opaque', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => pixelCanvas() };
  try {
    const graph = createTextureGraph();
    const layer = addGraphLayer(graph, 'image');
    layer.source.imageKey = 'paint';
    const imageAssets = new Map([['paint', { canvas: pixelCanvas([200, 40, 20, 128]), revision: 0 }]]);
    for (const mode of ['mix', 'linearLight']) {
      layer.mix.mode = mode;
      const result = pixelCanvas();
      const surface = { graph, canvas: result, compositeCanvas: result,
        compositeContext: result.getContext('2d'), texture: { needsUpdate: false },
        imageAssets, imageCache: new Map(), transparentBase: true };
      renderTextureGraph(surface);
      assert.deepEqual([...result.pixels], [200, 40, 20, 128], mode);
    }
    const viewport = pixelCanvas();
    renderTextureGraph({ graph, canvas: viewport, compositeCanvas: viewport,
      compositeContext: viewport.getContext('2d'), texture: { needsUpdate: false },
      imageAssets, imageCache: new Map() });
    assert.equal(viewport.pixels[3], 255);
  } finally { globalThis.document = oldDocument; }
});

test('export keeps partial alpha after a Factor image mask', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => pixelCanvas() };
  try {
    const graph = createTextureGraph();
    const layer = addGraphLayer(graph, 'image');
    layer.source.imageKey = 'paint';
    const mask = addTextureNode(graph, 'image', { x: 0, y: 0 });
    mask.imageKey = 'mask';
    connectTextureNodes(graph, mask.id, 'Color', layer.mix.id, 'Factor');
    const result = pixelCanvas();
    renderTextureGraph({ graph, canvas: result, compositeCanvas: result,
      compositeContext: result.getContext('2d'), texture: { needsUpdate: false },
      transparentBase: true, imageCache: new Map(),
      imageAssets: new Map([
        ['paint', { canvas: pixelCanvas([200, 40, 20, 128]), revision: 0 }],
        ['mask', { canvas: pixelCanvas([255, 255, 255, 128]), revision: 0 }]
      ]) });
    assert.deepEqual([...result.pixels], [200, 40, 20, 64]);
  } finally { globalThis.document = oldDocument; }
});
