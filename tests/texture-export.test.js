import test from 'node:test';
import assert from 'node:assert/strict';
import { planTextureExport, textureFileName, writeTexturePngs } from '../src/editor/texture-export.js';

test('export names use material labels and safe PNG filenames', () => {
  assert.equal(textureFileName('Face'), 'Face.png');
  assert.equal(textureFileName('Body/Clothes '), 'Body_Clothes.png');
  assert.equal(textureFileName('CON'), '_CON.png');
  assert.equal(textureFileName('  '), null);
  assert.deepEqual(planTextureExport([
    { name: 'Body' }, { name: 'Face' }
  ]).map((item) => item.fileName), ['Body.png', 'Face.png']);
  assert.throws(() => planTextureExport([
    { name: 'Body' }, { name: 'body' }
  ]), /Duplicate export name/);
});

test('exports every selected material canvas to the chosen folder', async () => {
  const written = [];
  const directory = { async getFileHandle(name) {
    return { async createWritable() {
      return { async write(blob) { written.push({ name, blob }); },
        async close() {}, async abort() {} };
    } };
  } };
  const canvas = { toBlob(callback, type) { callback(new Blob(['png'], { type })); } };
  const progress = [];
  const count = await writeTexturePngs(directory, [
    { name: 'Body', canvas }, { name: 'Face', canvas }
  ], (done, total) => progress.push([done, total]));
  assert.equal(count, 2);
  assert.deepEqual(written.map((item) => item.name), ['Body.png', 'Face.png']);
  assert.ok(written.every((item) => item.blob.type === 'image/png'));
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});
