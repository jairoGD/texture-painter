import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProject, PROJECT_VERSION } from '../src/editor/project-file.js';

function project(model) {
  return JSON.stringify({ format: 'tp3d', version: PROJECT_VERSION,
    id: 'project-1', name: 'Test', scene: { model, textures: [] } });
}

test('a saved GLB project keeps a file reference without model bytes', () => {
  const saved = parseProject(project({ kind: 'glb', referenceId: 'model-1', name: 'Character.glb',
    size: 12345 }));
  assert.equal(saved.scene.model.referenceId, 'model-1');
  assert.equal(saved.scene.model.data, undefined);
});

test('a GLB project needs a model reference for relinking', () => {
  assert.throws(() => parseProject(project({ kind: 'glb', name: 'Character.glb' })),
    /valid GLB reference/);
});
