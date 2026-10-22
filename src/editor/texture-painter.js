import * as THREE from 'three';
import { executePaintCommand, samplePaintColor } from './paint-operations.js';
import { combineSelectionParts, containsSelection, moveSelectionInView, selectionFromAlpha,
  selectionFromMask, visibleSelectionSamples } from './lasso-selection.js';
import { addTextureNode, blendCanvases, cloneTextureGraph, connectTextureNodes,
  createTextureGraph, evaluateTextureNode, removeTextureNode, renderTextureGraph } from './texture-graph.js';
import { addGraphLayer, readLayerStack, removeGraphLayer, syncLayerMasks } from './layer-graph.js';
import { canConnectSurfaceHits, canConnectUvHits } from './surface-stroke.js';
import { applyPaintPatches, capturePaintPatches } from './paint-history.js';
import { moveSelectionInUv, shiftedUvSelection, shiftedUvSelectionParts } from './uv-lasso-move.js';
import { copySelectedPixels, cutSelectedPixels, pasteSelectedPixels } from './selection-clipboard.js';
import { textureResolution as SIZE } from './texture-resolution.js';

function configureTextureSampling(texture, antialiasEnabled) {
  texture.magFilter = antialiasEnabled ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = antialiasEnabled ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = antialiasEnabled;
  texture.anisotropy = antialiasEnabled ? 4 : 1;
  texture.needsUpdate = true;
}

