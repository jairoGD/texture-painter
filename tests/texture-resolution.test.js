import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVisibleUv } from '../src/editor/screen-lasso.js';
import { setTextureResolution, textureResolution } from '../src/editor/texture-resolution.js';

test('UV lookup follows the project texture resolution', () => {
  const pixels = Uint8Array.from([127, 255, 127, 255]);
  try {
    setTextureResolution(512);
    const small = decodeVisibleUv(pixels, 1, 1, 0, 0);
    setTextureResolution(2048);
    const large = decodeVisibleUv(pixels, 1, 1, 0, 0);
    assert.ok(large.x > small.x * 3);
    assert.ok(large.y > small.y * 3);
    assert.equal(textureResolution, 2048);
    assert.throws(() => setTextureResolution(123), /Unsupported texture resolution/);
  } finally { setTextureResolution(1024); }
});
