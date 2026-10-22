import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTexturePainter } from './texture-painter.js';
import { captureVisibleUv, projectLassoToUv } from './screen-lasso.js';
import { sampleScreenStroke } from './surface-stroke.js';
import { createModelMirror, reflectedCamera } from './model-mirror.js';
import { setTextureResolution, textureResolution } from './texture-resolution.js';

export function createScene(host, { onColorPicked, onSelectionChanged, onGraphTargetsChanged,
  onContentChanged } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#252b34');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.set(3.4, 2.4, 4.4);

  function createRenderer(antialias) {
    const next = new THREE.WebGLRenderer({ antialias });
    next.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    next.outputColorSpace = THREE.SRGBColorSpace;
    next.toneMapping = THREE.ACESFilmicToneMapping;
    next.toneMappingExposure = 1.25;
    return next;
  }
  let renderer = createRenderer(true);
  host.append(renderer.domElement);
  const lassoCanvas = document.createElement('canvas');
  lassoCanvas.className = 'lasso-overlay';
  lassoCanvas.setAttribute('aria-hidden', 'true');
  host.append(lassoCanvas);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = null;
  controls.target.set(0, 0.65, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight('#dbe9ff', '#525667', 2.1));
  const keyLight = new THREE.DirectionalLight('#ffffff', 3.2);
  keyLight.position.set(3, 6, 4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#9bbcff', 1.5);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(20, 20, '#66717d', '#3a434e');
  grid.position.y = -0.005;
  scene.add(grid);

  function starterModel() {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: '#aabed2', metalness: 0.18, roughness: 0.48 });
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.27, 180, 24), material);
    knot.position.y = 1.05;
    group.add(knot);
    return group;
  }
  let model = starterModel();
  let modelSource = { kind: 'starter' };
  let modelFile = null;
  scene.add(model);
  const loader = new GLTFLoader();
  const painter = createTexturePainter(renderer);
  painter.prepare(model);
  let selectedTargetId = painter.getGraphTargets()[0]?.id ?? null;
  let paintMeshes = painter.getMeshes();
  let mirrorEnabled = false;
  let samplingMode = 'surface';
  let antialiasEnabled = true;
  let gestureSamplingMode = 'surface';
  let resolveMirrorHit = createModelMirror(model, paintMeshes);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let strokeRect = null;
  let activePointer = null;
  let previousHit = null;
  let previousMirrorHit = null;
  let previousPaintScreen = null;
  let lineStartScreen = null;
  let lineStartHit = null;
  let lineStartMirrorHit = null;
  let pendingDraw = null;
  let drawFrame = null;
  let activeTool = 'brush';
  let pointerAction = null;
  let lastLassoScreen = null;
  let lassoStartScreen = null;
  let lassoDragged = false;
  let lassoSourceHit = null;
  let lassoPath = [];
  let spacePressed = false;
  const toolSettings = {};

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    spacePressed = true;
    event.preventDefault();
  });
  document.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    spacePressed = false;
    event.preventDefault();
  });
  window.addEventListener('blur', () => { spacePressed = false; });

  function hitTestAt(clientX, clientY) {
    const rect = strokeRect ?? renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(paintMeshes, false).find((candidate) => candidate.uv);
    return hit && painter.targetIdAt(hit) === selectedTargetId ? hit : null;
  }

  function hitTest(event) { return hitTestAt(event.clientX, event.clientY); }

  function viewportPoint(event) {
    const rect = strokeRect ?? renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function mirrorHitAt(hit) {
    if (!mirrorEnabled || !hit) return null;
    const mirrored = resolveMirrorHit(hit);
    if (!mirrored || painter.targetIdAt(mirrored) !== selectedTargetId) return null;
    const sameSlot = mirrored.object === hit.object &&
      mirrored.face?.materialIndex === hit.face?.materialIndex;
    const uvGap = (a, b) => {
      const difference = Math.abs(a - b) % 1;
      return Math.min(difference, 1 - difference);
    };
    if (sameSlot && uvGap(hit.uv.x, mirrored.uv.x) < 1 / textureResolution &&
        uvGap(hit.uv.y, mirrored.uv.y) < 1 / textureResolution) return null;
    return mirrored;
  }

  function paintAt(event, initialHit = undefined) {
    const end = { x: event.clientX, y: event.clientY };
    if (initialHit === undefined && previousPaintScreen &&
        end.x === previousPaintScreen.x && end.y === previousPaintScreen.y) return;
    const start = previousPaintScreen ?? end;
    const hits = initialHit !== undefined ? [initialHit] : gestureSamplingMode === 'uv' ?
      [hitTest(event)] : sampleScreenStroke(start, end, hitTestAt, 2);
    for (const hit of previousPaintScreen && gestureSamplingMode === 'surface' ? hits.slice(1) : hits) {
      previousHit = hit ? painter.paint(hit, activeTool, previousHit,
        toolSettings[activeTool], gestureSamplingMode) : null;
      const mirrored = mirrorHitAt(hit);
      previousMirrorHit = mirrored ? painter.paint(mirrored, activeTool,
        previousMirrorHit, toolSettings[activeTool], gestureSamplingMode) : null;
    }
    previousPaintScreen = end;
  }

  function previewLineAt(event) {
    if (!lineStartScreen) return;
    if (gestureSamplingMode === 'uv') {
      const hit = hitTest(event);
      if (!hit || painter.targetIdAt(hit) !== painter.targetIdAt(lineStartHit)) return;
      painter.updateLine([[lineStartHit, hit], [lineStartMirrorHit, mirrorHitAt(hit)]]);
      return;
    }
    const hits = sampleScreenStroke(lineStartScreen,
      { x: event.clientX, y: event.clientY }, hitTestAt, 2);
    painter.updateLine([hits, mirrorEnabled ? hits.map(mirrorHitAt) : []]);
  }

  function queueDraw(event) {
    pendingDraw = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    if (drawFrame !== null) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = null;
      const next = pendingDraw;
      pendingDraw = null;
      if (!next || next.pointerId !== activePointer) return;
      if (pointerAction === 'moveSelection') {
        const hit = gestureSamplingMode === 'uv' ? hitTest(next) : null;
        painter.updateMove(hit ?? (gestureSamplingMode === 'uv' ? null : viewportPoint(next)),
          hit ? mirrorHitAt(hit) : null);
      }
      else if (activeTool === 'line') previewLineAt(next);
      else paintAt(next);
    });
  }

  function traceLassoTo(event) {
    const end = { x: event.clientX, y: event.clientY };
    const start = lastLassoScreen ?? end;
    const rect = renderer.domElement.getBoundingClientRect();
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 4));
    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      lassoPath.push({ x: start.x + (end.x - start.x) * t - rect.left,
        y: start.y + (end.y - start.y) * t - rect.top });
    }
    lastLassoScreen = end;
    renderLassoPath();
  }

  function renderLassoPath() {
    const context = lassoCanvas.getContext('2d');
    context.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
    if (!lassoPath.length) return;
    context.beginPath();
    context.moveTo(lassoPath[0].x, lassoPath[0].y);
    for (const point of lassoPath.slice(1)) context.lineTo(point.x, point.y);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1.25;
    context.setLineDash([5, 4]);
    context.stroke();
  }

  function finishLasso() {
    const mask = projectLassoToUv(renderer, camera, lassoSourceHit, lassoPath, painter.getMeshes());
    const mirroredHit = mirrorHitAt(lassoSourceHit);
    let mirrorMask = null;
    if (mask && mirroredHit && painter.targetIdAt(mirroredHit) === painter.targetIdAt(lassoSourceHit)) {
      const mirrorCamera = reflectedCamera(camera, resolveMirrorHit.planePoint,
        resolveMirrorHit.planeNormal);
      const width = renderer.domElement.getBoundingClientRect().width;
      mirrorMask = projectLassoToUv(renderer, mirrorCamera, mirroredHit,
        lassoPath.map((point) => ({ x: width - point.x, y: point.y })), painter.getMeshes());
    }
    const created = painter.endLasso(mask, mirrorMask);
    lassoSourceHit = null;
    lassoPath = [];
    renderLassoPath();
    onSelectionChanged?.(created ? 'Selection created' : 'Selection needs a larger visible area');
  }

  function onPointerDown(event) {
    if (event.button === 0 && (event.altKey || spacePressed)) {
      controls.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      event.preventDefault();
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    activePointer = event.pointerId;
    gestureSamplingMode = samplingMode;
    strokeRect = renderer.domElement.getBoundingClientRect();
    previousHit = null;
    previousMirrorHit = null;
    previousPaintScreen = null;
    lineStartScreen = null;
    lineStartHit = null;
    lineStartMirrorHit = null;
    const hit = hitTest(event);
    if (activeTool === 'lasso') {
      pointerAction = painter.selectedAt(hit) ? 'moveSelection' : 'lasso';
      if (pointerAction === 'moveSelection') {
        const projection = gestureSamplingMode === 'surface' ?
          captureVisibleUv(renderer, camera, hit, paintMeshes) : null;
        const mirroredHit = mirrorHitAt(hit);
        const mirrored = mirroredHit && painter.targetIdAt(mirroredHit) === painter.targetIdAt(hit) ?
          { hit: mirroredHit, projection: gestureSamplingMode === 'surface' ?
            captureVisibleUv(renderer, reflectedCamera(camera, resolveMirrorHit.planePoint,
              resolveMirrorHit.planeNormal), mirroredHit, paintMeshes) : null } : null;
        if (!painter.beginMove(hit, projection, viewportPoint(event), gestureSamplingMode,
          mirrored)) pointerAction = null;
      }
      else {
        if (painter.beginLasso(hit)) lassoSourceHit = hit;
        if (lassoSourceHit) {
          const rect = renderer.domElement.getBoundingClientRect();
          lassoPath = [{ x: event.clientX - rect.left, y: event.clientY - rect.top }];
          renderLassoPath();
        }
        lastLassoScreen = { x: event.clientX, y: event.clientY };
        lassoStartScreen = lastLassoScreen;
        lassoDragged = false;
      }
    } else if (activeTool === 'line') {
      const mirrored = mirrorHitAt(hit);
      if (painter.beginLine(hit, toolSettings.line, mirrored, gestureSamplingMode)) {
        lineStartScreen = { x: event.clientX, y: event.clientY };
        lineStartHit = hit;
        lineStartMirrorHit = mirrored;
      }
    }
    else if (activeTool === 'eyedropper') {
      const color = painter.sample(hit);
      if (color) onColorPicked?.(color);
    } else {
      painter.beginStroke();
      if (activeTool === 'bucket') {
        painter.fill(hit, toolSettings.bucket);
        if (mirrorEnabled) painter.fill(mirrorHitAt(hit), toolSettings.bucket);
      }
      else paintAt(event, hit);
    }
    renderer.domElement.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event) {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pointerAction === 'lasso') {
      if (lassoStartScreen && Math.hypot(event.clientX - lassoStartScreen.x,
        event.clientY - lassoStartScreen.y) > 4) lassoDragged = true;
      traceLassoTo(event);
    }
    else if (pointerAction === 'moveSelection') queueDraw(event);
    else if (activeTool === 'line' || activeTool === 'brush' ||
        activeTool === 'eraser' || activeTool === 'blur') queueDraw(event);
  }
  function endStroke(event) {
    if (event.pointerId !== activePointer) return;
    event.stopImmediatePropagation();
    if (drawFrame !== null) cancelAnimationFrame(drawFrame);
    drawFrame = null;
    pendingDraw = null;
    if (event.type === 'pointerup') {
      if (pointerAction === 'moveSelection') {
        const hit = gestureSamplingMode === 'uv' ? hitTest(event) : null;
        painter.updateMove(hit ?? (gestureSamplingMode === 'uv' ? null : viewportPoint(event)),
          hit ? mirrorHitAt(hit) : null);
      }
      else if (activeTool === 'brush' || activeTool === 'eraser' || activeTool === 'blur') paintAt(event);
    }
    activePointer = null;
    strokeRect = null;
    previousHit = null;
    previousMirrorHit = null;
    previousPaintScreen = null;
    if (pointerAction === 'lasso') {
      if (event.type === 'pointercancel') {
        painter.cancelLasso(); lassoSourceHit = null; lassoPath = []; renderLassoPath();
      }
      else if (lassoDragged) {
        traceLassoTo(event);
        finishLasso();
      }
      else {
        painter.cancelLasso();
        lassoSourceHit = null; lassoPath = []; renderLassoPath();
        const cleared = painter.clearSelection();
        onSelectionChanged?.(cleared ? 'Selection cleared' :
          hitTest(event) ? 'Hold and drag to draw a lasso' : 'Start the lasso on the model');
      }
    } else if (pointerAction === 'moveSelection') {
      if (event.type === 'pointercancel') painter.cancelMove();
      else {
        if (painter.endMove()) onSelectionChanged?.('Selection moved');
      }
    } else if (activeTool === 'line') {
      if (event.type === 'pointercancel') painter.cancelLine();
      else { previewLineAt(event); painter.commitLine(); }
    } else if (activeTool !== 'eyedropper') painter.endStroke();
    pointerAction = null;
    lineStartScreen = null;
    lineStartHit = null;
    lineStartMirrorHit = null;
    lastLassoScreen = null;
    lassoStartScreen = null;
    lassoDragged = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (activeTool !== 'eyedropper') onContentChanged?.();
  }
  function bindRendererCanvas(canvas) {
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', endStroke, true);
    canvas.addEventListener('pointercancel', endStroke, true);
  }
  bindRendererCanvas(renderer.domElement);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (painter.cancelLasso() || painter.cancelMove()) {
      lassoSourceHit = null; lassoPath = []; renderLassoPath();
      onSelectionChanged?.('Selection gesture cancelled');
    }
  });

  function frame(object) {
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.5);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(radius * 1.65, radius * 1.15, radius * 1.9));
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = Math.max(radius * 100, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function importGlb(file, referenceId = crypto.randomUUID()) {
    if (!file || !/\.glb$/i.test(file.name)) return Promise.reject(new Error('Select a .glb file.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        loader.parse(reader.result, '', (gltf) => {
          const next = gltf.scene;
          if (!next.children.length) return reject(new Error('The GLB contains no visible scene.'));
          let paintableMeshes;
          try { paintableMeshes = painter.prepare(next); }
          catch (error) { return reject(error); }
          scene.remove(model);
          lassoSourceHit = null; lassoPath = []; renderLassoPath();
          model = next;
          paintMeshes = painter.getMeshes();
          resolveMirrorHit = createModelMirror(model, paintMeshes);
          modelSource = { kind: 'glb', referenceId, name: file.name,
            size: file.size, lastModified: file.lastModified };
          modelFile = file;
          scene.add(model);
          frame(model);
          onGraphTargetsChanged?.(painter.getGraphTargets());
          resolve({ model: next, paintableMeshes });
        }, reject);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function newProject(resolution = 1024) {
    setTextureResolution(resolution);
    const next = starterModel();
    painter.prepare(next);
    scene.remove(model);
    model = next;
    paintMeshes = painter.getMeshes();
    resolveMirrorHit = createModelMirror(model, paintMeshes);
    modelSource = { kind: 'starter' };
    modelFile = null;
    scene.add(model);
    frame(model);
    onGraphTargetsChanged?.(painter.getGraphTargets());
  }

  function exportProjectData() {
    return { model: modelSource, resolution: textureResolution,
      textures: painter.exportProjectTextures(),
      view: { camera: camera.position.toArray(), target: controls.target.toArray(),
        lighting: currentLightingMode, grid: grid.visible, mirror: mirrorEnabled,
        sampling: samplingMode, antialias: antialiasEnabled } };
  }

  async function restoreProjectData(saved, file = null) {
    setTextureResolution(saved.resolution ?? 1024);
    if (saved.model.kind === 'starter') newProject(textureResolution);
    else {
      if (!file) throw new Error(`Model not found: ${saved.model.name}`);
      await importGlb(file, saved.model.referenceId);
    }
    await painter.restoreProjectTextures(saved.textures);
    mirrorEnabled = saved.view?.mirror === true;
    samplingMode = saved.view?.sampling === 'uv' ? 'uv' : 'surface';
    if (Array.isArray(saved.view?.camera) && saved.view.camera.length === 3 &&
        saved.view.camera.every(Number.isFinite) && Array.isArray(saved.view?.target) &&
        saved.view.target.length === 3 && saved.view.target.every(Number.isFinite)) {
      camera.position.fromArray(saved.view.camera);
      controls.target.fromArray(saved.view.target);
      controls.update();
    }
    onGraphTargetsChanged?.(painter.getGraphTargets());
  }

  let currentLightingMode = 'shaded';

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    lassoCanvas.width = width; lassoCanvas.height = height;
    renderLassoPath();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  const renderFrame = () => { controls.update(); renderer.render(scene, camera); };
  renderer.setAnimationLoop(renderFrame);

  function setAntialiasEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === antialiasEnabled) return;
    const oldRenderer = renderer;
    const nextRenderer = createRenderer(enabled);
    host.insertBefore(nextRenderer.domElement, oldRenderer.domElement);
    renderer = nextRenderer;
    controls.connect(nextRenderer.domElement);
    bindRendererCanvas(nextRenderer.domElement);
    oldRenderer.setAnimationLoop(null);
    oldRenderer.domElement.remove();
    oldRenderer.dispose();
    oldRenderer.forceContextLoss();
    antialiasEnabled = enabled;
    painter.setAntialiasEnabled(enabled);
    resize();
    renderer.setAnimationLoop(renderFrame);
  }

  return {
    importGlb,
    newProject, exportProjectData, restoreProjectData,
    frame: () => frame(model),
    setGridVisible: (visible) => { grid.visible = visible; },
    setAntialiasEnabled,
    setMirrorEnabled: (enabled) => { mirrorEnabled = Boolean(enabled); },
    getMirrorEnabled: () => mirrorEnabled,
    setSamplingMode: (mode) => { samplingMode = mode === 'uv' ? 'uv' : 'surface'; },
    getSamplingMode: () => samplingMode,
    setLightingMode: (mode) => { currentLightingMode = mode; painter.setLightingMode(mode); },
    setTool: (tool) => {
      if (tool !== 'lasso' && lassoPath.length) {
        painter.cancelLasso(); lassoSourceHit = null; lassoPath = []; renderLassoPath();
      }
      activeTool = tool;
    },
    setToolSettings: (tool, settings) => {
      toolSettings[tool] = { ...settings };
      if (tool === 'lasso') {
        painter.setMaskEnabled(settings.maskEnabled);
        painter.setBlurSelectionIsolation(settings.isolateBlur);
      }
    },
    clearSelection: () => {
      lassoSourceHit = null; lassoPath = []; renderLassoPath();
      return painter.clearSelection();
    },
    invertSelection: painter.invertSelection,
    canInvertSelection: painter.canInvertSelection,
    resizeSelection: painter.resizeSelection,
    canResizeSelection: painter.canResizeSelection,
    undo: painter.undo,
    redo: painter.redo,
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    copySelection: painter.copySelection,
    cutSelection: painter.cutSelection,
    pasteSelection: painter.pasteSelection,
    canCopySelection: painter.canCopySelection,
    canPasteSelection: painter.canPasteSelection,
    getLayerImage: painter.getLayerImage,
    getModelFile: () => modelFile,
    getModelSource: () => ({ ...modelSource }),
    getTexturePreview: painter.getCompositePreview,
    getGraphTargets: painter.getGraphTargets,
    setPaintTarget: (id) => { selectedTargetId = id; },
    setGraph: painter.setGraph,
    mergeLayerDown: painter.mergeLayerDown,
    createImage: painter.createImage,
    setPaintSource: painter.setPaintSource,
    importImage: async (targetId, nodeId, file) => {
      if (!file?.type.startsWith('image/')) throw new Error('Select an image file.');
      const bitmap = await createImageBitmap(file);
      try { return painter.createImage(targetId, nodeId, bitmap, file.name); }
      finally { bitmap.close(); }
    }
  };
}