export function createTexturePainter() {
  const surfaces = new Map();
  let lightingMode = 'shaded';
  let antialiasEnabled = true;
  let undoStack = [];
  let redoStack = [];
  let activeStroke = null;
  let linePreview = null;
  let selection = null;
  let clipboard = null;
  let lassoDraft = null;
  let movePreview = null;
  let overlaySurface = null;
  let maskEnabled = true;
  let isolateBlur = true;

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
    configureTextureSampling(texture, antialiasEnabled);
    const shaded = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: 0.8, metalness: 0, side: original?.side ?? THREE.FrontSide });
    const unlit = new THREE.MeshBasicMaterial({ map: texture, color: '#ffffff', side: original?.side ?? THREE.FrontSide, toneMapped: false });
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = overlayCanvas.height = SIZE;
    const overlayContext = overlayCanvas.getContext('2d');
    const overlayTexture = new THREE.CanvasTexture(overlayCanvas);
    overlayTexture.generateMipmaps = false;
    overlayTexture.minFilter = THREE.LinearFilter;
    const overlayMaterial = new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true,
      alphaTest: 0.3, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, side: THREE.DoubleSide, toneMapped: false });
    const surface = { canvas, context, compositeCanvas, compositeContext, texture, shaded, unlit,
      overlayCanvas, overlayContext, overlayTexture, overlayMaterial, graph: createTextureGraph(),
      imageAssets: new Map(), imageCache: new Map(), compositeFrame: null, compositeRevision: 0 };
    surface.activePaint = null;
    surface.resetPaint = () => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, SIZE, SIZE);
      surface.requestComposite();
    };
    surface.refreshComposite = () => {
      if (surface.compositeFrame !== null) cancelAnimationFrame(surface.compositeFrame);
      surface.compositeFrame = null;
      renderTextureGraph(surface);
      surface.compositeRevision++;
    };
    surface.requestComposite = () => {
      if (surface.compositeFrame !== null) return;
      surface.compositeFrame = requestAnimationFrame(() => {
        surface.compositeFrame = null;
        renderTextureGraph(surface);
        surface.compositeRevision++;
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
        const original = originals[slotIndex];
        surface.id = `${mesh.uuid}:${slotIndex}`;
        surface.meshName = mesh.name?.trim() || `Mesh ${meshIndex + 1}`;
        surface.materialName = original?.name?.trim() ||
          (record.slots.length > 1 ? `Material ${slotIndex + 1}` : surface.meshName);
        surface.materialColor = original?.color?.getHexString ?
          `#${original.color.getHexString()}` : '#e9edf3';
        surface.geometry = mesh.geometry;
        surface.slotIndex = slotIndex;
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
      surfaces.set(mesh, record);
      for (const surface of record.slots) {
        const layer = addGraphLayer(surface.graph, 'image');
        const asset = createImage(surface.id, layer.source.id, surface.canvas, 'Layer 1');
        layer.source.imageKey = asset.key;
        layer.source.imageName = asset.name;
        surface.activePaint = surface.imageAssets.get(asset.key).paintSurface;
        surface.refreshComposite();
      }
      setMeshMaterial(record);
    }
    const allSlots = [...surfaces.values()].flatMap((record) => record.slots);
    const nameCounts = new Map();
    for (const surface of allSlots) nameCounts.set(surface.materialName,
      (nameCounts.get(surface.materialName) ?? 0) + 1);
    const usedLabels = new Set();
    for (const surface of allSlots) {
      const base = nameCounts.get(surface.materialName) > 1 ?
        `${surface.materialName} · ${surface.meshName}` : surface.materialName;
      let label = base;
      for (let number = 2; usedLabels.has(label); number++) label = `${base} (${number})`;
      surface.label = label;
      usedLabels.add(label);
      if (surface.activePaint) surface.activePaint.label = label;
    }
    return meshes.length;
  }

  function setLightingMode(mode) {
    if (!['shaded', 'unlit'].includes(mode)) throw new Error(`Unknown lighting mode: ${mode}`);
    lightingMode = mode;
    for (const record of surfaces.values()) setMeshMaterial(record);
  }

  function setAntialiasEnabled(enabled) {
    antialiasEnabled = Boolean(enabled);
    for (const record of surfaces.values()) for (const surface of record.slots) {
      configureTextureSampling(surface.texture, antialiasEnabled);
    }
  }

  function toPixel(uv) {
    const u = ((uv.x % 1) + 1) % 1;
    const v = ((uv.y % 1) + 1) % 1;
    return { x: u * SIZE, y: (1 - v) * SIZE };
  }

  function surfaceAt(hit) {
    return hit?.uv ? surfaces.get(hit.object)?.slots[hit.face?.materialIndex ?? 0]?.activePaint ?? null : null;
  }
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
    undoStack.push({ patches: [], selectionBefore: before, selectionAfter: next });
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

  function endLasso(maskCanvas, mirrorMask = null) {
    if (!lassoDraft) return false;
    const { surface, before } = lassoDraft;
    lassoDraft = null;
    const primary = maskCanvas ? selectionFromMask(surface, maskCanvas) : null;
    const mirrored = mirrorMask ? selectionFromMask(surface, mirrorMask) : null;
    const next = primary && mirrored ? combineSelectionParts(surface, [primary, mirrored]) : primary;
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

  function copySelection() {
    if (!selection || lassoDraft || movePreview) return false;
    const image = selection.floatingSourceImage ?? selection.surface.context.getImageData(0, 0, SIZE, SIZE);
    clipboard = copySelectedPixels(image, selection);
    return true;
  }

  function cutSelection() {
    if (!copySelection()) return false;
    const before = selection.surface.context.getImageData(0, 0, SIZE, SIZE);
    const after = selection.surface.context.createImageData(SIZE, SIZE);
    after.data.set(selection.floatingBase?.data ?? cutSelectedPixels(before, selection));
    selection.surface.context.putImageData(after, 0, 0);
    selection.surface.requestComposite();
    const previous = selection;
    selection = null;
    undoStack.push({ patches: capturePaintPatches([{ kind: 'moveSelection', surface: previous.surface }],
      new Map([[previous.surface, before]])), selectionBefore: previous, selectionAfter: null });
    redoStack = [];
    renderOverlay();
    return true;
  }

  function pasteSelection(targetId) {
    const surface = findSurface(targetId)?.activePaint;
    if (!clipboard || !surface || lassoDraft || movePreview) return false;
    const before = surface.context.getImageData(0, 0, SIZE, SIZE);
    const after = surface.context.createImageData(SIZE, SIZE);
    after.data.set(pasteSelectedPixels(before, clipboard));
    surface.context.putImageData(after, 0, 0);
    surface.requestComposite();
    const next = selectionFromAlpha(surface, clipboard.alpha.slice(), null, clipboard.indices);
    if (!next) return false;
    if (clipboard.parts) next.parts = clipboard.parts.map((part) => ({
      alpha: part.alpha.slice(), indices: Uint32Array.from(part.indices) }));
    next.floatingBase = before;
    next.floatingSourceImage = clipboard.image;
    const previous = selection;
    selection = next;
    undoStack.push({ patches: capturePaintPatches([{ kind: 'moveSelection', surface }],
      new Map([[surface, before]])), selectionBefore: previous, selectionAfter: next });
    redoStack = [];
    renderOverlay();
    return true;
  }

  function beginMove(hit, projection, screen, mode = 'surface', mirrored = null) {
    if (!selectedAt(hit)) return false;
    const paired = selection.parts?.length === 2 && !!mirrored;
    const point = toPixel(hit.uv);
    const originPart = paired && !containsSelection(selection.parts[0], point) &&
      containsSelection(selection.parts[1], point) ? 1 : 0;
    const branches = paired && mode === 'surface' ? [0, 1].map((index) => ({
      selection: selection.parts[index],
      projection: index === originPart ? projection : mirrored.projection,
      samples: visibleSelectionSamples(selection.parts[index],
        index === originPart ? projection : mirrored.projection),
      sign: index === originPart ? 1 : -1
    })) : null;
    const samples = mode === 'surface' && !branches ? visibleSelectionSamples(selection, projection) : null;
    if (mode === 'surface' && !(branches ? branches.some((part) => part.samples.screen.length) :
      samples.screen.length)) return false;
    movePreview = { before: selection, projection, samples, mode,
      paired, branches, originPart, mirrorAnchor: mirrored?.hit ? toPixel(mirrored.hit.uv) : null,
      mirrorDx: 0, mirrorDy: 0,
      anchor: mode === 'uv' ? point : screen, dx: 0, dy: 0,
      after: selection, image: selection.surface.context.getImageData(0, 0, SIZE, SIZE),
      sourceImage: selection.floatingSourceImage ?? null, baseImage: selection.floatingBase ?? null,
      scratch: mode === 'surface' ? selection.surface.context.createImageData(SIZE, SIZE) : null,
      destinationAlpha: mode === 'surface' ? new Uint8Array(SIZE * SIZE) : null };
    return true;
  }

  function updateMove(position, mirroredHit = null) {
    if (!movePreview) return false;
    const point = movePreview.mode === 'uv' ?
      (surfaceAt(position) === movePreview.before.surface ? toPixel(position.uv) : null) : position;
    if (!point) return false;
    const dx = Math.round(point.x - movePreview.anchor.x);
    const dy = Math.round(point.y - movePreview.anchor.y);
    const mirrorPoint = movePreview.paired && mirroredHit &&
      surfaceAt(mirroredHit) === movePreview.before.surface ? toPixel(mirroredHit.uv) : null;
    const mirrorDx = mirrorPoint ? Math.round(mirrorPoint.x - movePreview.mirrorAnchor.x) :
      movePreview.mirrorDx;
    const mirrorDy = mirrorPoint ? Math.round(mirrorPoint.y - movePreview.mirrorAnchor.y) :
      movePreview.mirrorDy;
    if (dx === movePreview.dx && dy === movePreview.dy &&
        mirrorDx === movePreview.mirrorDx && mirrorDy === movePreview.mirrorDy) return false;
    movePreview.dx = dx; movePreview.dy = dy;
    movePreview.mirrorDx = mirrorDx; movePreview.mirrorDy = mirrorDy;
    const { before, image, sourceImage, baseImage } = movePreview;
    if (!dx && !dy && !mirrorDx && !mirrorDy) {
      before.surface.context.putImageData(image, 0, 0);
      movePreview.after = before;
      renderOverlay();
      before.surface.requestComposite();
      return true;
    }
    if (movePreview.mode === 'uv') {
      const offsets = movePreview.paired ? [0, 1].map((index) => index === movePreview.originPart ?
        { dx, dy } : { dx: mirrorDx, dy: mirrorDy }) : null;
      movePreview.offsets = offsets;
      before.surface.context.putImageData(moveSelectionInUv(before.surface, before,
        sourceImage ?? image, dx, dy, offsets, baseImage), 0, 0);
      before.surface.requestComposite();
      movePreview.after = offsets ? shiftedUvSelectionParts(before, offsets) : null;
      renderOverlay(before.surface, offsets ? movePreview.after?.overlayCanvas ?? null :
        before.overlayCanvas, offsets ? 0 : dx, offsets ? 0 : dy);
    } else {
      const branches = movePreview.branches?.map((branch) => ({ ...branch,
        dx: dx * branch.sign, dy }));
      movePreview.movedBranches = branches;
      const moved = moveSelectionInView(before, sourceImage ?? image,
        movePreview.projection, movePreview.samples, dx, dy, movePreview.scratch,
        movePreview.destinationAlpha, branches, baseImage);
      before.surface.context.putImageData(moved.image, 0, 0);
      before.surface.requestComposite();
      movePreview.after = moved.parts ? combineSelectionParts(before.surface,
        moved.parts.filter((part) => part.indices.length), false) :
        selectionFromAlpha(before.surface, moved.alpha, null, moved.indices, false);
      renderOverlay(before.surface, movePreview.after?.overlayCanvas ?? null);
    }
    return true;
  }

  function endMove() {
    if (!movePreview) return false;
    const { before, after: previewAfter, image, sourceImage, baseImage,
      projection, samples, dx, dy, mode, mirrorDx, mirrorDy, offsets, movedBranches } = movePreview;
    movePreview = null;
    if (!dx && !dy && !mirrorDx && !mirrorDy) { renderOverlay(); return false; }
    const after = mode === 'uv' ? previewAfter ?? shiftedUvSelection(before, dx, dy) : previewAfter?.parts ?
      combineSelectionParts(before.surface, previewAfter.parts) :
      previewAfter ? selectionFromAlpha(before.surface,
        previewAfter.alpha, null, previewAfter.indices) : null;
    if (after && baseImage) {
      const empty = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) };
      after.floatingBase = baseImage;
      after.floatingSourceImage = mode === 'uv' ?
        moveSelectionInUv(before.surface, before, sourceImage, dx, dy, offsets, empty) :
        moveSelectionInView(before, sourceImage, projection,
          samples, dx, dy, null, null, movedBranches, empty).image;
    }
    const command = { kind: 'moveSelection', surface: before.surface, selection: before, dx, dy };
    undoStack.push({ patches: capturePaintPatches([command], new Map([[before.surface, image]])),
      selectionBefore: before, selectionAfter: after });
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

  function commitFloatingSelection() {
    if (selection?.floatingBase) selection = { ...selection, floatingBase: null,
      floatingSourceImage: null };
  }

  function beginStroke() {
    commitFloatingSelection();
    activeStroke = { commands: [], before: new Map() };
  }
  function apply(command) {
    if (activeStroke && !activeStroke.before.has(command.surface)) {
      const { canvas, context } = command.surface;
      activeStroke.before.set(command.surface, context.getImageData(0, 0, canvas.width, canvas.height));
    }
    if (!executePaintCommand(command)) return false;
    activeStroke?.commands.push(command);
    return true;
  }

  function paint(hit, kind, previousHit, options, mode = 'surface') {
    const surface = surfaceAt(hit);
    if (!surface) return null;
    if (selection && maskEnabled && surface !== selection.surface) return null;
    const point = toPixel(hit.uv);
    const previous = surfaceAt(previousHit) === surface ? toPixel(previousHit.uv) : null;
    const continuous = previous && (mode === 'uv' ?
      canConnectUvHits(previousHit, hit, previous, point, SIZE * 0.2) :
      canConnectSurfaceHits(previousHit, hit, previous, point, SIZE * 0.2));
    apply({ kind, surface, point, previous: continuous ? previous : null,
      options: { ...options }, mask: maskEnabled ? selection : null, isolateBlur });
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

  function beginLine(hit, options, mirroredHit = null, mode = 'surface') {
    const surface = surfaceAt(hit);
    if (!surface || (selection && maskEnabled && surface !== selection.surface)) return false;
    commitFloatingSelection();
    linePreview = { options: { ...options }, mode, before: new Map(), commands: [] };
    updateLine([[hit], mirroredHit ? [mirroredHit] : []]);
    return true;
  }

  function updateLine(paths) {
    if (!linePreview) return false;
    const { before, options, mode } = linePreview;
    for (const [surface, image] of before) {
      surface.context.putImageData(image, 0, 0);
      surface.requestComposite();
    }
    const commands = [];
    for (const rawHits of paths) {
      if (mode === 'uv' && (!rawHits[0] || !rawHits.at(-1))) continue;
      if (mode === 'uv' && rawHits.length > 1 &&
          surfaceAt(rawHits[0]) !== surfaceAt(rawHits.at(-1))) continue;
      const hits = mode === 'uv' ? [rawHits[0], rawHits.at(-1)] : rawHits;
      let previousHit = null;
      let previousPoint = null;
      let segment = null;
      for (const hit of hits) {
        const surface = surfaceAt(hit);
        if (!surface || (selection && maskEnabled && surface !== selection.surface)) {
          previousHit = null; previousPoint = null; segment = null;
          continue;
        }
        if (!before.has(surface)) before.set(surface, surface.context.getImageData(0, 0, SIZE, SIZE));
        const point = toPixel(hit.uv);
        if (segment && surface === segment.surface &&
            (mode === 'uv' || canConnectSurfaceHits(previousHit, hit, previousPoint, point, SIZE * 0.2))) {
          segment.point = point;
        } else {
          segment = { kind: 'line', surface, point, previous: point, options,
            mask: maskEnabled ? selection : null };
          commands.push(segment);
        }
        previousHit = hit;
        previousPoint = point;
      }
    }
    linePreview.commands = commands;
    linePreview.changed = false;
    for (const command of commands) {
      if (executePaintCommand(command)) linePreview.changed = true;
    }
    return true;
  }

  function commitLine() {
    if (!linePreview) return false;
    const { commands, changed } = linePreview;
    if (changed) {
      undoStack.push({ patches: capturePaintPatches(commands, linePreview.before) });
      redoStack = [];
    }
    linePreview = null;
    return changed;
  }

  function cancelLine() {
    if (!linePreview) return;
    for (const [surface, image] of linePreview.before) {
      surface.context.putImageData(image, 0, 0); surface.requestComposite();
    }
    linePreview = null;
  }

  function endStroke() {
    if (activeStroke?.commands.length) {
      undoStack.push({ patches: capturePaintPatches(activeStroke.commands, activeStroke.before) });
      redoStack = [];
    }
    activeStroke = null;
  }

  function undo() {
    if (!undoStack.length || activeStroke || linePreview) return false;
    const entry = undoStack.pop(); redoStack.push(entry);
    applyPaintPatches(entry.patches, 'before');
    if ('selectionBefore' in entry) { selection = entry.selectionBefore; renderOverlay(); }
    return true;
  }

  function redo() {
    if (!redoStack.length || activeStroke || linePreview) return false;
    const entry = redoStack.pop(); undoStack.push(entry);
    applyPaintPatches(entry.patches, 'after');
    if ('selectionAfter' in entry) { selection = entry.selectionAfter; renderOverlay(); }
    return true;
  }

  function graphTargets() {
    return [...surfaces.values()].flatMap((record) => record.slots.map((surface) =>
      ({ id: surface.id, label: surface.label, color: surface.materialColor,
        graph: cloneTextureGraph(surface.graph) })));
  }

  function findSurface(targetId) {
    return [...surfaces.values()].flatMap((record) => record.slots)
      .find((item) => item.id === targetId);
  }

  function getLayerImage(targetId, imageKey) {
    return findSurface(targetId)?.imageAssets.get(imageKey)?.canvas ?? null;
  }

  function getCompositePreview(targetId) {
    const surface = findSurface(targetId);
    return surface ? { canvas: surface.compositeCanvas, revision: surface.compositeRevision } : null;
  }

  function createImage(targetId, nodeId, source = null, name = 'Untitled image', savedKey = null) {
    const parent = findSurface(targetId);
    if (!parent) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (source) context.drawImage(source, 0, 0, SIZE, SIZE);
    const initial = document.createElement('canvas');
    initial.width = initial.height = SIZE;
    initial.getContext('2d').drawImage(canvas, 0, 0);
    const key = savedKey ?? `${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const asset = { key, name, canvas, revision: 0 };
    const paintSurface = { id: parent.id, label: parent.label, canvas, context,
      compositeContext: parent.compositeContext, overlayContext: parent.overlayContext,
      overlayTexture: parent.overlayTexture, imageLayer: true,
      refreshComposite: parent.refreshComposite,
      requestComposite: () => { asset.revision++; parent.imageCache.clear(); parent.requestComposite(); },
      resetPaint: () => {
        context.clearRect(0, 0, SIZE, SIZE);
        context.drawImage(initial, 0, 0);
        paintSurface.requestComposite();
      } };
    asset.paintSurface = paintSurface;
    parent.imageAssets.set(key, asset);
    return { key, name };
  }

  function setPaintSource(targetId, nodeId) {
    const parent = findSurface(targetId);
    if (!parent) return false;
    const node = parent.graph.nodes.find((item) => item.id === nodeId && item.type === 'image');
    const next = nodeId === null ? null : node && parent.imageAssets.get(node.imageKey)?.paintSurface;
    if (nodeId !== null && !next) return false;
    if (selection) { selection = null; renderOverlay(null); }
    parent.activePaint = next;
    return true;
  }

  function setGraph(targetId, graph) {
    const surface = findSurface(targetId);
    if (!surface) return false;
    surface.graph = cloneTextureGraph(graph);
    surface.imageCache.clear();
    if (surface.activePaint && !surface.graph.nodes.some((node) =>
      node.type === 'image' && surface.imageAssets.get(node.imageKey)?.paintSurface === surface.activePaint)) {
      if (selection?.surface === surface.activePaint) { selection = null; renderOverlay(null); }
      const next = readLayerStack(surface.graph).layers[0]?.source;
      surface.activePaint = next ? surface.imageAssets.get(next.imageKey)?.paintSurface ?? null : null;
    }
    surface.refreshComposite();
    return true;
  }

  function mergeLayerDown(targetId, layerId, graph) {
    const surface = findSurface(targetId);
    if (!surface) return null;
    const stack = readLayerStack(graph).layers;
    const index = stack.findIndex((layer) => layer.id === layerId);
    if (index < 0 || index >= stack.length - 1) return null;
    const upper = stack[index];
    const lower = stack[index + 1];
    if (upper.mix.layerIsMask || lower.mix.layerIsMask ||
        upper.mix.layerParentId || lower.mix.layerParentId ||
        stack.some((layer) => layer.mix.layerParentId === upper.id ||
          layer.mix.layerParentId === lower.id)) return null;
    const blank = document.createElement('canvas');
    blank.width = blank.height = SIZE;
    const apply = (base, layer) => {
      const colorLink = graph.links.find((link) => link.to === layer.id && link.toSocket === 'B');
      const image = colorLink ? evaluateTextureNode(surface, colorLink.from,
        colorLink.fromSocket, graph) : null;
      if (!image) return base;
      const factorLink = graph.links.find((link) => link.to === layer.id && link.toSocket === 'Factor');
      const mask = factorLink ? evaluateTextureNode(surface, factorLink.from, factorLink.fromSocket, graph) : null;
      const factor = layer.mix.layerVisible === false ? 0 :
        Math.max(0, Math.min(1, Number(layer.mix.factor ?? 1)));
      return blendCanvases(base, image, layer.mix.mode || 'mix', factor, SIZE, mask);
    };
    const mergedImage = apply(apply(blank, lower), upper);
    const next = cloneTextureGraph(graph);
    removeGraphLayer(next, upper.id);
    const lowerMix = next.nodes.find((node) => node.id === lower.id);
    const previousSource = next.nodes.find((node) => node.id === lower.source.id);
    const source = addTextureNode(next, 'image', { x: previousSource.x, y: previousSource.y });
    const asset = createImage(targetId, source.id, mergedImage, lower.label);
    source.imageKey = asset.key;
    source.imageName = asset.name;
    lowerMix.layerSourceId = source.id;
    lowerMix.mode = 'mix';
    lowerMix.factor = 1;
    lowerMix.layerVisible = true;
    lowerMix.layerInvert = false;
    next.links = next.links.filter((link) => !(link.to === lowerMix.id && link.toSocket === 'Factor'));
    connectTextureNodes(next, source.id, 'Color', lowerMix.id, 'B');
    syncLayerMasks(next);
    if (!next.links.some((link) => link.from === previousSource.id)) removeTextureNode(next, previousSource.id);
    return { graph: next, layerId: lowerMix.id, sourceId: source.id };
  }

  function exportProjectTextures() {
    return [...surfaces.values()].flatMap((record) => record.slots.map((surface) => ({
      graph: cloneTextureGraph(surface.graph),
      images: [...new Set(surface.graph.nodes.filter((node) => node.type === 'image')
        .map((node) => node.imageKey).filter(Boolean))].map((key) => {
        const asset = surface.imageAssets.get(key);
        if (!asset) throw new Error('A graph image is missing from the project.');
        return { key, name: asset.name, data: asset.canvas.toDataURL('image/png') };
      })
    })));
  }

  async function restoreProjectTextures(textures) {
    const slots = [...surfaces.values()].flatMap((record) => record.slots);
    if (textures.length !== slots.length) throw new Error('Project textures do not match the model.');
    const loadImage = async (data) => {
      if (typeof data !== 'string' || !data.startsWith('data:image/'))
        throw new Error('The project contains an invalid image.');
      const image = new Image();
      image.src = data;
      await image.decode();
      return image;
    };
    for (const [index, saved] of textures.entries()) {
      const surface = slots[index];
      surface.imageAssets.clear();
      surface.imageCache.clear();
      surface.activePaint = null;
      for (const asset of saved.images ?? []) {
        const image = await loadImage(asset.data);
        createImage(surface.id, asset.key.split(':')[0], image, asset.name, asset.key);
      }
      setGraph(surface.id, saved.graph);
    }
  }

  return { prepare, clear, paint, fill, sample, beginLine, updateLine, commitLine, cancelLine,
    beginLasso, endLasso, cancelLasso, selectedAt, beginMove, updateMove, endMove,
    cancelMove, clearSelection, copySelection, cutSelection, pasteSelection,
    canCopySelection: () => !!selection && !lassoDraft && !movePreview,
    canPasteSelection: () => !!clipboard, getLayerImage, getCompositePreview,
    setMaskEnabled: (enabled) => { maskEnabled = enabled; },
    setBlurSelectionIsolation: (enabled) => { isolateBlur = enabled; },
    beginStroke, endStroke, undo, redo, canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0, setLightingMode, setAntialiasEnabled,
    getMeshes: () => [...surfaces.keys()],
    getGraphTargets: graphTargets, setGraph, createImage, setPaintSource, mergeLayerDown,
    exportProjectTextures, restoreProjectTextures,
    targetIdAt: (hit) => surfaceAt(hit)?.id ?? null };
}
