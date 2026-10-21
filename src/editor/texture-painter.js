import * as THREE from 'three';
import { executePaintCommand, samplePaintColor } from './paint-operations.js';

const SIZE = 1024;

export function createTexturePainter() {
  const surfaces = new Map();
  let lightingMode = 'shaded';
  let undoStack = [];
  let redoStack = [];
  let activeStroke = null;
  let linePreview = null;

  function makeSurface(original) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, SIZE, SIZE);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    const shaded = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.8, metalness: 0, side: original?.side ?? THREE.FrontSide });
    const unlit = new THREE.MeshBasicMaterial({ map: texture, color: '#ffffff', side: original?.side ?? THREE.FrontSide, toneMapped: false });
    return { canvas, context, texture, shaded, unlit };
  }

  function setMeshMaterial(record) {
    const materials = record.slots.map((surface) => lightingMode === 'unlit' ? surface.unlit : surface.shaded);
    record.mesh.material = record.isArray ? materials : materials[0];
  }

  function clear() {
    for (const record of surfaces.values()) for (const surface of record.slots) {
      surface.texture.dispose(); surface.shaded.dispose(); surface.unlit.dispose();
    }
    surfaces.clear(); undoStack = []; redoStack = []; activeStroke = null; linePreview = null;
  }

  function prepare(root) {
    const meshes = [];
    root.traverse((object) => { if (object.isMesh && object.geometry?.getAttribute('uv')) meshes.push(object); });
    if (!meshes.length) throw new Error('This model has no UV coordinates to paint.');
    clear();
    for (const mesh of meshes) {
      const isArray = Array.isArray(mesh.material);
      const originals = isArray ? mesh.material : [mesh.material];
      const record = { mesh, isArray, slots: originals.map(makeSurface) };
      surfaces.set(mesh, record); setMeshMaterial(record);
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
    return { x: u * SIZE, y: (1 - v) * SIZE };
  }

  function surfaceAt(hit) { return hit?.uv ? surfaces.get(hit.object)?.slots[hit.face?.materialIndex ?? 0] : null; }
  function beginStroke() { activeStroke = []; }
  function apply(command) {
    if (!executePaintCommand(command)) return false;
    activeStroke?.push(command);
    return true;
  }

  function paint(hit, kind, previousHit, options) {
    const surface = surfaceAt(hit);
    if (!surface) return null;
    const point = toPixel(hit.uv);
    const previous = surfaceAt(previousHit) === surface ? toPixel(previousHit.uv) : null;
    const continuous = previous && Math.hypot(point.x - previous.x, point.y - previous.y) < SIZE * 0.2;
    apply({ kind, surface, point, previous: continuous ? previous : null, options: { ...options } });
    return hit;
  }

  function fill(hit, options) {
    const surface = surfaceAt(hit);
    return surface ? apply({ kind: 'bucket', surface, point: toPixel(hit.uv), options: { ...options } }) : false;
  }

  function sample(hit) {
    const surface = surfaceAt(hit);
    return surface ? samplePaintColor(surface, toPixel(hit.uv)) : null;
  }

  function beginLine(hit, options) {
    const surface = surfaceAt(hit);
    if (!surface) return false;
    linePreview = { surface, anchor: toPixel(hit.uv), options: { ...options }, before: surface.context.getImageData(0, 0, SIZE, SIZE), command: null };
    updateLine(hit);
    return true;
  }

  function updateLine(hit) {
    if (!linePreview || surfaceAt(hit) !== linePreview.surface) return false;
    const { surface, before, anchor, options } = linePreview;
    surface.context.putImageData(before, 0, 0);
    linePreview.command = { kind: 'line', surface, point: toPixel(hit.uv), previous: anchor, options };
    executePaintCommand(linePreview.command);
    return true;
  }

  function commitLine() {
    if (!linePreview) return false;
    undoStack.push([linePreview.command]); redoStack = []; linePreview = null;
    return true;
  }

  function cancelLine() {
    if (!linePreview) return;
    const { surface, before } = linePreview;
    surface.context.putImageData(before, 0, 0); surface.texture.needsUpdate = true;
    linePreview = null;
  }

  function endStroke() {
    if (activeStroke?.length) { undoStack.push(activeStroke); redoStack = []; }
    activeStroke = null;
  }

  function rebuild(affectedSurfaces) {
    for (const surface of affectedSurfaces) {
      surface.context.fillStyle = '#ffffff'; surface.context.fillRect(0, 0, SIZE, SIZE);
      surface.texture.needsUpdate = true;
    }
    for (const stroke of undoStack) for (const command of stroke) {
      if (affectedSurfaces.has(command.surface)) executePaintCommand(command);
    }
  }

  function undo() {
    if (!undoStack.length || activeStroke || linePreview) return false;
    const stroke = undoStack.pop(); redoStack.push(stroke);
    rebuild(new Set(stroke.map((command) => command.surface)));
    return true;
  }

  function redo() {
    if (!redoStack.length || activeStroke || linePreview) return false;
    const stroke = redoStack.pop(); undoStack.push(stroke);
    rebuild(new Set(stroke.map((command) => command.surface)));
    return true;
  }

  return { prepare, clear, paint, fill, sample, beginLine, updateLine, commitLine, cancelLine,
    beginStroke, endStroke, undo, redo, canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0, setLightingMode, getMeshes: () => [...surfaces.keys()] };
}
