import * as THREE from 'three';

const SIZE = 1024;
const vertexShader = `#include <skinning_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 transformed = vec3(position);
    #include <skinbase_vertex>
    #include <skinning_vertex>
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }`;
const uvMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: `varying vec2 vUv;
    void main() {
      vec2 value = floor(fract(vUv) * 65534.0 + 0.5);
      gl_FragColor = vec4(floor(value.x / 256.0), mod(value.x, 256.0),
        floor(value.y / 256.0), mod(value.y, 256.0)) / 255.0;
    }`,
  side: THREE.DoubleSide,
  toneMapped: false
});
const hiddenMaterial = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
  side: THREE.DoubleSide,
  toneMapped: false
});

function decode(buffer, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const pixel = ((height - 1 - y) * width + x) * 4;
  if (buffer[pixel] === 255 && buffer[pixel + 1] === 255 &&
      buffer[pixel + 2] === 255 && buffer[pixel + 3] === 255) return null;
  return {
    x: Math.min(SIZE - 1, Math.floor(((buffer[pixel] * 256 + buffer[pixel + 1]) / 65534) * SIZE)),
    y: Math.min(SIZE - 1, Math.floor((1 - (buffer[pixel + 2] * 256 + buffer[pixel + 3]) / 65534) * SIZE))
  };
}

export function projectLassoToUv(renderer, camera, hit, path, meshes) {
  if (!hit || path.length < 3) return null;
  const mesh = hit.object;
  const materialIndex = hit.face?.materialIndex ?? 0;
  const rect = renderer.domElement.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true });
  const pickScene = new THREE.Scene();
  for (const candidate of meshes) {
    const materials = Array.isArray(candidate.material) ?
      candidate.material.map((_, index) => candidate === mesh && index === materialIndex ? uvMaterial : hiddenMaterial) :
      candidate === mesh ? uvMaterial : hiddenMaterial;
    const proxy = candidate.isSkinnedMesh ? new THREE.SkinnedMesh(candidate.geometry, materials) :
      new THREE.Mesh(candidate.geometry, materials);
    if (candidate.isSkinnedMesh) {
      proxy.bind(candidate.skeleton, candidate.bindMatrix);
      proxy.bindMode = candidate.bindMode;
    }
    proxy.matrixAutoUpdate = false;
    candidate.updateWorldMatrix(true, false);
    proxy.matrix.copy(candidate.matrixWorld);
    proxy.frustumCulled = false;
    pickScene.add(proxy);
  }
  const previousTarget = renderer.getRenderTarget();
  const previousColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousAlpha = renderer.getClearAlpha();
  const buffer = new Uint8Array(width * height * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(pickScene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    target.dispose();
  }

  const polygon = document.createElement('canvas');
  polygon.width = width; polygon.height = height;
  const polygonContext = polygon.getContext('2d');
  polygonContext.fillStyle = '#ffffff';
  polygonContext.beginPath();
  polygonContext.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) polygonContext.lineTo(point.x, point.y);
  polygonContext.closePath();
  polygonContext.fill();
  const inside = polygonContext.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(SIZE * SIZE);
  const left = Math.max(0, Math.floor(Math.min(...path.map((point) => point.x))));
  const right = Math.min(width, Math.ceil(Math.max(...path.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...path.map((point) => point.y))));
  const bottom = Math.min(height, Math.ceil(Math.max(...path.map((point) => point.y))));
  let count = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (inside[(y * width + x) * 4 + 3] < 128) continue;
    const uv = decode(buffer, width, height, x, y);
    if (!uv) continue;
    const rightUv = decode(buffer, width, height, x + 1, y);
    const downUv = decode(buffer, width, height, x, y + 1);
    const distance = Math.max(rightUv ? Math.hypot(uv.x - rightUv.x, uv.y - rightUv.y) : 0,
      downUv ? Math.hypot(uv.x - downUv.x, uv.y - downUv.y) : 0);
    const radius = Math.max(2, Math.min(12, distance < 48 ? Math.ceil(distance * 0.75) : 2));
    for (let py = Math.max(0, uv.y - radius); py <= Math.min(SIZE - 1, uv.y + radius); py++) {
      for (let px = Math.max(0, uv.x - radius); px <= Math.min(SIZE - 1, uv.x + radius); px++) {
        if ((px - uv.x) ** 2 + (py - uv.y) ** 2 <= radius * radius) mask[py * SIZE + px] = 255;
      }
    }
    count++;
  }
  if (count < 3) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d');
  const image = context.createImageData(SIZE, SIZE);
  for (let index = 0; index < mask.length; index++) {
    image.data[index * 4] = image.data[index * 4 + 1] = image.data[index * 4 + 2] = 255;
    image.data[index * 4 + 3] = mask[index];
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
