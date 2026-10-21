import assert from 'node:assert/strict';
import test from 'node:test';
import { executePaintCommand } from '../src/editor/paint-operations.js';

function paintSurface(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const surface = {
    canvas: { width, height },
    context: {
      getImageData(left, top, areaWidth, areaHeight) {
        const data = new Uint8ClampedArray(areaWidth * areaHeight * 4);
        for (let y = 0; y < areaHeight; y++) for (let x = 0; x < areaWidth; x++) {
          const source = ((top + y) * width + left + x) * 4;
          data.set(pixels.subarray(source, source + 4), (y * areaWidth + x) * 4);
        }
        return { width: areaWidth, height: areaHeight, data };
      },
      putImageData(image, left, top) {
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const target = ((top + y) * width + left + x) * 4;
          pixels.set(image.data.subarray((y * image.width + x) * 4,
            (y * image.width + x) * 4 + 4), target);
        }
      }
    },
    requestComposite() {}
  };
  const pixel = (x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  return { surface, pixels, pixel };
}

test('blur spreads paint alpha without mixing transparent black into its color', () => {
  const { surface, pixels, pixel } = paintSurface(7, 7);
  pixels.set([255, 64, 16, 255], (3 * 7 + 3) * 4);
  const changed = executePaintCommand({ kind: 'blur', surface,
    point: { x: 3.5, y: 3.5 }, previous: null,
    options: { size: 7, spread: 3, hardness: 100, strength: 20 } });
  assert.equal(changed, true);
  assert.ok(pixel(3, 3)[3] < 255, 'the center loses some opacity');
  assert.ok(pixel(4, 3)[3] > 0, 'color reaches a formerly transparent neighbor');
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const [red, green, blue, alpha] = pixel(x, y);
    if (alpha > 0) assert.deepEqual([red, green, blue], [255, 64, 16]);
  }
});

test('blur still blends colors across opaque pixels', () => {
  const { surface, pixels, pixel } = paintSurface(7, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++)
    pixels.set(x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 7 + x) * 4);
  executePaintCommand({ kind: 'blur', surface,
    point: { x: 3.5, y: 3.5 }, previous: null,
    options: { size: 7, spread: 3, hardness: 100, strength: 100 } });
  const [red, , blue, alpha] = pixel(3, 3);
  assert.ok(red > 0 && red < 255 && blue > 0 && blue < 255);
  assert.equal(alpha, 255);
});
