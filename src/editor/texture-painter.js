import * as THREE from 'three';
import { executePaintCommand, samplePaintColor } from './paint-operations.js';
import { containsSelection, selectionFromMask, shiftedSelection } from './lasso-selection.js';
import { cloneTextureGraph, createTextureGraph, renderTextureGraph } from './texture-graph.js';

const SIZE = 1024;

export function createTexturePainter() {
  const surfaces = new Map();
  let lightingMode = 'shaded';
  let undoStack = [];
  let redoStack = [];
  let activeStroke = null;
  let linePreview = null;
  let selection = null;
  let lassoDraft = null;
  let movePreview = null;
  let overlaySurface = null;
  let maskEnabled = true;

  function makeSurface(original) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, SIZE, SIZE);
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = compositeCanvas.height = SIZE;
    const compositeContext = compositeCanvas.getContext('2d');
    const texture = new THREE.CanvasTexture(compositeCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    const shaded = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.8, metalness: 0, side: original?.side ?? THREE.FrontSide });
    const unlit = new THREE.MeshBasicMaterial({ map: texture, color: '#ffffff', side: original?.side ?? THREE.FrontSide, toneMapped: false });
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = overlayCanvas.height = SIZE;
    const overlayContext = overlayCanvas.getContext('2d');
    const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
    const overlayMaterial = new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide, toneMapped: false });
    const surface = { canvas, context, compositeCanvas, compositeContext, texture, shaded, unlit,
      overlayCanvas, overlayContext, overlayTexture, overlayMaterial, graph: createTextureGraph(), compositeFrame: null };
    surface.refreshComposite = () => {
      if (surface.compositeFrame !== null) cancelAnimationFrame(surface.compositeFrame);
      surface.compositeFrame = null;
      renderTextureGraph(surface);
    };
    surface.requestComposite = () => {
      if (surface.compositeFrame !== null) return;
      surface.compositeFrame = requestAnimationFrame(() => {
        surface.compositeFrame = null;
        renderTextureGraph(surface);
      });
    };
    surface.refreshComposite();
    return surface;
  }

  function setMeshMaterial(record) {
    const materials = record.slots.map((surface) => lightingMode === 'unlit' ? surface.unlit : surface.shaded);
    record.mesh.material = record.isArray ? materials : materials[0];
  }

  function clear() {
    for (const record of surfaces.values()) {
      record.mesh.remove(record.overlay);
      for (const surface of record.slots) {
        if (surface.compositeFrame !== null) cancelAnimationFrame(surface.compositeFrame);
        surface.texture.dispose(); surface.shaded.dispose(); surface.unlit.dispose();
        surface.overlayTexture.dispose(); surface.overlayMaterial.dispose();
      }
    }
    surfaces.clear(); undoStack = []; redoStack = []; activeStroke = null; linePreview = null;
    selection = null; lassoDraft = null; movePreview = null; overlaySurface = null;
  }

  function prepare(root) {
    const meshes = [];
    root.traverse((object) => { if (object.isMesh && object.geometry?.getAttribute('uv')) meshes.push(object); });
    if (!meshes.length) throw new Error('This model has no UV coordinates to paint.');
    clear();
    for (const [meshIndex, mesh] of meshes.entries()) {
      const isArray = Array.isArray(mesh.material);
      const originals = isArray ? mesh.material : [mesh.material];
      const record = { mesh, isArray, slots: originals.map(makeSurface) };
      record.slots.forEach((surface, slotIndex) => {
        surface.id = `${mesh.uuid}:${slotIndex}`;
        surface.label = `${mesh.name || `Mesh ${meshIndex + 1}`}${record.slots.length > 1 ? ` / Material ${slotIndex + 1}` : ''}`;
      });
      const overlays = record.slots.map((surface) => surface.overlayMaterial);
      record.overlay = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, isArray ? overlays : overlays[0]) :
        new THREE.Mesh(mesh.geometry, isArray ? overlays : overlays[0]);
      if (mesh.isSkinnedMesh) {
        record.overlay.bind(mesh.skeleton, mesh.bindMatrix);
        record.overlay.bindMode = mesh.bindMode;
      }
      record.overlay.renderOrder = 2;
      record.overlay.raycast = () => {};
      mesh.add(record.overlay);
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
  function renderOverlay(surface = selection?.surface, mask = selection?.overlayCanvas, dx = 0, dy = 0) {
    if (overlaySurface && overlaySurface !== surface) {
      overlaySurface.overlayContext.clearRect(0, 0, SIZE, SIZE);
      overlaySurface.overlayTexture.needsUpdate = true;
    }
    overlaySurface = surface ?? null;
    if (!surface) return;
    const context = surface.overlayContext;
    context.clearRect(0, 0, SIZE, SIZE);
    if (mask) context.drawImage(mask, dx, dy);
    surface.overlayTexture.needsUpdate = true;
  }

  function recordSelection(next) {
    const before = selection;
    selection = next;
    undoStack.push([{ kind: 'selection', before, after: next }]);
    redoStack = [];
    renderOverlay();
  }

  function beginLasso(hit) {
    const surface = surfaceAt(hit);
    if (!surface) return false;
    if (lassoDraft) return surface === lassoDraft.surface;
    lassoDraft = { surface, before: selection };
    selection = null;
    renderOverlay();
    return true;
  }

  function endLasso(maskCanvas) {
    if (!lassoDraft) return false;
    const { surface, before } = lassoDraft;
    lassoDraft = null;
    const next = maskCanvas ? selectionFromMask(surface, maskCanvas) : null;
    if (!next) { selection = before; renderOverlay(); return false; }
    selection = before;
    recordSelection(next);
    return true;
  }

  function cancelLasso() {
    if (!lassoDraft) return false;
    selection = lassoDraft.before;
    lassoDraft = null;
    renderOverlay();
    return true;
  }

  function clearSelection() {
    if (lassoDraft) cancelLasso();
    if (!selection) return false;
    recordSelection(null);
    return true;
  }

  function selectedAt(hit) {
    return !!selection && surfaceAt(hit) === selection.surface && containsSelection(selection, toPixel(hit.uv));
  }

  function beginMove(hit) {
    if (!selectedAt(hit)) return false;
    movePreview = { before: selection, anchor: toPixel(hit.uv), dx: 0, dy: 0,
      image: selection.surface.context.getImageData(0, 0, SIZE, SIZE) };
    return true;
  }

  function updateMove(hit) {
    if (!movePreview || surfaceAt(hit) !== movePreview.before.surface) return false;
    const point = toPixel(hit.uv);
    const dx = Math.round(point.x - movePreview.anchor.x);
    const dy = Math.round(point.y - movePreview.anchor.y);
    if (dx === movePreview.dx && dy === movePreview.dy) return false;
    movePreview.dx = dx; movePreview.dy = dy;
    const { before, image } = movePreview;
    before.surface.context.putImageData(image, 0, 0);
    before.surface.requestComposite();
    if (dx || dy) executePaintCommand({ kind: 'moveSelection', surface: before.surface, selection: before, dx, dy });
    renderOverlay(before.surface, before.overlayCanvas, dx, dy);
    return true;
  }

  function endMove() {
    if (!movePreview) return false;
    const { before, dx, dy } = movePreview;
    movePreview = null;
    if (!dx && !dy) { renderOverlay(); return false; }
    const after = shiftedSelection(before, dx, dy);
    undoStack.push([{ kind: 'moveSelection', surface: before.surface, selection: before, before, after, dx, dy }]);
    redoStack = [];
    selection = after;
    renderOverlay();
    return true;
  }

  function cancelMove() {
    if (!movePreview) return false;
    const { before, image } = movePreview;
    before.surface.context.putImageData(image, 0, 0);
    before.surface.requestComposite();
    selection = before; movePreview = null; renderOverlay();
    return true;
  }

  function beginStroke() { activeStroke = []; }
  function apply(command) {
    if (!executePaintCommand(command)) return false;
    activeStroke?.push(command);
    return true;
  }

  function paint(hit, kind, previousHit, options) {
    const surface = surfaceAt(hit);
    if (!surface) return null;
    if (selection && maskEnabled && surface !== selection.surface) return null;
    const point = toPixel(hit.uv);
    const previous = surfaceAt(previousHit) === surface ? toPixel(previousHit.uv) : null;
    const continuous = previous && Math.hypot(point.x - previous.x, point.y - previous.y) < SIZE * 0.2;
    apply({ kind, surface, point, previous: continuous ? previous : null,
      options: { ...options }, mask: maskEnabled ? selection : null });
    return hit;
  }

  function fill(hit, options) {
    const surface = surfaceAt(hit);
    if (!surface || (selection && maskEnabled && surface !== selection.surface)) return false;
    return apply({ kind: 'bucket', surface, point: toPixel(hit.uv), options: { ...options },
      mask: maskEnabled ? selection : null });
  }

  function sample(hit) {
    const surface = surfaceAt(hit);
    surface?.refreshComposite();
    return surface ? samplePaintColor(surface, toPixel(hit.uv)) : null;
  }

  function beginLine(hit, options) {
    const surface = surfaceAt(hit);
    if (!surface || (selection && maskEnabled && surface !== selection.surface)) return false;
    linePreview = { surface, anchor: toPixel(hit.uv), options: { ...options }, before: surface.context.getImageData(0, 0, SIZE, SIZE), command: null };
    updateLine(hit);
    return true;
  }

  function updateLine(hit) {
    if (!linePreview || surfaceAt(hit) !== linePreview.surface) return false;
    const { surface, before, anchor, options } = linePreview;
    surface.context.putImageData(before, 0, 0);
    linePreview.command = { kind: 'line', surface, point: toPixel(hit.uv), previous: anchor, options,
      mask: maskEnabled ? selection : null };
    linePreview.changed = executePaintCommand(linePreview.command);
    return true;
  }

  function commitLine() {
    if (!linePreview) return false;
    const { command, changed } = linePreview;
    if (changed) { undoStack.push([command]); redoStack = []; }
    linePreview = null;
    return changed;
  }

  function cancelLine() {
    if (!linePreview) return;
    const { surface, before } = linePreview;
    surface.context.putImageData(before, 0, 0); surface.requestComposite();
    linePreview = null;
  }

  function endStroke() {
    if (activeStroke?.length) { undoStack.push(activeStroke); redoStack = []; }
    activeStroke = null;
  }

  function rebuild(affectedSurfaces) {
    for (const surface of affectedSurfaces) {
      surface.context.fillStyle = '#ffffff'; surface.context.fillRect(0, 0, SIZE, SIZE);
      surface.requestComposite();
    }
    for (const stroke of undoStack) for (const command of stroke) {
      if (command.kind !== 'selection' && affectedSurfaces.has(command.surface)) executePaintCommand(command);
    }
  }

  function undo() {
    if (!undoStack.length || activeStroke || linePreview) return false;
    const stroke = undoStack.pop(); redoStack.push(stroke);
    rebuild(new Set(stroke.map((command) => command.surface).filter(Boolean)));
    const selectionChange = stroke.find((command) => command.kind === 'selection' || command.kind === 'moveSelection');
    if (selectionChange) { selection = selectionChange.before; renderOverlay(); }
    return true;
  }

  function redo() {
    if (!redoStack.length || activeStroke || linePreview) return false;
    const stroke = redoStack.pop(); undoStack.push(stroke);
    rebuild(new Set(stroke.map((command) => command.surface).filter(Boolean)));
    const selectionChange = stroke.find((command) => command.kind === 'selection' || command.kind === 'moveSelection');
    if (selectionChange) { selection = selectionChange.after; renderOverlay(); }
    return true;
  }

  function graphTargets() {
    return [...surfaces.values()].flatMap((record) => record.slots.map((surface) =>
      ({ id: surface.id, label: surface.label, graph: cloneTextureGraph(surface.graph) })));
  }

  function setGraph(targetId, graph) {
    const surface = [...surfaces.values()].flatMap((record) => record.slots)
      .find((item) => item.id === targetId);
    if (!surface) return false;
    surface.graph = cloneTextureGraph(graph);
    surface.refreshComposite();
    return true;
  }

  return { prepare, clear, paint, fill, sample, beginLine, updateLine, commitLine, cancelLine,
    beginLasso, endLasso, cancelLasso, selectedAt, beginMove, updateMove, endMove,
    cancelMove, clearSelection, setMaskEnabled: (enabled) => { maskEnabled = enabled; },
    beginStroke, endStroke, undo, redo, canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0, setLightingMode, getMeshes: () => [...surfaces.keys()],
    getGraphTargets: graphTargets, setGraph,
    targetIdAt: (hit) => surfaceAt(hit)?.id ?? null };
}
