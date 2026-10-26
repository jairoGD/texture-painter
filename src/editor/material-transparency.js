import * as THREE from 'three';

export const MATERIAL_TRANSPARENCY_MODES = ['opaque', 'blended', 'dithered',
  'cutout', 'add'];

export function normalizeMaterialTransparency(mode) {
  return MATERIAL_TRANSPARENCY_MODES.includes(mode) ? mode : 'opaque';
}

export function applyMaterialTransparency(material, requestedMode) {
  const mode = normalizeMaterialTransparency(requestedMode);
  material.transparent = mode === 'blended' || mode === 'add';
  material.alphaHash = mode === 'dithered';
  material.alphaTest = mode === 'cutout' ? 0.5 : 0;
  material.blending = mode === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
  material.depthWrite = !material.transparent;
  material.needsUpdate = true;
  return mode;
}
