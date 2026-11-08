import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextureZip, planTextureExport, textureFileName, writeTexturePngs } from '../src/editor/texture-export.js';

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

test('packs texture PNGs into a valid ZIP download', async () => {
  const canvas = (content) => ({ toBlob(callback) {
    callback(new Blob([content], { type: 'image/png' }));
  } });
  const zip = await createTextureZip([
    { name: 'Body', canvas: canvas('first') },
    { name: 'Rosto', canvas: canvas('second') }
  ]);
  assert.equal(zip.type, 'application/zip');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  for (const [name, content] of [['Body.png', 'first'], ['Rosto.png', 'second']]) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const length = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    assert.equal(decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength)), name);
    assert.equal(decoder.decode(bytes.slice(offset + 30 + nameLength,
      offset + 30 + nameLength + length)), content);
    offset += 30 + nameLength + length;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 2);
});
