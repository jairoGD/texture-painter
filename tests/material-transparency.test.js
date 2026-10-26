import test from 'node:test';
import assert from 'node:assert/strict';
import { AdditiveBlending, MeshBasicMaterial, MeshStandardMaterial,
  NormalBlending } from 'three';
import { applyMaterialTransparency, normalizeMaterialTransparency } from
  '../src/editor/material-transparency.js';

test('material transparency modes configure both shaded and unlit materials', () => {
  for (const Material of [MeshStandardMaterial, MeshBasicMaterial]) {
    const material = new Material();
    applyMaterialTransparency(material, 'blended');
    assert.equal(material.transparent, true);
    assert.equal(material.depthWrite, false);
    assert.equal(material.blending, NormalBlending);

    applyMaterialTransparency(material, 'dithered');
    assert.equal(material.alphaHash, true);
    assert.equal(material.transparent, false);
    assert.equal(material.depthWrite, true);

    applyMaterialTransparency(material, 'cutout');
    assert.equal(material.alphaHash, false);
    assert.equal(material.alphaTest, 0.5);

    applyMaterialTransparency(material, 'add');
    assert.equal(material.alphaTest, 0);
    assert.equal(material.transparent, true);
    assert.equal(material.blending, AdditiveBlending);
    assert.equal(material.depthWrite, false);

    applyMaterialTransparency(material, 'opaque');
    assert.equal(material.transparent, false);
    assert.equal(material.alphaHash, false);
    assert.equal(material.alphaTest, 0);
    assert.equal(material.blending, NormalBlending);
    assert.equal(material.depthWrite, true);
    material.dispose();
  }
});

test('unknown material transparency falls back to opaque', () => {
  assert.equal(normalizeMaterialTransparency('invalid'), 'opaque');
});
