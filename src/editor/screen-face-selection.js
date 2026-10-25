import * as THREE from 'three';

const faceGeometryCache = new WeakMap();
const faceIdMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    #include <common>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    attribute vec3 faceCode;
    varying vec3 vFaceCode;
    void main() {
      vFaceCode = faceCode;
      #include <begin_vertex>
      #include <morphtarget_vertex>
      #include <skinbase_vertex>
      #include <skinning_vertex>
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }`,
  fragmentShader: `varying vec3 vFaceCode;
    void main() { gl_FragColor = vec4(vFaceCode, 1.0); }`,
  side: THREE.DoubleSide,
  toneMapped: false
});
const occluderMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff, side: THREE.DoubleSide, toneMapped: false
});
const invisibleMaterial = new THREE.MeshBasicMaterial({ visible: false });

function indexedFacesGeometry(source) {
  const cached = faceGeometryCache.get(source);
  if (cached) return cached;
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const count = Math.floor(geometry.getAttribute('position').count / 3);
  if (count >= 0xfffffe) throw new Error('This mesh has too many faces for box selection.');
  const colors = new Uint8Array(count * 9);
  for (let face = 0; face < count; face++) {
    const code = face + 1;
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = face * 9 + vertex * 3;
      colors[offset] = code >> 16 & 255;
      colors[offset + 1] = code >> 8 & 255;
      colors[offset + 2] = code & 255;
    }
  }
  geometry.setAttribute('faceCode', new THREE.Uint8BufferAttribute(colors, 3, true));
  faceGeometryCache.set(source, geometry);
  return geometry;
}

export function visibleFaceIds(buffer) {
  const faces = new Set();
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const code = (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
    if (code > 0 && code !== 0xffffff) faces.add(code - 1);
  }
  return faces;
}

function proxyFor(candidate, geometry, materials) {
  const proxy = candidate.isSkinnedMesh ? new THREE.SkinnedMesh(geometry, materials) :
    new THREE.Mesh(geometry, materials);
  if (candidate.isSkinnedMesh) {
    proxy.bind(candidate.skeleton, candidate.bindMatrix);
    proxy.bindMode = candidate.bindMode;
  }
  if (candidate.morphTargetInfluences?.length) {
    proxy.morphTargetInfluences = candidate.morphTargetInfluences;
    proxy.morphTargetDictionary = candidate.morphTargetDictionary;
  }
  candidate.updateWorldMatrix(true, false);
  proxy.matrixAutoUpdate = false;
  proxy.matrix.copy(candidate.matrixWorld);
  proxy.frustumCulled = false;
  return proxy;
}

export function captureVisibleFaces(renderer, camera, targetMesh, materialIndex,
  meshes, screenRect) {
  const viewport = renderer.domElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const left = Math.max(0, Math.floor(Math.min(screenRect.left, screenRect.right)));
  const top = Math.max(0, Math.floor(Math.min(screenRect.top, screenRect.bottom)));
  const right = Math.min(width, Math.ceil(Math.max(screenRect.left, screenRect.right)));
  const bottom = Math.min(height, Math.ceil(Math.max(screenRect.top, screenRect.bottom)));
  if (right <= left || bottom <= top) return new Set();

  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
  const pickScene = new THREE.Scene();
  for (const candidate of meshes) {
    const selected = candidate === targetMesh;
    const geometry = selected ? indexedFacesGeometry(candidate.geometry) : candidate.geometry;
    const materials = Array.isArray(candidate.material) ?
      candidate.material.map((material, index) => material.visible === false ? invisibleMaterial :
        selected && index === materialIndex ? faceIdMaterial : occluderMaterial) :
      candidate.material.visible === false ? invisibleMaterial :
        selected && materialIndex === 0 ? faceIdMaterial : occluderMaterial;
    pickScene.add(proxyFor(candidate, geometry, materials));
  }
  const previousTarget = renderer.getRenderTarget();
  const previousColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousAlpha = renderer.getClearAlpha();
  const buffer = new Uint8Array((right - left) * (bottom - top) * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(pickScene, camera);
    renderer.readRenderTargetPixels(target, left, height - bottom,
      right - left, bottom - top, buffer);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    target.dispose();
  }
  return visibleFaceIds(buffer);
}
