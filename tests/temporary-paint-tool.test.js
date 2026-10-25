import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTemporaryPaintTool } from '../src/editor/temporary-paint-tool.js';

test('Brush uses Blur while Shift is held and returns to Brush on release', () => {
  const settings = { brush: { size: 10, color: '#123456' },
    blur: { size: 72, strength: 20 }, eraser: { size: 30 } };
  assert.deepEqual(resolveTemporaryPaintTool('brush', settings, { shiftKey: true }),
    { kind: 'blur', options: settings.blur });
  assert.deepEqual(resolveTemporaryPaintTool('brush', settings),
    { kind: 'brush', options: settings.brush });
});

test('Ctrl uses an eraser with the Brush footprint without changing saved settings', () => {
  const settings = { brush: { size: 17, hardness: 40, opacity: 55, antialias: false },
    blur: { size: 72 }, eraser: { size: 30 } };
  assert.deepEqual(resolveTemporaryPaintTool('brush', settings, { ctrlKey: true }),
    { kind: 'eraser', options: settings.brush });
  assert.deepEqual(resolveTemporaryPaintTool('brush', settings,
    { ctrlKey: true, shiftKey: true }).kind, 'eraser');
  assert.equal(settings.eraser.size, 30);
  assert.deepEqual(resolveTemporaryPaintTool('line', { line: { size: 2 } },
    { ctrlKey: true, shiftKey: true }), { kind: 'line', options: { size: 2 } });
});
