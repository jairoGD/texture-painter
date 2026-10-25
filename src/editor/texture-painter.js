import * as THREE from 'three';
import { executePaintCommand, samplePaintColor } from './paint-operations.js';
import { combineSelectionAlpha, combineSelectionParts, containsSelection, invertSelectionAlpha, moveSelectionInView, selectionFromAlpha,
  selectionFromMask, visibleSelectionSamples } from './lasso-selection.js';
import { faceUvMask } from './face-uv-mask.js';
import { addTextureNode, blendCanvases, cloneTextureGraph, connectTextureNodes,
  createTextureGraph, evaluateTextureNode, removeTextureNode, renderTextureGraph } from './texture-graph.js';
import { addGraphLayer, readLayerStack, removeGraphLayer, syncLayerMasks } from './layer-graph.js';
import { canConnectSurfaceHits, canConnectUvHits } from './surface-stroke.js';
import { applyPaintPatches, capturePaintPatches, commandBounds } from './paint-history.js';
import { moveSelectionInUv, shiftedUvSelection, shiftedUvSelectionParts } from './uv-lasso-move.js';
import { copySelectedPixels, cutSelectedPixels, pasteSelectedPixels } from './selection-clipboard.js';
import { textureResolution as SIZE } from './texture-resolution.js';
import { addDirtyRegion, dirtyArea } from './dirty-regions.js';
import { resizeSelectionAlpha } from './selection-morphology.js';
import { selectionOnPaintSurface } from './selection-layer.js';
import { FILTER_CATEGORIES } from './filter-definitions.js';
import { renderFilterRegion } from './filter-effects.js';
import { combineWandMasks, wandSelectionMask } from './wand-selection.js';
import { surfaceWandTopology } from './surface-wand-topology.js';
import { lineStylePaths } from './line-style.js';
import { scaleLayerRegion, selectionMaskForLayer, uvToLayerPixel } from './layer-space.js';
import { projectGradient, rasterizeProjectedUv } from './gradient-projection.js';
import { createCurveTextureSampler, sampleCurveTexturePixel } from './curve-texture.js';
import { createStampTextureSampler } from './stamp-texture.js';
import { projectSurfaceCurve } from './surface-curve-paint.js';

function configureTextureSampling(texture, antialiasEnabled) {
  texture.magFilter = antialiasEnabled ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = antialiasEnabled ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = antialiasEnabled;
  texture.anisotropy = antialiasEnabled ? 4 : 1;
  texture.needsUpdate = true;
}

