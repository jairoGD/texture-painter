import * as THREE from 'three';

const TEXTURE_SIZE = 1024;
const BRUSH_RADIUS = 18;

export function createTexturePainter() {
  let surfaces = new Map();
  let lightingMode = 'shaded';

  function makeSurface(original) {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;

    const shaded = new THREE.MeshStandardMaterial({
      map: texture,
      color: '#ffffff',
      roughness: 0.8,
      metalness: 0,
      side: original?.side ?? THREE.FrontSide
    });
    const unlit = new THREE.MeshBasicMaterial({
      map: texture,
      color: '#ffffff',
      side: original?.side ?? THREE.FrontSide,
      toneMapped: false
    });

    return { canvas, context, texture, shaded, unlit };
  }

  function setMeshMaterial(record) {
    const materials = record.slots.map((surface) => lightingMode === 'unlit' ? surface.unlit : surface.shaded);
    record.mesh.material = record.isArray ? materials : materials[0];
  }

  function clear() {
    for (const record of surfaces.values()) {
      for (const surface of record.slots) {
        surface.texture.dispose();
        surface.shaded.dispose();
        surface.unlit.dispose();
      }
    }
    surfaces.clear();
  }

  function prepare(root) {
    const meshes = [];
    root.traverse((object) => {
      if (object.isMesh && object.geometry?.getAttribute('uv')) meshes.push(object);
    });
    if (!meshes.length) throw new Error('This model has no UV coordinates to paint.');

    clear();
    for (const mesh of meshes) {
      const isArray = Array.isArray(mesh.material);
      const originals = isArray ? mesh.material : [mesh.material];
      const record = { mesh, isArray, slots: originals.map(makeSurface) };
      surfaces.set(mesh, record);
      setMeshMaterial(record);
    }
    return meshes.length;
  }

  function setLightingMode(mode) {
    if (!['shaded', 'unlit'].includes(mode)) throw new Error(`Unknown lighting mode: ${mode}`);
    lightingMode = mode;
    for (const record of surfaces.values()) setMeshMaterial(record);
  }

  function toPixel(uv) {
    const u = ((uv.x % 1) + 1) % 1;
    const v = ((uv.y % 1) + 1) % 1;
    return { x: u * TEXTURE_SIZE, y: (1 - v) * TEXTURE_SIZE };
  }

  function paint(hit, tool, previousHit) {
    const record = surfaces.get(hit.object);
    const surface = record?.slots[hit.face?.materialIndex ?? 0];
    if (!surface || !hit.uv) return null;

    const point = toPixel(hit.uv);
    const sameSlot = previousHit?.object === hit.object &&
      (previousHit.face?.materialIndex ?? 0) === (hit.face?.materialIndex ?? 0);
    const previous = sameSlot && previousHit.uv ? toPixel(previousHit.uv) : null;
    const context = surface.context;
    context.strokeStyle = tool === 'eraser' ? '#ffffff' : '#28343f';
    context.fillStyle = context.strokeStyle;
    context.lineWidth = BRUSH_RADIUS * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < TEXTURE_SIZE * 0.2) {
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(point.x, point.y, BRUSH_RADIUS, 0, Math.PI * 2);
      context.fill();
    }
    surface.texture.needsUpdate = true;
    return hit;
  }

  return {
    prepare,
    clear,
    paint,
    setLightingMode,
    getMeshes: () => [...surfaces.keys()]
  };
}
