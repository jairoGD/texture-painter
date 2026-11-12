import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBlob } from '../src/editor/download.js';

test('keeps the download link alive until the browser has started the transfer', () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalTimeout = globalThis.setTimeout;
  let cleanup;
  let removed = false;
  let revoked = false;
  let clicked = false;
  let appended = false;
  let link;
  try {
    globalThis.document = {
      body: { append(node) { appended = true; link = node; } },
      createElement() {
        return { style: {}, setAttribute() {}, click() {
          clicked = true;
          assert.equal(removed, false);
        }, remove() { removed = true; } };
      }
    };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => { revoked = true; };
    globalThis.setTimeout = (callback) => { cleanup = callback; };
    downloadBlob(new Blob(['project']), 'Test.tp3d');
    assert.equal(appended, true);
    assert.equal(clicked, true);
    assert.equal(link.href, 'blob:test');
    assert.equal(link.download, 'Test.tp3d');
    assert.equal(removed, false);
    assert.equal(revoked, false);
    cleanup();
    assert.equal(removed, true);
    assert.equal(revoked, true);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    globalThis.setTimeout = originalTimeout;
  }
});