export function createTexturePainter(initialRenderer, onGraphHistoryApplied,
  onHistoryApplied) {
  let renderer = initialRenderer;
  const surfaces = new Map();
  let lightingMode = 'shaded';
  let antialiasEnabled = true;
  let wireframeEnabled = false;
  let undoStack = [];
  let redoStack = [];
  let activeStroke = null;
  let linePreview = null;
  let filterSession = null;
  let selection = null;
  let clipboard = null;
  let lassoDraft = null;
  let movePreview = null;
  let overlaySurface = null;
  let overlayRegions = [];
  let maskEnabled = true;
  let isolateBlur = true;
  let projectionPreview = null;
  let isolatedMaterialId = null;

  function materialVisible(surface) {
    return !!surface && (isolatedMaterialId ? surface.id === isolatedMaterialId :
      surface.userVisible !== false);
  }

  function updateMaterialVisibility() {
    for (const record of surfaces.values()) {
      for (const surface of record.slots) {
        const visible = materialVisible(surface);
        surface.shaded.visible = visible;
        surface.unlit.visible = visible;
        surface.overlayMaterial.visible = visible;
        if (Array.isArray(record.wireMaterial))
          record.wireMaterial[surface.slotIndex].visible = visible;
      }
      record.wire.visible = wireframeEnabled && record.slots.some(materialVisible);
    }
  }

  function getMaterialVisibilityState() {
    return { isolatedId: isolatedMaterialId,
      items: [...surfaces.values()].flatMap((record) => record.slots.map((surface) => ({
        id: surface.id, visible: surface.userVisible !== false,
        effectiveVisible: materialVisible(surface)
      }))) };
  }

  function setMaterialVisibility(targetId, visible) {
    const surface = findSurface(targetId);
    if (!surface) return false;
    if (isolatedMaterialId) isolatedMaterialId = null;
    surface.userVisible = Boolean(visible);
    updateMaterialVisibility();
    return true;
  }

  function toggleMaterialIsolation(targetId) {
    if (!findSurface(targetId)) return false;
    isolatedMaterialId = isolatedMaterialId === targetId ? null : targetId;
    updateMaterialVisibility();
    return true;
  }

  function restoreMaterialVisibilityState(saved = {}) {
    const items = [...surfaces.values()].flatMap((record) => record.slots);
    items.forEach((surface, index) => {
      surface.userVisible = saved.visible?.[index] !== false;
    });
    isolatedMaterialId = items[saved.isolatedIndex]?.id ?? null;
    updateMaterialVisibility();
  }

  function endProjectionPreview() {
    if (!projectionPreview) return;
    const { surface, texture, frame } = projectionPreview;
    if (frame !== null) cancelAnimationFrame(frame);
    surface.shaded.map = surface.unlit.map = surface.texture;
    surface.shaded.needsUpdate = surface.unlit.needsUpdate = true;
    texture.dispose();
    projectionPreview = null;
  }

  function makeSurface(original) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d');
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
      imageAssets: new Map(), imageCache: new Map(), compositeFrame: null,
      compositeDirty: [], compositeLastDirty: null, compositeRevision: 0 };
    function uploadRegion(region) {
      if (!surface.uploadCanvas) {
        surface.uploadCanvas = document.createElement('canvas');
        surface.uploadTexture = new THREE.Texture(surface.uploadCanvas);
      }
      const width = region.right - region.left;
      const height = region.bottom - region.top;
      if (surface.uploadCanvas.width !== width) surface.uploadCanvas.width = width;
      if (surface.uploadCanvas.height !== height) surface.uploadCanvas.height = height;
      surface.uploadCanvas.getContext('2d').drawImage(compositeCanvas,
        region.left, region.top, width, height, 0, 0, width, height);
      // Canvas pixels start at the top; WebGL texture positions start at the bottom.
      renderer.copyTextureToTexture(surface.uploadTexture, texture, null,
        new THREE.Vector2(region.left, compositeCanvas.height - region.bottom));
    }
    surface.activePaint = null;
    surface.resetPaint = () => {
      context.clearRect(0, 0, SIZE, SIZE);
      surface.requestComposite();
    };
    surface.refreshComposite = () => {
      if (surface.compositeFrame !== null) cancelAnimationFrame(surface.compositeFrame);
      surface.compositeFrame = null;
      surface.compositeDirty = [];
      renderTextureGraph(surface);
      surface.compositeLastDirty = null;
      surface.compositeRevision++;
    };
    surface.requestComposite = (region = null) => {
      if (surface.compositeFrame === null) surface.compositeDirty = [];
      if (!region) surface.compositeDirty = null;
      else if (surface.compositeDirty) addDirtyRegion(surface.compositeDirty, region,
        compositeCanvas.width, compositeCanvas.height);
      if (surface.compositeFrame !== null) return;
      surface.compositeFrame = requestAnimationFrame(() => {
        surface.compositeFrame = null;
        const dirty = surface.compositeDirty;
        surface.compositeDirty = [];
        let partial = false;
        if (!renderer || !dirty?.length || dirtyArea(dirty) > SIZE * SIZE * 0.4) {
          renderTextureGraph(surface);
        } else {
          try {
            partial = true;
            for (const region of dirty) {
              if (!renderTextureGraph(surface, region)) { partial = false; break; }
              uploadRegion(region);
            }
          } catch { partial = false; renderTextureGraph(surface); }
        }
        surface.compositeLastDirty = partial ? dirty : null;
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
    endProjectionPreview();
    for (const record of surfaces.values()) {
      record.mesh.remove(record.overlay);
      record.mesh.remove(record.wire);
      if (record.wireGeometry) record.wireGeometry.dispose();
      if (Array.isArray(record.wireMaterial))
        record.wireMaterial.forEach((material) => material.dispose());
      else record.wireMaterial.dispose();
      for (const surface of record.slots) {
        if (surface.compositeFrame !== null) cancelAnimationFrame(surface.compositeFrame);
        surface.texture.dispose(); surface.shaded.dispose(); surface.unlit.dispose();
        surface.uploadTexture?.dispose();
        surface.overlayUploadTexture?.dispose();
        surface.overlayTexture.dispose(); surface.overlayMaterial.dispose();
      }
    }
    surfaces.clear(); undoStack = []; redoStack = []; activeStroke = null; linePreview = null;
    selection = null; lassoDraft = null; movePreview = null; filterSession = null;
    overlaySurface = null; overlayRegions = []; isolatedMaterialId = null;
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
        surface.userVisible = true;
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
      const animated = mesh.isSkinnedMesh || !!mesh.morphTargetInfluences?.length;
      record.wireGeometry = animated || isArray ? null : new THREE.EdgesGeometry(mesh.geometry, 1);
      const wireOptions = { color: '#18202a',
        transparent: true, opacity: 0.8, depthTest: true, depthWrite: false,
        toneMapped: false };
      record.wireMaterial = isArray ? record.slots.map(() =>
        new THREE.MeshBasicMaterial({ ...wireOptions, wireframe: true })) : animated ?
          new THREE.MeshBasicMaterial({ ...wireOptions, wireframe: true }) :
          new THREE.LineBasicMaterial(wireOptions);
      record.wire = animated || isArray ?
        (mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, record.wireMaterial) :
          new THREE.Mesh(mesh.geometry, record.wireMaterial)) :
        new THREE.LineSegments(record.wireGeometry, record.wireMaterial);
      if (mesh.isSkinnedMesh) {
        record.wire.bind(mesh.skeleton, mesh.bindMatrix);
        record.wire.bindMode = mesh.bindMode;
      }
      if (mesh.morphTargetInfluences?.length) {
        record.wire.morphTargetInfluences = mesh.morphTargetInfluences;
        record.wire.morphTargetDictionary = mesh.morphTargetDictionary;
      }
      record.wire.visible = wireframeEnabled;
      record.wire.renderOrder = 1;
      record.wire.raycast = () => {};
      mesh.add(record.wire);
      surfaces.set(mesh, record);
      for (const surface of record.slots) {
        const layer = addGraphLayer(surface.graph, 'image');
        const asset = createImage(surface.id, layer.source.id, null, 'Layer 1');
        layer.source.imageKey = asset.key;
        layer.source.imageName = asset.name;
        surface.activePaint = surface.imageAssets.get(asset.key).paintSurface;
        surface.refreshComposite();
      }
      setMeshMaterial(record);
    }
    isolatedMaterialId = null;
    updateMaterialVisibility();
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

  function setWireframeEnabled(enabled) {
    wireframeEnabled = Boolean(enabled);
    updateMaterialVisibility();
  }

  function setAntialiasEnabled(enabled) {
    antialiasEnabled = Boolean(enabled);
    for (const record of surfaces.values()) for (const surface of record.slots) {
      configureTextureSampling(surface.texture, antialiasEnabled);
    }
    if (projectionPreview) configureTextureSampling(projectionPreview.texture, antialiasEnabled);
  }

  function toPixel(uv, canvas = { width: SIZE, height: SIZE }) {
    return uvToLayerPixel(uv, canvas);
  }

  function surfaceAt(hit) {
    return hit?.uv ? surfaces.get(hit.object)?.slots[hit.face?.materialIndex ?? 0]?.activePaint ?? null : null;
  }
  function topologyFor(parent, canvas) {
    parent.topologies ??= new Map();
    const key = `${canvas.width}:${canvas.height}`;
    if (!parent.topologies.has(key)) parent.topologies.set(key,
      surfaceWandTopology(parent.geometry, parent.slotIndex, canvas.width, canvas.height));
    return parent.topologies.get(key);
  }
  function uploadOverlayRegion(surface, region) {
    if (!renderer) { surface.overlayTexture.needsUpdate = true; return; }
    try {
      if (!surface.overlayUploadCanvas) {
        surface.overlayUploadCanvas = document.createElement('canvas');
        surface.overlayUploadTexture = new THREE.Texture(surface.overlayUploadCanvas);
      }
      const width = region.right - region.left;
      const height = region.bottom - region.top;
      if (surface.overlayUploadCanvas.width !== width) surface.overlayUploadCanvas.width = width;
      if (surface.overlayUploadCanvas.height !== height) surface.overlayUploadCanvas.height = height;
      surface.overlayUploadCanvas.getContext('2d').drawImage(surface.overlayCanvas,
        region.left, region.top, width, height, 0, 0, width, height);
      renderer.copyTextureToTexture(surface.overlayUploadTexture, surface.overlayTexture, null,
        new THREE.Vector2(region.left, SIZE - region.bottom));
    } catch { surface.overlayTexture.needsUpdate = true; }
  }

  function renderOverlay(surface = selection?.surface, mask = selection?.overlayCanvas,
    dx = 0, dy = 0, sourceRegions = selectionRegions(selection)) {
    if (overlaySurface && overlaySurface !== surface) {
      for (const region of overlayRegions) {
        overlaySurface.overlayContext.clearRect(region.left, region.top,
          region.right - region.left, region.bottom - region.top);
        uploadOverlayRegion(overlaySurface, region);
      }
      overlayRegions = [];
    }
    overlaySurface = surface ?? null;
    if (!surface) return;
    const source = mask ? sourceRegions.map((region) => ({
      left: Math.max(0, region.left - 2), top: Math.max(0, region.top - 2),
      right: Math.min(SIZE, region.right + 2), bottom: Math.min(SIZE, region.bottom + 2)
    })) : [];
    const next = [];
    for (const region of source) addDirtyRegion(next, {
      left: region.left + dx, top: region.top + dy,
      right: region.right + dx, bottom: region.bottom + dy
    }, SIZE, SIZE);
    const dirty = [];
    for (const region of [...overlayRegions, ...next])
      addDirtyRegion(dirty, region, SIZE, SIZE);
    const context = surface.overlayContext;
    for (const region of dirty) context.clearRect(region.left, region.top,
      region.right - region.left, region.bottom - region.top);
    for (const region of source) context.drawImage(mask, region.left, region.top,
      region.right - region.left, region.bottom - region.top,
      region.left + dx, region.top + dy,
      region.right - region.left, region.bottom - region.top);
    for (const region of dirty) uploadOverlayRegion(surface, region);
    overlayRegions = next;
  }

  function recordSelection(next) {
    const before = selection;
    selection = next;
    undoStack.push({ patches: [], selectionBefore: before, selectionAfter: next });
    redoStack = [];
    renderOverlay();
  }

  function beginLasso(hit, mode = 'replace') {
    const surface = surfaceAt(hit);
    if (!surface) return false;
    if (lassoDraft) return surface === lassoDraft.surface;
    lassoDraft = { surface, before: selection, mode };
    if (mode === 'replace') {
      selection = null;
      renderOverlay();
    }
    return true;
  }

  function endLasso(maskCanvas, mirrorMask = null) {
    if (!lassoDraft) return false;
    const { surface, before, mode } = lassoDraft;
    lassoDraft = null;
    const primary = maskCanvas ? selectionFromMask(surface, maskCanvas) : null;
    const mirrored = mirrorMask ? selectionFromMask(surface, mirrorMask) : null;
    const picked = primary && mirrored ? combineSelectionParts(surface, [primary, mirrored]) : primary;
    selection = before;
    if (!picked || (mode === 'subtract' && before?.surface !== surface)) {
      renderOverlay();
      return false;
    }
    let next = picked;
    if (mode !== 'replace' && before?.surface === surface) {
      if (before.parts?.length === 2 &&
          (mode === 'subtract' || picked.parts?.length === 2)) {
        const distance = (first, second) => {
          const center = (bounds) => ({ x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2 });
          const a = center(first.bounds);
          const b = center(second.bounds);
          return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        };
        const masks = mode === 'subtract' ? [picked, picked] :
          distance(before.parts[0], picked.parts[0]) +
          distance(before.parts[1], picked.parts[1]) <=
          distance(before.parts[0], picked.parts[1]) +
          distance(before.parts[1], picked.parts[0]) ? picked.parts :
            [picked.parts[1], picked.parts[0]];
        let changed = false;
        const parts = before.parts.map((part, index) => {
          const merged = combineSelectionAlpha(part, masks[index], mode);
          changed ||= merged.changed;
          return selectionFromAlpha(surface, merged.alpha, null, merged.indices);
        }).filter(Boolean);
        if (!changed) { renderOverlay(); return false; }
        next = parts.length > 1 ? combineSelectionParts(surface, parts) : parts[0] ?? null;
      } else {
        const { alpha, indices, changed } = combineSelectionAlpha(before, picked, mode);
        if (!changed) { renderOverlay(); return false; }
        next = selectionFromAlpha(surface, alpha, null, indices);
      }
    }
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

  function selectWand(hit, options = {}, mode = 'replace', mirroredHit = null,
    samplingMode = 'surface') {
    const surface = surfaceAt(hit);
    if (!surface || lassoDraft || movePreview || activeStroke || linePreview || filterSession) return false;
    commitFloatingSelection();
    const parent = findSurface(surface.id);
    if (options.allLayers) parent.refreshComposite();
    let context = options.allLayers ? parent.compositeContext : surface.context;
    if (!options.allLayers && (surface.canvas.width !== SIZE || surface.canvas.height !== SIZE)) {
      const atlas = document.createElement('canvas');
      atlas.width = atlas.height = SIZE;
      context = atlas.getContext('2d', { willReadFrequently: true });
      context.drawImage(surface.canvas, 0, 0, SIZE, SIZE);
    }
    const image = context.getImageData(0, 0, SIZE, SIZE);
    const topology = samplingMode === 'surface' ? topologyFor(parent, parent.canvas) : null;
    const makeMask = (sourceHit) => {
      const point = toPixel(sourceHit.uv);
      return wandSelectionMask(image,
        Math.max(0, Math.min(SIZE - 1, Math.floor(point.x))),
        Math.max(0, Math.min(SIZE - 1, Math.floor(point.y))),
        options.threshold ?? 30, options.similar === true, topology, sourceHit.faceIndex);
    };
    const primary = makeMask(hit);
    const mirrored = mirroredHit && surfaceAt(mirroredHit) === surface ? makeMask(mirroredHit) : null;
    const old = selection?.surface === surface ? selection : null;
    let next;
    if (mode === 'replace' && mirrored) {
      const parts = [selectionFromAlpha(surface, primary, null, null, true, topology),
        selectionFromAlpha(surface, mirrored, null, null, true, topology)]
        .filter(Boolean);
      next = parts.length > 1 ? combineSelectionParts(surface, parts, true, topology) :
        parts[0] ?? null;
    } else {
      const added = mirrored ? combineWandMasks(primary, mirrored, 'add') : primary;
      const alpha = combineWandMasks(old?.alpha, added, mode);
      next = selectionFromAlpha(surface, alpha, null, null, true, topology);
    }
    recordSelection(next);
    return !!next;
  }

  function selectFaces(targetId, faceIds, mode = 'replace') {
    const parent = findSurface(targetId);
    const surface = parent?.activePaint;
    if (!surface || lassoDraft || movePreview || activeStroke || linePreview || filterSession)
      return false;
    if (!faceIds.size) {
      if (mode === 'replace') clearSelection();
      return false;
    }
    const old = selection?.surface === surface ? selection : null;
    if (mode === 'subtract' && !old) return false;
    commitFloatingSelection();
    const picked = selectionFromMask(surface,
      faceUvMask(parent.geometry, faceIds, SIZE));
    if (!picked) return false;
    if (mode === 'replace' || !old) {
      recordSelection(picked);
    } else {
      const { alpha, indices, changed } = combineSelectionAlpha(old, picked, mode);
      if (!changed) return false;
      recordSelection(selectionFromAlpha(surface, alpha, null, indices));
    }
    return true;
  }

  function selectionFromPixels(surface, alpha, indices) {
    return indices.length ? selectionFromAlpha(surface, alpha, null, indices) :
      { surface, alpha, indices: new Uint32Array(0),
        bounds: { left: 0, top: 0, right: 0, bottom: 0 }, overlayCanvas: null };
  }

  function invertSelection() {
    if (!selection || lassoDraft || movePreview) return false;
    commitFloatingSelection();
    const { alpha, indices } = invertSelectionAlpha(selection.alpha);
    recordSelection(selectionFromPixels(selection.surface, alpha, indices));
    return true;
  }

  function resizeSelection(amount, expand) {
    if (!selection?.indices.length || lassoDraft || movePreview ||
      !Number.isInteger(amount) || amount < 1 || amount > 100) return false;
    const alpha = resizeSelectionAlpha(selection.alpha, SIZE, SIZE, amount, expand);
    const indices = [];
    let changed = false;
    for (let index = 0; index < alpha.length; index++) {
      if (alpha[index]) indices.push(index);
      if (alpha[index] !== selection.alpha[index]) changed = true;
    }
    if (!changed) return false;
    commitFloatingSelection();
    recordSelection(selectionFromPixels(selection.surface, alpha, indices));
    return true;
  }

  function selectedAt(hit) {
    return !!selection && surfaceAt(hit) === selection.surface && containsSelection(selection, toPixel(hit.uv));
  }

  function selectionRegions(value, dx = 0, dy = 0) {
    if (!value) return [];
    const parts = value.parts?.length ? value.parts : [value];
    return parts.map((part) => {
      let bounds = part.bounds;
      if (!bounds && part.indices?.length) {
        bounds = { left: SIZE, top: SIZE, right: 0, bottom: 0 };
        for (const index of part.indices) {
          const x = index % SIZE;
          const y = Math.floor(index / SIZE);
          bounds.left = Math.min(bounds.left, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.right = Math.max(bounds.right, x + 1);
          bounds.bottom = Math.max(bounds.bottom, y + 1);
        }
      }
      return bounds && { left: bounds.left + dx, top: bounds.top + dy,
        right: bounds.right + dx, bottom: bounds.bottom + dy };
    }).filter(Boolean);
  }

  function writeMovePreview(preview, output, nextRegions) {
    const surface = preview.before.surface;
    if (surface.canvas.width !== SIZE || surface.canvas.height !== SIZE) {
      writeAtlasImage(surface, output);
      surface.requestComposite();
      preview.lastPaintRegions = nextRegions;
      return;
    }
    const regions = [];
    for (const region of [...selectionRegions(preview.before),
      ...(preview.lastPaintRegions ?? []), ...nextRegions])
      addDirtyRegion(regions, region, SIZE, SIZE);
    for (const region of regions) {
      surface.context.putImageData(output, 0, 0, region.left, region.top,
        region.right - region.left, region.bottom - region.top);
      surface.requestComposite(region);
    }
    preview.lastPaintRegions = nextRegions;
  }

  function readAtlasImage(surface) {
    if (surface.canvas.width === SIZE && surface.canvas.height === SIZE)
      return surface.context.getImageData(0, 0, SIZE, SIZE);
    const atlas = document.createElement('canvas');
    atlas.width = atlas.height = SIZE;
    const context = atlas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(surface.canvas, 0, 0, SIZE, SIZE);
    return context.getImageData(0, 0, SIZE, SIZE);
  }

  function writeAtlasImage(surface, image) {
    if (surface.canvas.width === SIZE && surface.canvas.height === SIZE) {
      surface.context.putImageData(image, 0, 0);
      return;
    }
    let atlas = surface.editAtlas;
    if (!atlas) {
      atlas = document.createElement('canvas');
      atlas.width = atlas.height = SIZE;
      surface.editAtlas = atlas;
    }
    atlas.getContext('2d').putImageData(image, 0, 0);
    surface.context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    surface.context.imageSmoothingEnabled = false;
    surface.context.drawImage(atlas, 0, 0, surface.canvas.width, surface.canvas.height);
  }

  function copySelection() {
    if (!selection || lassoDraft || movePreview) return false;
    const image = selection.floatingSourceImage ?? readAtlasImage(selection.surface);
    clipboard = copySelectedPixels(image, selection);
    return true;
  }

  function cutSelection() {
    if (!copySelection()) return false;
    const nativeBefore = selection.surface.context.getImageData(0, 0,
      selection.surface.canvas.width, selection.surface.canvas.height);
    const before = readAtlasImage(selection.surface);
    const after = selection.surface.context.createImageData(SIZE, SIZE);
    after.data.set(selection.floatingBase?.data ?? cutSelectedPixels(before, selection));
    writeAtlasImage(selection.surface, after);
    selection.surface.requestComposite();
    const previous = selection;
    selection = null;
    undoStack.push({ patches: capturePaintPatches([{ kind: 'moveSelection', surface: previous.surface }],
      new Map([[previous.surface, nativeBefore]])), selectionBefore: previous, selectionAfter: null });
    redoStack = [];
    renderOverlay();
    return true;
  }

  function pasteSelection(targetId) {
    const surface = findSurface(targetId)?.activePaint;
    if (!clipboard || !surface || lassoDraft || movePreview) return false;
    const nativeBefore = surface.context.getImageData(0, 0,
      surface.canvas.width, surface.canvas.height);
    const before = readAtlasImage(surface);
    const after = surface.context.createImageData(SIZE, SIZE);
    after.data.set(pasteSelectedPixels(before, clipboard));
    writeAtlasImage(surface, after);
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
      new Map([[surface, nativeBefore]])), selectionBefore: previous, selectionAfter: next });
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
      after: selection, image: readAtlasImage(selection.surface),
      nativeBefore: selection.surface.context.getImageData(0, 0,
        selection.surface.canvas.width, selection.surface.canvas.height),
      sourceImage: selection.floatingSourceImage ?? null, baseImage: selection.floatingBase ?? null,
      scratch: selection.surface.context.createImageData(SIZE, SIZE),
      destinationAlpha: mode === 'surface' ? new Uint8Array(SIZE * SIZE) : null,
      moveReuse: { initialized: false, previousIndices: [] },
      lastPaintRegions: [] };
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
      writeMovePreview(movePreview, image, []);
      movePreview.after = before;
      renderOverlay();
      return true;
    }
    if (movePreview.mode === 'uv') {
      const offsets = movePreview.paired ? [0, 1].map((index) => index === movePreview.originPart ?
        { dx, dy } : { dx: mirrorDx, dy: mirrorDy }) : null;
      movePreview.offsets = offsets;
      const movedImage = moveSelectionInUv(before.surface, before,
        sourceImage ?? image, dx, dy, offsets, baseImage,
        movePreview.scratch, movePreview.moveReuse);
      movePreview.after = offsets ? shiftedUvSelectionParts(before, offsets) : null;
      const nextRegions = offsets ? selectionRegions(movePreview.after) :
        selectionRegions(before, dx, dy);
      writeMovePreview(movePreview, movedImage, nextRegions);
      renderOverlay(before.surface, offsets ? movePreview.after?.overlayCanvas ?? null :
        before.overlayCanvas, offsets ? 0 : dx, offsets ? 0 : dy,
      offsets ? nextRegions : selectionRegions(before));
    } else {
      const branches = movePreview.branches?.map((branch) => ({ ...branch,
        dx: dx * branch.sign, dy }));
      movePreview.movedBranches = branches;
      const moved = moveSelectionInView(before, sourceImage ?? image,
        movePreview.projection, movePreview.samples, dx, dy, movePreview.scratch,
        movePreview.destinationAlpha, branches, baseImage, movePreview.moveReuse);
      movePreview.after = moved.parts ? combineSelectionParts(before.surface,
        moved.parts.filter((part) => part.indices.length), false) :
        selectionFromAlpha(before.surface, moved.alpha, null, moved.indices, false);
      const nextRegions = selectionRegions(movePreview.after);
      writeMovePreview(movePreview, moved.image, nextRegions);
      renderOverlay(before.surface, movePreview.after?.overlayCanvas ?? null, 0, 0,
        nextRegions);
    }
    return true;
  }

  function endMove() {
    if (!movePreview) return false;
    const { before, after: previewAfter, image, nativeBefore, sourceImage, baseImage,
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
    undoStack.push({ patches: capturePaintPatches([command], new Map([[before.surface, nativeBefore]])),
      selectionBefore: before, selectionAfter: after });
    redoStack = [];
    selection = after;
    renderOverlay();
    return true;
  }

  function cancelMove() {
    if (!movePreview) return false;
    const { before, image, nativeBefore } = movePreview;
    if (before.surface.canvas.width !== SIZE || before.surface.canvas.height !== SIZE) {
      before.surface.context.putImageData(nativeBefore, 0, 0);
      before.surface.requestComposite();
    } else writeMovePreview(movePreview, image, []);
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
    const point = toPixel(hit.uv, surface.canvas);
    const previous = surfaceAt(previousHit) === surface ? toPixel(previousHit.uv, surface.canvas) : null;
    const continuous = previous && (mode === 'uv' ?
      canConnectUvHits(previousHit, hit, previous, point, surface.canvas.width * 0.2) :
      canConnectSurfaceHits(previousHit, hit, previous, point, surface.canvas.width * 0.2));
    apply({ kind, surface, point, previous: continuous ? previous : null,
      options: { ...options }, mask: maskEnabled ? selectionMaskForLayer(selection, surface.canvas) : null,
      isolateBlur, faceIndex: hit.faceIndex, topology: kind === 'blur' && mode === 'surface' ?
        topologyFor(findSurface(surface.id), surface.canvas) : null });
    return hit;
  }

  function fill(hit, options) {
    const surface = surfaceAt(hit);
    if (!surface || (selection && maskEnabled && surface !== selection.surface)) return false;
    return apply({ kind: 'bucket', surface, point: toPixel(hit.uv, surface.canvas), options: { ...options },
      mask: maskEnabled ? selectionMaskForLayer(selection, surface.canvas) : null });
  }

  function applyGradient(targetId, camera, viewport, start, end, options, visibleUv,
    mirror = null) {
    const parent = findSurface(targetId);
    const surface = parent?.activePaint;
    const face = getFaceTarget(targetId);
    if (!surface || !face || !materialVisible(parent) || activeStroke || linePreview || filterSession ||
        (selection && maskEnabled && selection.surface !== surface)) return false;
    const { canvas, context } = surface;
    const mask = selection && maskEnabled ? selectionMaskForLayer(selection, canvas)?.alpha : null;
    const projectionOptions = { mesh: face.mesh, materialIndex: face.materialIndex,
      width: canvas.width, height: canvas.height,
      viewportWidth: viewport.width, viewportHeight: viewport.height,
      start, end, selection: mask };
    const projected = projectGradient({ ...projectionOptions, camera, visibleUv,
      mirrorPlane: mirror?.plane, side: mirror?.side ?? null });
    if (!projected) return false;
    if (mirror) {
      const reflected = projectGradient({ ...projectionOptions, camera: mirror.camera,
        visibleUv: mirror.visibleUv, mirrorPlane: mirror.plane,
        side: -mirror.side, includePlane: false, flipScreenX: true });
      for (let i = 0; i < projected.covered.length; i++) {
        if (!reflected.covered[i]) continue;
        projected.covered[i] = 1;
        projected.values[i] = reflected.values[i];
      }
    }
    const before = context.getImageData(0, 0, canvas.width, canvas.height);
    const after = new ImageData(new Uint8ClampedArray(before.data), canvas.width, canvas.height);
    const parse = (entry) => {
      const hex = (entry?.color || '#000000').replace('#', '');
      return [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0,
        parseInt(hex.slice(4, 6), 16) || 0, Math.max(0, Math.min(1,
          Number(entry?.alpha ?? 100) / 100))];
    };
    const first = parse(options.startColor), last = parse(options.endColor);
    const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
    let changed = false;
    for (let i = 0; i < projected.covered.length; i++) {
      if (!projected.covered[i]) continue;
      const t = projected.values[i] / 255;
      const coverage = mask ? mask[i] / 255 : 1;
      const sourceAlpha = (first[3] + (last[3] - first[3]) * t) * coverage;
      if (sourceAlpha <= 0) continue;
      const offset = i * 4;
      const destAlpha = before.data[offset + 3] / 255;
      const resultAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
      let differs = false;
      for (let channel = 0; channel < 3; channel++) {
        const source = first[channel] + (last[channel] - first[channel]) * t;
        const result = Math.round((source * sourceAlpha + before.data[offset + channel] *
          destAlpha * (1 - sourceAlpha)) / resultAlpha);
        if (result !== before.data[offset + channel]) differs = true;
        after.data[offset + channel] = result;
      }
      const alpha = Math.round(resultAlpha * 255);
      if (alpha !== before.data[offset + 3]) differs = true;
      after.data[offset + 3] = alpha;
      if (!differs) continue;
      changed = true;
      const x = i % canvas.width, y = (i / canvas.width) | 0;
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x + 1);
      bounds.bottom = Math.max(bounds.bottom, y + 1);
    }
    if (!changed) return false;
    const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    const beforePatch = context.createImageData(width, height);
    const afterPatch = context.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      const from = ((bounds.top + row) * canvas.width + bounds.left) * 4;
      beforePatch.data.set(before.data.subarray(from, from + width * 4), row * width * 4);
      afterPatch.data.set(after.data.subarray(from, from + width * 4), row * width * 4);
    }
    commitFloatingSelection();
    context.putImageData(afterPatch, bounds.left, bounds.top);
    surface.requestComposite(bounds);
    undoStack.push({ patches: [{ surface, x: bounds.left, y: bounds.top,
      before: beforePatch, after: afterPatch }] });
    redoStack = [];
    return true;
  }

  function applyCurveTexture(targetId, camera, viewport, points, image, options,
    visibleUv, mirror = null) {
    const sampler = createCurveTextureSampler(points, image, options);
    if (!sampler) return false;
    const radius = Math.max(1, options.size) / 2 + (options.antialias ? 4 : 1);
    const screenBounds = { left: Math.min(...points.map((point) => point.x)) - radius,
      right: Math.max(...points.map((point) => point.x)) + radius,
      top: Math.min(...points.map((point) => point.y)) - radius,
      bottom: Math.max(...points.map((point) => point.y)) + radius };
    return applyProjectedImage(targetId, camera, viewport, sampler, screenBounds,
      options, visibleUv, mirror);
  }

  function applyStamp(targetId, camera, viewport, image, placement, options,
    visibleUv, mirror = null) {
    const sampler = createStampTextureSampler(image, placement, options);
    if (!sampler) return false;
    const margin = options.antialias ? 4 : 1;
    const screenBounds = { left: placement.bounds.left - margin,
      right: placement.bounds.right + margin, top: placement.bounds.top - margin,
      bottom: placement.bounds.bottom + margin };
    return applyProjectedImage(targetId, camera, viewport, sampler, screenBounds,
      options, visibleUv, mirror);
  }

  function applyProjectedImage(targetId, camera, viewport, sampler, screenBounds,
    options, visibleUv, mirror = null) {
    const parent = findSurface(targetId);
    const surface = parent?.activePaint;
    const face = getFaceTarget(targetId);
    if (!surface || !face || !materialVisible(parent) || activeStroke || linePreview ||
        filterSession || (selection && maskEnabled && selection.surface !== surface)) return false;
    const { canvas, context } = surface;
    const mask = selection && maskEnabled ? selectionMaskForLayer(selection, canvas)?.alpha : null;
    const before = context.getImageData(0, 0, canvas.width, canvas.height);
    const after = new ImageData(new Uint8ClampedArray(before.data), canvas.width, canvas.height);
    const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
    let changed = false;
    const project = (viewCamera, visibility, plane, side, includePlane, flipped) =>
      rasterizeProjectedUv({ mesh: face.mesh, materialIndex: face.materialIndex,
        camera: viewCamera, width: canvas.width, height: canvas.height,
        viewportWidth: viewport.width, viewportHeight: viewport.height,
        visibleUv: visibility, selection: mask, mirrorPlane: plane, side, includePlane,
        screenDerivatives: Boolean(options.antialias),
        screenBounds: flipped ? { ...screenBounds,
          left: viewport.width - screenBounds.right,
          right: viewport.width - screenBounds.left } : screenBounds },
      (pixel, sx, sy, derivatives) => {
        const footprint = flipped && derivatives ?
          [-derivatives[0], derivatives[1], -derivatives[2], derivatives[3]] : derivatives;
        const color = sampleCurveTexturePixel(sampler,
          flipped ? viewport.width - sx : sx, sy, footprint);
        if (!color) return;
        const sourceAlpha = color[3] / 255 * (mask ? mask[pixel] / 255 : 1);
        if (sourceAlpha <= 0) return;
        const offset = pixel * 4;
        const destAlpha = after.data[offset + 3] / 255;
        const resultAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
        for (let channel = 0; channel < 3; channel++) {
          after.data[offset + channel] = Math.round((color[channel] * sourceAlpha +
            after.data[offset + channel] * destAlpha * (1 - sourceAlpha)) / resultAlpha);
        }
        after.data[offset + 3] = Math.round(resultAlpha * 255);
        changed = true;
        const x = pixel % canvas.width, y = (pixel / canvas.width) | 0;
        bounds.left = Math.min(bounds.left, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x + 1);
        bounds.bottom = Math.max(bounds.bottom, y + 1);
      });
    project(camera, visibleUv, mirror?.plane ?? null, mirror?.side ?? null, true, false);
    if (mirror) project(mirror.camera, mirror.visibleUv, mirror.plane, -mirror.side, false, true);
    if (!changed) return false;
    const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    const beforePatch = context.createImageData(width, height);
    const afterPatch = context.createImageData(width, height);
    for (let row = 0; row < height; row++) {
      const from = ((bounds.top + row) * canvas.width + bounds.left) * 4;
      beforePatch.data.set(before.data.subarray(from, from + width * 4), row * width * 4);
      afterPatch.data.set(after.data.subarray(from, from + width * 4), row * width * 4);
    }
    commitFloatingSelection();
    context.putImageData(afterPatch, bounds.left, bounds.top);
    surface.requestComposite(bounds);
    undoStack.push({ patches: [{ surface, x: bounds.left, y: bounds.top,
      before: beforePatch, after: afterPatch }] });
    redoStack = [];
    return true;
  }

  function applySurfaceCurve(targetId, path, image, options, mirror = null,
    curveHistory = null) {
    const parent = findSurface(targetId);
    const surface = parent?.activePaint;
    if (!surface || !materialVisible(parent) || activeStroke || linePreview || filterSession ||
        (selection && maskEnabled && selection.surface !== surface)) return false;
    const { canvas, context } = surface;
    const mask = selection && maskEnabled ? selectionMaskForLayer(selection, canvas)?.alpha : null;
    const projected = projectSurfaceCurve(path, image, options, canvas.width,
      canvas.height, mask, mirror);
    if (!projected.size) return false;
    const bounds = { left: canvas.width, top: canvas.height, right: 0, bottom: 0 };
    for (const pixel of projected.keys()) {
      const x = pixel % canvas.width, y = (pixel / canvas.width) | 0;
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x + 1);
      bounds.bottom = Math.max(bounds.bottom, y + 1);
    }
    const patchWidth = bounds.right - bounds.left;
    const patchHeight = bounds.bottom - bounds.top;
    const beforePatch = context.getImageData(bounds.left, bounds.top,
      patchWidth, patchHeight);
    const afterPatch = new ImageData(new Uint8ClampedArray(beforePatch.data),
      patchWidth, patchHeight);
    let changed = false;
    for (const [pixel, color] of projected) {
      const sourceAlpha = color[3] / 255 * (mask ? mask[pixel] / 255 : 1);
      if (sourceAlpha <= 0) continue;
      const x = pixel % canvas.width, y = (pixel / canvas.width) | 0;
      const offset = ((y - bounds.top) * patchWidth + x - bounds.left) * 4;
      const destinationAlpha = beforePatch.data[offset + 3] / 255;
      const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      let differs = false;
      for (let channel = 0; channel < 3; channel++) {
        const result = Math.round((color[channel] * sourceAlpha +
          beforePatch.data[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / resultAlpha);
        afterPatch.data[offset + channel] = result;
        if (result !== beforePatch.data[offset + channel]) differs = true;
      }
      const alpha = Math.round(resultAlpha * 255);
      afterPatch.data[offset + 3] = alpha;
      if (alpha !== beforePatch.data[offset + 3]) differs = true;
      if (!differs) continue;
      changed = true;
    }
    if (!changed) return false;
    commitFloatingSelection();
    context.putImageData(afterPatch, bounds.left, bounds.top);
    surface.requestComposite(bounds);
    undoStack.push({ patches: [{ surface, x: bounds.left, y: bounds.top,
      before: beforePatch, after: afterPatch }], curveHistory });
    redoStack = [];
    return true;
  }

  function sample(hit) {
    const surface = hit?.uv ? surfaces.get(hit.object)?.slots[hit.face?.materialIndex ?? 0] : null;
    if (!surface) return null;
    if (surface.compositeFrame !== null) surface.refreshComposite();
    return samplePaintColor(surface, toPixel(hit.uv));
  }

  function beginLine(hit, options, mirroredHit = null, mode = 'surface', preservePath = false) {
    const surface = surfaceAt(hit);
    if (!surface || (selection && maskEnabled && surface !== selection.surface)) return false;
    commitFloatingSelection();
    const styledUv = mode === 'uv' && !preservePath && options.lineStyle &&
      options.lineStyle !== 'solid';
    linePreview = { options: { ...options }, mode,
      preservePath: preservePath || styledUv || options.lineStyle === 'wavy',
      styledUv, before: new Map(),
      lastDirty: new Map(), commands: [] };
    updateLine([[hit], mirroredHit ? [mirroredHit] : []]);
    return true;
  }

  function beginThroughLine(options) {
    commitFloatingSelection();
    linePreview = { options: { ...options }, mode: 'surface', preservePath: true,
      before: new Map(), lastDirty: new Map(), commands: [] };
    return true;
  }

  function updateLine(paths) {
    if (!linePreview) return false;
    const { before, options, mode, preservePath, styledUv, lastDirty } = linePreview;
    for (const [surface, regions] of lastDirty) {
      const image = before.get(surface);
      for (const region of regions) {
        surface.context.putImageData(image, 0, 0, region.left, region.top,
          region.right - region.left, region.bottom - region.top);
        surface.requestComposite(region);
      }
    }
    const commands = [];
    for (const rawHits of paths) {
      if (mode === 'uv' && !preservePath && (!rawHits[0] || !rawHits.at(-1))) continue;
      if (mode === 'uv' && !preservePath && rawHits.length > 1 &&
          surfaceAt(rawHits[0]) !== surfaceAt(rawHits.at(-1))) continue;
      let hits = mode === 'uv' && !preservePath ? [rawHits[0], rawHits.at(-1)] : rawHits;
      if (styledUv && rawHits[0] && rawHits.at(-1)) {
        const surface = surfaceAt(rawHits[0]);
        if (!surface || surfaceAt(rawHits.at(-1)) !== surface) continue;
        const start = toPixel(rawHits[0].uv, surface.canvas);
        const end = toPixel(rawHits.at(-1).uv, surface.canvas);
        hits = lineStylePaths(start, end, options).flatMap((path, index) => [
          ...(index ? [null] : []),
          ...path.map((point) => ({ ...rawHits[0], uv: {
            x: point.x / surface.canvas.width, y: 1 - point.y / surface.canvas.height
          } }))
        ]);
      }
      let previousHit = null;
      let previousPoint = null;
      let segment = null;
      for (const hit of hits) {
        const surface = surfaceAt(hit);
        if (!surface || (selection && maskEnabled && surface !== selection.surface)) {
          previousHit = null; previousPoint = null; segment = null;
          continue;
        }
        if (!before.has(surface)) before.set(surface, surface.context.getImageData(0, 0,
          surface.canvas.width, surface.canvas.height));
        const point = toPixel(hit.uv, surface.canvas);
        const connected = segment && surface === segment.surface &&
          ((mode === 'uv' && (!styledUv || Math.hypot(point.x - previousPoint.x,
            point.y - previousPoint.y) < surface.canvas.width * 0.2)) ||
            canConnectSurfaceHits(previousHit, hit, previousPoint, point,
            surface.canvas.width * 0.2));
        if (preservePath) {
          // A curve must retain each short sampled segment. Extending one command to
          // the last hit would replace the curve with a straight stroke on commit.
          if (!connected || Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) > 0.01) {
            segment = { kind: 'line', surface, point,
              previous: connected ? previousPoint : point, options,
              mask: maskEnabled ? selectionMaskForLayer(selection, surface.canvas) : null };
            commands.push(segment);
          }
        } else if (connected) {
          segment.point = point;
        } else {
          segment = { kind: 'line', surface, point, previous: point, options,
            mask: maskEnabled ? selectionMaskForLayer(selection, surface.canvas) : null };
          commands.push(segment);
        }
        previousHit = hit;
        previousPoint = point;
      }
    }
    linePreview.commands = commands;
    linePreview.changed = false;
    linePreview.lastDirty = new Map();
    for (const command of commands) {
      if (executePaintCommand(command)) {
        linePreview.changed = true;
        let regions = linePreview.lastDirty.get(command.surface);
        if (!regions) linePreview.lastDirty.set(command.surface, regions = []);
        addDirtyRegion(regions, commandBounds(command,
          command.surface.canvas.width, command.surface.canvas.height),
        command.surface.canvas.width, command.surface.canvas.height);
      }
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
    for (const [surface, regions] of linePreview.lastDirty) {
      const image = linePreview.before.get(surface);
      for (const region of regions) {
        surface.context.putImageData(image, 0, 0, region.left, region.top,
          region.right - region.left, region.bottom - region.top);
        surface.requestComposite(region);
      }
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

  function recordCurveDraftChange(before, after) {
    const previous = before.anchors, next = after.anchors;
    if (previous.length === next.length && previous.every((anchor, index) =>
      anchor.faceIndex === next[index].faceIndex &&
      anchor.point.distanceToSquared(next[index].point) < 1e-14)) return false;
    undoStack.push({ curveDraft: { before, after } });
    redoStack = [];
    return true;
  }

  function undo() {
    if (!undoStack.length || activeStroke || linePreview || filterSession) return false;
    const entry = undoStack.pop(); redoStack.push(entry);
    if (entry.graph) {
      setGraph(entry.graph.targetId, entry.graph.before);
      onGraphHistoryApplied?.(entry.graph.targetId, entry.graph.before);
    } else if (entry.patches) applyPaintPatches(entry.patches, 'before');
    if ('selectionBefore' in entry) {
      const previous = entry.selectionBefore;
      selection = selectionOnPaintSurface(previous, findSurface(previous?.surface.id)?.activePaint);
      renderOverlay();
    }
    onHistoryApplied?.(entry, 'undo');
    return true;
  }

  function redo() {
    if (!redoStack.length || activeStroke || linePreview || filterSession) return false;
    const entry = redoStack.pop(); undoStack.push(entry);
    if (entry.graph) {
      setGraph(entry.graph.targetId, entry.graph.after);
      onGraphHistoryApplied?.(entry.graph.targetId, entry.graph.after);
    } else if (entry.patches) applyPaintPatches(entry.patches, 'after');
    if ('selectionAfter' in entry) {
      const next = entry.selectionAfter;
      selection = selectionOnPaintSurface(next, findSurface(next?.surface.id)?.activePaint);
      renderOverlay();
    }
    onHistoryApplied?.(entry, 'redo');
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

  function recordGraphChange(targetId, before, after) {
    if (!findSurface(targetId) || JSON.stringify(before) === JSON.stringify(after)) return false;
    undoStack.push({ graph: { targetId, before: cloneTextureGraph(before),
      after: cloneTextureGraph(after) } });
    redoStack = [];
    return true;
  }

  function beginProjectionPreview(targetId) {
    endProjectionPreview();
    const surface = findSurface(targetId);
    if (!surface) return false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(256, surface.canvas.width);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    configureTextureSampling(texture, antialiasEnabled);
    const previewSurface = { canvas, compositeCanvas: canvas,
      compositeContext: canvas.getContext('2d'), texture,
      graph: surface.graph, imageAssets: surface.imageAssets,
      imageCache: new Map(), geometry: surface.geometry, slotIndex: surface.slotIndex };
    projectionPreview = { surface, canvas, texture, previewSurface,
      frame: null, graph: null, visible: false, revision: 0, lastRender: 0 };
    return true;
  }

  function previewProjectionGraph(targetId, graph) {
    const preview = projectionPreview;
    if (!preview || preview.surface.id !== targetId) return false;
    preview.graph = graph;
    if (preview.frame !== null) return true;
    const draw = (time) => {
      if (projectionPreview !== preview) return;
      if (time - preview.lastRender < 50) {
        preview.frame = requestAnimationFrame(draw);
        return;
      }
      preview.frame = null;
      preview.lastRender = time;
      preview.previewSurface.graph = preview.graph;
      renderTextureGraph(preview.previewSurface);
      preview.revision++;
      if (!preview.visible) {
        preview.surface.shaded.map = preview.surface.unlit.map = preview.texture;
        preview.surface.shaded.needsUpdate = preview.surface.unlit.needsUpdate = true;
        preview.visible = true;
      }
    };
    preview.frame = requestAnimationFrame(draw);
    return true;
  }

  function getFaceTarget(targetId) {
    for (const record of surfaces.values()) {
      const slot = record.slots.find((item) => item.id === targetId);
      if (slot) return { mesh: record.mesh, materialIndex: slot.slotIndex };
    }
    return null;
  }

  function getLayerImage(targetId, imageKey) {
    return findSurface(targetId)?.imageAssets.get(imageKey)?.canvas ?? null;
  }

  function getImageInfo(targetId, imageKey) {
    const asset = findSurface(targetId)?.imageAssets.get(imageKey);
    return asset ? { width: asset.canvas.width,
      height: asset.canvas.height,
      imported: asset.imported } : null;
  }

  function getCompositePreview(targetId) {
    const surface = findSurface(targetId);
    if (projectionPreview?.surface === surface && projectionPreview.visible)
      return { canvas: projectionPreview.canvas, revision: projectionPreview.revision,
        regions: null };
    return surface ? { canvas: surface.compositeCanvas, revision: surface.compositeRevision,
      regions: surface.compositeLastDirty } : null;
  }

  function getExportTextures() {
    return [...surfaces.values()].flatMap((record) => record.slots.map((surface) => {
      const canvas = document.createElement('canvas');
      canvas.width = surface.canvas.width;
      canvas.height = surface.canvas.height;
      renderTextureGraph({ canvas: surface.canvas, compositeCanvas: canvas,
        compositeContext: canvas.getContext('2d'), texture: { needsUpdate: false },
        transparentBase: true, graph: surface.graph,
        imageAssets: surface.imageAssets, imageCache: surface.imageCache,
        geometry: surface.geometry, slotIndex: surface.slotIndex });
      return { id: surface.id, label: surface.label,
        canvas };
    }));
  }

  function canFilter(targetId) {
    const parent = findSurface(targetId);
    return !!parent?.activePaint && !lassoDraft && !movePreview && !activeStroke && !linePreview &&
      (selection?.surface.id !== targetId || !!selection.indices.length);
  }

  function beginFilter(targetId, mode = 'surface') {
    if (filterSession || !canFilter(targetId)) return false;
    const parent = findSurface(targetId);
    const mask = selection?.surface.id === targetId ? selection.alpha : null;
    const rect = mask ? { ...selection.bounds } :
      { left: 0, top: 0, right: SIZE, bottom: SIZE };
    filterSession = { parent, mask, rect, mode, snapshots: new Map() };
    return true;
  }

  function filterTargets(session, allLayers) {
    if (!allLayers) return [session.parent.activePaint];
    const keys = readLayerStack(session.parent.graph).layers
      .map((layer) => layer.source?.imageKey).filter(Boolean);
    return [...new Set([session.parent.activePaint,
      ...keys.map((key) => session.parent.imageAssets.get(key)?.paintSurface).filter(Boolean)])];
  }

  function filterSnapshot(session, surface, category) {
    let snapshot = session.snapshots.get(surface);
    if (snapshot) return snapshot;
    const rect = session.mask ? scaleLayerRegion(session.rect, session.parent.canvas,
      surface.canvas) : { left: 0, top: 0, right: surface.canvas.width,
      bottom: surface.canvas.height };
    const sourceRect = { left: Math.max(0, rect.left - 100),
      top: Math.max(0, rect.top - 100),
      right: Math.min(surface.canvas.width, rect.right + 100),
      bottom: Math.min(surface.canvas.height, rect.bottom + 100) };
    const before = surface.context.getImageData(rect.left, rect.top,
      rect.right - rect.left, rect.bottom - rect.top);
    const sameRect = sourceRect.left === rect.left && sourceRect.top === rect.top &&
      sourceRect.right === rect.right && sourceRect.bottom === rect.bottom;
    snapshot = { rect, sourceRect, before,
      mask: session.mask ? selectionMaskForLayer(selection, surface.canvas)?.alpha : null,
      source: sameRect ? before : surface.context.getImageData(sourceRect.left, sourceRect.top,
        sourceRect.right - sourceRect.left, sourceRect.bottom - sourceRect.top),
      fullSource: session.mode === 'surface' && category === 'blur' ?
        (sameRect ? before : surface.context.getImageData(0, 0,
          surface.canvas.width, surface.canvas.height)) : null,
      previewed: false };
    session.snapshots.set(surface, snapshot);
    return snapshot;
  }

  function restoreFilterSurface(surface, snapshot) {
    if (!snapshot.previewed) return;
    surface.context.putImageData(snapshot.before, snapshot.rect.left, snapshot.rect.top);
    surface.requestComposite(snapshot.rect);
    snapshot.previewed = false;
  }

  function filterIsIdentity(category, settings) {
    return category === 'color' ? !settings.hue && settings.saturation === 100 && !settings.invert :
      category === 'tone' ? !settings.luminance && settings.brightness === 100 &&
        settings.contrast === 100 :
        category === 'blur' ? !settings.depth && settings.mosaic === 1 :
          category === 'palette' ? settings.posterize === 256 && !settings.colorCount :
            category !== 'ramp';
  }

  function previewFilter(category, settings) {
    const session = filterSession;
    if (!session || !FILTER_CATEGORIES.some((item) => item.id === category)) return false;
    const targets = filterIsIdentity(category, settings) ? [] :
      filterTargets(session, settings.allLayers);
    const targetSet = new Set(targets);
    for (const [surface, snapshot] of session.snapshots)
      if (!targetSet.has(surface)) restoreFilterSurface(surface, snapshot);
    for (const surface of targets) {
      const snapshot = filterSnapshot(session, surface, category);
      const result = renderFilterRegion({ source: snapshot.source,
        sourceRect: snapshot.sourceRect, dirtyRect: snapshot.rect,
        textureWidth: surface.canvas.width, mask: snapshot.mask, category, settings,
        isolateBlur, topology: session.mode === 'surface' && category === 'blur' && settings.depth > 0 ?
          topologyFor(session.parent, surface.canvas) : null,
        fullSource: snapshot.fullSource });
      surface.context.putImageData(new ImageData(result.data, result.width, result.height),
        snapshot.rect.left, snapshot.rect.top);
      surface.requestComposite(snapshot.rect);
      snapshot.previewed = true;
    }
    return true;
  }

  function cancelFilter() {
    if (!filterSession) return false;
    for (const [surface, snapshot] of filterSession.snapshots)
      restoreFilterSurface(surface, snapshot);
    filterSession = null;
    return true;
  }

  function applyFilter(category, settings) {
    if (!previewFilter(category, settings)) return false;
    const patches = [];
    for (const [surface, snapshot] of filterSession.snapshots) {
      if (!snapshot.previewed) continue;
      const after = surface.context.getImageData(snapshot.rect.left, snapshot.rect.top,
        snapshot.before.width, snapshot.before.height);
      if (after.data.some((value, index) => value !== snapshot.before.data[index]))
        patches.push({ surface, x: snapshot.rect.left, y: snapshot.rect.top,
          before: snapshot.before, after });
    }
    filterSession = null;
    if (!patches.length) return false;
    commitFloatingSelection();
    undoStack.push({ patches });
    redoStack = [];
    return true;
  }

  function createImage(targetId, nodeId, source = null, name = 'Untitled image', savedKey = null,
    preserveResolution = false) {
    const parent = findSurface(targetId);
    if (!parent) return null;
    const canvas = document.createElement('canvas');
    canvas.width = preserveResolution && source ? source.width : SIZE;
    canvas.height = preserveResolution && source ? source.height : SIZE;
    const context = canvas.getContext('2d');
    if (source) context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const initial = document.createElement('canvas');
    initial.width = canvas.width;
    initial.height = canvas.height;
    initial.getContext('2d').drawImage(canvas, 0, 0);
    const key = savedKey ?? `${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const asset = { key, name, canvas, imported: preserveResolution, revision: 0 };
    const paintSurface = { id: parent.id, label: parent.label, canvas, context,
      compositeContext: parent.compositeContext, overlayContext: parent.overlayContext,
      overlayTexture: parent.overlayTexture, imageLayer: true,
      refreshComposite: parent.refreshComposite,
      requestComposite: (region = null) => {
        asset.revision++;
        parent.requestComposite(scaleLayerRegion(region, canvas, parent.canvas));
      },
      resetPaint: () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(initial, 0, 0);
        paintSurface.requestComposite();
      } };
    asset.paintSurface = paintSurface;
    parent.imageAssets.set(key, asset);
    return { key, name, width: canvas.width, height: canvas.height, imported: preserveResolution };
  }

  function setPaintSource(targetId, nodeId) {
    const parent = findSurface(targetId);
    if (!parent) return false;
    const node = parent.graph.nodes.find((item) => item.id === nodeId && item.type === 'image');
    const next = nodeId === null ? null : node && parent.imageAssets.get(node.imageKey)?.paintSurface;
    if (nodeId !== null && !next) return false;
    if (selection) {
      if (selection.surface.id === parent.id) {
        const rebound = selectionOnPaintSurface(selection, next);
        if (rebound !== selection) { selection = rebound; renderOverlay(); }
      } else { selection = null; renderOverlay(null); }
    }
    parent.activePaint = next;
    return true;
  }

  function setGraph(targetId, graph) {
    const surface = findSurface(targetId);
    if (!surface) return false;
    surface.graph = cloneTextureGraph(graph);
    if (surface.activePaint && !surface.graph.nodes.some((node) =>
      node.type === 'image' && surface.imageAssets.get(node.imageKey)?.paintSurface === surface.activePaint)) {
      const next = readLayerStack(surface.graph).layers[0]?.source;
      surface.activePaint = next ? surface.imageAssets.get(next.imageKey)?.paintSurface ?? null : null;
      if (selection?.surface.id === surface.id) {
        const rebound = selectionOnPaintSurface(selection, surface.activePaint);
        if (rebound !== selection) { selection = rebound; renderOverlay(); }
      }
    }
    surface.requestComposite();
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
        return { key, name: asset.name, data: asset.canvas.toDataURL('image/png'),
          imported: asset.imported };
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
        createImage(surface.id, asset.key.split(':')[0], image, asset.name, asset.key,
          asset.imported ?? (image.width !== SIZE || image.height !== SIZE));
      }
      setGraph(surface.id, saved.graph);
    }
  }

  return { prepare, clear, paint, fill, sample, applyGradient, applyCurveTexture, applyStamp,
    applySurfaceCurve, beginLine, beginThroughLine,
    updateLine, commitLine, cancelLine,
    canPaintAt: (hit) => {
      const surface = surfaceAt(hit);
      return !!surface && (!selection || !maskEnabled || surface === selection.surface);
    },
    beginLasso, endLasso, cancelLasso, selectedAt, beginMove, updateMove, endMove,
    cancelMove, clearSelection, selectWand, selectFaces, invertSelection, resizeSelection,
    copySelection, cutSelection, pasteSelection,
    canInvertSelection: () => !!selection && !lassoDraft && !movePreview,
    canResizeSelection: () => !!selection?.indices.length && !lassoDraft && !movePreview,
    canCopySelection: () => !!selection?.indices.length && !lassoDraft && !movePreview,
    canPasteSelection: () => !!clipboard, getLayerImage, getImageInfo, getCompositePreview,
    getExportTextures,
    canFilter, beginFilter, previewFilter, applyFilter, cancelFilter,
    setMaskEnabled: (enabled) => { maskEnabled = enabled; },
    setBlurSelectionIsolation: (enabled) => { isolateBlur = enabled; },
    beginStroke, endStroke, recordCurveDraftChange, undo, redo,
    canUndo: () => undoStack.length > 0 && !filterSession,
    canRedo: () => redoStack.length > 0 && !filterSession, setLightingMode,
    setWireframeEnabled, setAntialiasEnabled,
    setRenderer: (nextRenderer) => { renderer = nextRenderer; },
    getMeshes: () => [...surfaces.keys()], getFaceTarget,
    getMaterialVisibilityState, setMaterialVisibility, toggleMaterialIsolation,
    restoreMaterialVisibilityState,
    isMaterialVisible: (targetId) => materialVisible(findSurface(targetId)),
    getGraphTargets: graphTargets, setGraph, recordGraphChange,
    createImage, setPaintSource, mergeLayerDown,
    beginProjectionPreview, previewProjectionGraph, endProjectionPreview,
    exportProjectTextures, restoreProjectTextures,
    targetIdAt: (hit) => surfaceAt(hit)?.id ?? null };
}
