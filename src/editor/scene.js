import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTexturePainter } from './texture-painter.js';
import { projectLassoToUv } from './screen-lasso.js';

export function createScene(host, { onColorPicked, onSelectionChanged, onGraphTargetsChanged, onPaintTargetChanged } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#252b34');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.set(3.4, 2.4, 4.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
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

  const defaultModel = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#aabed2', metalness: 0.18, roughness: 0.48 });
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.27, 180, 24), material);
  knot.position.y = 1.05;
  defaultModel.add(knot);
  scene.add(defaultModel);

  let model = defaultModel;
  const loader = new GLTFLoader();
  const painter = createTexturePainter();
  painter.prepare(defaultModel);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let activePointer = null;
  let previousHit = null;
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

  function hitTest(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(painter.getMeshes(), false).find((hit) => hit.uv);
  }

  function paintAt(event) {
    const hit = hitTest(event);
    previousHit = hit ? painter.paint(hit, activeTool, previousHit, toolSettings[activeTool]) : null;
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
    context.strokeStyle = '#0b243c';
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = '#79c6ff';
    context.lineWidth = 2.5;
    context.stroke();
  }

  function finishLasso() {
    const mask = projectLassoToUv(renderer, camera, lassoSourceHit, lassoPath, painter.getMeshes());
    const created = painter.endLasso(mask);
    lassoSourceHit = null;
    lassoPath = [];
    renderLassoPath();
    onSelectionChanged?.(created ? 'Selection created' : 'Selection needs a larger visible area');
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
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
    previousHit = null;
    const hit = hitTest(event);
    if (hit) onPaintTargetChanged?.(painter.targetIdAt(hit));
    if (activeTool === 'lasso') {
      pointerAction = painter.selectedAt(hit) ? 'moveSelection' : 'lasso';
      if (pointerAction === 'moveSelection') painter.beginMove(hit);
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
    } else if (activeTool === 'line') painter.beginLine(hit, toolSettings.line);
    else if (activeTool === 'eyedropper') {
      const color = painter.sample(hit);
      if (color) onColorPicked?.(color);
    } else {
      painter.beginStroke();
      if (activeTool === 'bucket') painter.fill(hit, toolSettings.bucket);
      else paintAt(event);
    }
    renderer.domElement.setPointerCapture(event.pointerId);
  }, true);
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (pointerAction === 'lasso') {
      if (lassoStartScreen && Math.hypot(event.clientX - lassoStartScreen.x,
        event.clientY - lassoStartScreen.y) > 4) lassoDragged = true;
      traceLassoTo(event);
    }
    else if (pointerAction === 'moveSelection') painter.updateMove(hitTest(event));
    else if (activeTool === 'line') painter.updateLine(hitTest(event));
    else if (activeTool === 'brush' || activeTool === 'eraser' || activeTool === 'blur') paintAt(event);
  }, true);
  function endStroke(event) {
    if (event.pointerId !== activePointer) return;
    event.stopImmediatePropagation();
    activePointer = null;
    previousHit = null;
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
        painter.updateMove(hitTest(event));
        if (painter.endMove()) onSelectionChanged?.('Selection moved');
      }
    } else if (activeTool === 'line') {
      if (event.type === 'pointercancel') painter.cancelLine();
      else { painter.updateLine(hitTest(event)); painter.commitLine(); }
    } else if (activeTool !== 'eyedropper') painter.endStroke();
    pointerAction = null;
    lastLassoScreen = null;
    lassoStartScreen = null;
    lassoDragged = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  }
  renderer.domElement.addEventListener('pointerup', endStroke, true);
  renderer.domElement.addEventListener('pointercancel', endStroke, true);
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

  function importGlb(file) {
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
          scene.add(model);
          frame(model);
          onGraphTargetsChanged?.(painter.getGraphTargets());
          resolve({ model: next, paintableMeshes });
        }, reject);
      };
      reader.readAsArrayBuffer(file);
    });
  }

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
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  return {
    importGlb,
    frame: () => frame(model),
    setGridVisible: (visible) => { grid.visible = visible; },
    setLightingMode: painter.setLightingMode,
    setTool: (tool) => {
      if (tool !== 'lasso' && lassoPath.length) {
        painter.cancelLasso(); lassoSourceHit = null; lassoPath = []; renderLassoPath();
      }
      activeTool = tool;
    },
    setToolSettings: (tool, settings) => {
      toolSettings[tool] = { ...settings };
      if (tool === 'lasso') painter.setMaskEnabled(settings.maskEnabled);
    },
    clearSelection: () => {
      lassoSourceHit = null; lassoPath = []; renderLassoPath();
      return painter.clearSelection();
    },
    undo: painter.undo,
    redo: painter.redo,
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    getGraphTargets: painter.getGraphTargets,
    setGraph: painter.setGraph,
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
