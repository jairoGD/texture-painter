import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTexturePainter } from './texture-painter.js';
import { captureVisibleUv, decodeVisibleUv, projectLassoToUv } from './screen-lasso.js';
import { captureVisibleFaces } from './screen-face-selection.js';
import { sampleScreenStroke } from './surface-stroke.js';
import { sampleThroughLine } from './through-line.js';
import { lineStylePaths, styledPolylinePaths } from './line-style.js';
import { curveScreenPoints } from './curve-path.js';
import { preciseCurveScreenPoints } from './precise-curve.js';
import { buildSurfaceCurvePath } from './surface-curve-path.js';
import { createModelMirror, reflectedCamera } from './model-mirror.js';
import { setTextureResolution, textureResolution } from './texture-resolution.js';
import { resizeWarpProjection, warpProjectionTransform } from './image-projection.js';
import { resolveTemporaryPaintTool } from './temporary-paint-tool.js';

export function createScene(host, { onColorPicked, onSelectionChanged, onGraphTargetsChanged,
  onContentChanged, onLightViewChanged, onProjectionStart, onProjectionPreview,
  onProjectionEnd, onGraphHistoryApplied, onRestoreCurve } = {}) {
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
  const curveCanvas = document.createElement('canvas');
  curveCanvas.className = 'curve-overlay';
  curveCanvas.setAttribute('aria-hidden', 'true');
  host.append(curveCanvas);
  const gradientCanvas = document.createElement('canvas');
  gradientCanvas.className = 'gradient-overlay';
  gradientCanvas.setAttribute('aria-hidden', 'true');
  host.append(gradientCanvas);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = null;
  controls.target.set(0, 0.65, 0);
  controls.update();

  const warpControls = new TransformControls(camera, renderer.domElement);
  warpControls.setSize(0.8);
  scene.add(warpControls.getHelper());
  let warpAnchor = null;
  let warpTarget = null;
  let warpHandles = [];
  let warpHandleDrag = null;
  const warpHandleRaycaster = new THREE.Raycaster();
  const warpHint = document.createElement('div');
  warpHint.className = 'warp-projection-hint';
  warpHint.textContent = 'W  Move   ·   E  Rotate   ·   R  Scale box handles';
  warpHint.hidden = true;
  host.append(warpHint);
  function clearWarpTarget() {
    if (!warpTarget && !warpAnchor) return;
    painter.endProjectionPreview();
    warpHandleDrag = null;
    controls.enabled = true;
    warpControls.detach();
    if (warpAnchor) {
      warpAnchor.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material?.dispose();
      });
      warpAnchor.removeFromParent();
    }
    warpAnchor = null;
    warpTarget = null;
    warpHandles = [];
    warpHint.hidden = true;
  }
  function setWarpMode(mode) {
    warpControls.setMode(mode);
    for (const handle of warpHandles) handle.visible = mode === 'scale';
  }
  function readWarpTransform() {
    return { position: warpAnchor.position.toArray(), rotation: [warpAnchor.rotation.x,
      warpAnchor.rotation.y, warpAnchor.rotation.z],
      scale: warpAnchor.scale.toArray().map((value) => Math.max(0.001, Math.abs(value))) };
  }
  warpControls.addEventListener('mouseDown', () => {
    controls.enabled = false;
    if (warpTarget) onProjectionStart?.(warpTarget.targetId, warpTarget.nodeId);
  });
  warpControls.addEventListener('objectChange', () => {
    if (!warpTarget || !warpAnchor) return;
    warpAnchor.scale.set(...readWarpTransform().scale);
    onProjectionPreview?.(warpTarget.targetId, warpTarget.nodeId, readWarpTransform());
  });
  warpControls.addEventListener('mouseUp', () => {
    controls.enabled = true;
    if (warpTarget) onProjectionEnd?.(warpTarget.targetId, warpTarget.nodeId,
      readWarpTransform());
  });
  document.addEventListener('keydown', (event) => {
    if (!warpTarget || warpHandleDrag || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const mode = { KeyW: 'translate', KeyE: 'rotate', KeyR: 'scale' }[event.code];
    if (!mode) return;
    event.preventDefault();
    setWarpMode(mode);
  });

  function setProjectionTarget(targetId, graph, nodeId) {
    const node = graph?.nodes.find((item) => item.id === nodeId && item.type === 'image');
    const face = node?.projection === 'warp' && painter.getFaceTarget(targetId);
    if (!face || !node.imageKey) { clearWarpTarget(); return; }
    if (warpControls.dragging || warpHandleDrag) return;
    const same = warpTarget?.targetId === targetId && warpTarget.nodeId === nodeId &&
      warpTarget.imageKey === node.imageKey;
    if (!same) {
      clearWarpTarget();
      warpAnchor = new THREE.Object3D();
      face.mesh.add(warpAnchor);
      const bounds = new THREE.BoxGeometry(1, 1, 1);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bounds),
        new THREE.LineBasicMaterial({ color: '#70bfff', depthTest: false,
          transparent: true, opacity: 0.8 }));
      edges.renderOrder = 20;
      warpAnchor.add(edges);
      bounds.dispose();
      const positions = [];
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const signs = [0, 0, 0];
        signs[axis] = sign;
        positions.push(signs);
      }
      for (const x of [-1, 1]) for (const y of [-1, 1])
        for (const z of [-1, 1]) positions.push([x, y, z]);
      warpHandles = positions.map((signs) => {
        const corner = signs.every(Boolean);
        const handle = new THREE.Mesh(new THREE.SphereGeometry(corner ? 0.047 : 0.058, 10, 8),
          new THREE.MeshBasicMaterial({ color: corner ? '#d7edff' : '#70bfff',
            depthTest: false, depthWrite: false, toneMapped: false }));
        handle.position.set(...signs.map((sign) => sign * 0.5));
        handle.userData.warpSigns = signs;
        handle.renderOrder = 21;
        handle.visible = false;
        warpAnchor.add(handle);
        return handle;
      });
      warpControls.attach(warpAnchor);
      setWarpMode('translate');
      warpHint.hidden = false;
      warpTarget = { targetId, nodeId, imageKey: node.imageKey };
    }
    const transform = warpProjectionTransform(node, face.mesh.geometry);
    warpAnchor.position.set(...transform.position);
    warpAnchor.rotation.set(...transform.rotation);
    warpAnchor.scale.set(...transform.scale);
  }

  scene.add(new THREE.HemisphereLight('#dbe9ff', '#525667', 2.1));
  const lightRig = new THREE.Group();
  const keyLight = new THREE.DirectionalLight('#ffffff', 3.2);
  keyLight.position.set(3, 6, 4);
  lightRig.add(keyLight);
  const fillLight = new THREE.DirectionalLight('#9bbcff', 1.5);
  fillLight.position.set(-4, 2, -3);
  lightRig.add(fillLight);
  scene.add(lightRig);
  let lightYaw = 0;
  let lightPitch = 0;
  let lightViewDirty = true;
  const lastLightCamera = new THREE.Quaternion();
  const lightDirection = new THREE.Vector3();
  const inverseCamera = new THREE.Quaternion();

  function setLightRotation(yaw, pitch) {
    if (!Number.isFinite(yaw)) yaw = 0;
    if (!Number.isFinite(pitch)) pitch = 0;
    lightYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    lightPitch = THREE.MathUtils.clamp(pitch, -1.4, 1.4);
    lightRig.rotation.set(-lightPitch, lightYaw, 0, 'YXZ');
    lightViewDirty = true;
  }

  function getLightViewState() {
    lightRig.updateWorldMatrix(true, true);
    keyLight.getWorldPosition(lightDirection).normalize();
    inverseCamera.copy(camera.quaternion).invert();
    lightDirection.applyQuaternion(inverseCamera);
    return { x: lightDirection.x, y: lightDirection.y,
      z: lightDirection.z, yaw: lightYaw, pitch: lightPitch };
  }

  function updateLightView() {
    if (!onLightViewChanged ||
        (!lightViewDirty && lastLightCamera.equals(camera.quaternion))) return;
    onLightViewChanged(getLightViewState());
    lastLightCamera.copy(camera.quaternion);
    lightViewDirty = false;
  }

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
  const painter = createTexturePainter(renderer, onGraphHistoryApplied, (entry, action) => {
    const state = entry.curveDraft?.[action === 'undo' ? 'before' : 'after'] ??
      (action === 'undo' ? entry.curveHistory : null);
    if (!entry.curveDraft && !entry.curveHistory) return;
    resetCurve(true);
    if (!state?.anchors.length) return;
    onRestoreCurve?.(state.targetId, state.settings);
    preciseAnchors = state.anchors.map((anchor) => ({
      point: anchor.point.clone(), hit: { faceIndex: anchor.faceIndex } }));
    precisePath = undefined;
    renderCurvePreview();
  });
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
  let strokeTool = null;
  let lineStartScreen = null;
  let lineStartHit = null;
  let lineStartMirrorHit = null;
  let lineThrough = false;
  let lineThroughTarget = null;
  let gradientStart = null;
  let gradientEnd = null;
  let gradientTargetId = null;
  let curveStep = 0;
  let curvePoints = [];
  let curveStartHit = null;
  let curveMode = 'surface';
  let preciseAnchors = [];
  let preciseDragIndex = -1;
  let preciseDragOriginal = null;
  let preciseDragStart = null;
  let preciseGestureBefore = null;
  let precisePath;
  let pendingDraw = null;
  let drawFrame = null;
  let activeTool = 'brush';
  let pointerAction = null;
  let lastLassoScreen = null;
  let lassoStartScreen = null;
  let lassoDragged = false;
  let lassoSourceHit = null;
  let lassoPath = [];
  let lassoMode = 'replace';
  let faceStart = null;
  let faceEnd = null;
  let faceMode = 'replace';
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

  function hitTestAt(clientX, clientY, selectedOnly = true) {
    const rect = strokeRect ?? renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(paintMeshes, false).find((candidate) =>
      candidate.uv && painter.isMaterialVisible(painter.targetIdAt(candidate)));
    return hit && (!selectedOnly || painter.targetIdAt(hit) === selectedTargetId) ? hit : null;
  }

  function hitTest(event) { return hitTestAt(event.clientX, event.clientY); }

  function withDoubleSidedPaintMeshes(action) {
    const { mesh, materialIndex } = lineThroughTarget;
    const material = Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
    const previousSide = material.side;
    material.side = THREE.DoubleSide;
    try { return action(); }
    finally { material.side = previousSide; }
  }

  function throughHitsAt(clientX, clientY) {
    const rect = strokeRect ?? renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(lineThroughTarget.mesh, false)
      .filter((hit) => hit.uv &&
        (hit.face?.materialIndex ?? 0) === lineThroughTarget.materialIndex &&
        painter.isMaterialVisible(painter.targetIdAt(hit)));
    return hits.filter((hit, index) => !index ||
      hit.object !== hits[index - 1].object ||
      hit.face?.materialIndex !== hits[index - 1].face?.materialIndex ||
      hit.point.distanceToSquared(hits[index - 1].point) > 1e-10);
  }

  function viewportPoint(event) {
    const rect = strokeRect ?? renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function renderGradientGuide() {
    const context = gradientCanvas.getContext('2d');
    context.clearRect(0, 0, gradientCanvas.width, gradientCanvas.height);
    if (!gradientStart || !gradientEnd) return;
    context.strokeStyle = '#70bfff';
    context.fillStyle = '#e5f3ff';
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(gradientStart.x, gradientStart.y);
    context.lineTo(gradientEnd.x, gradientEnd.y);
    context.stroke();
    context.setLineDash([]);
    for (const point of [gradientStart, gradientEnd]) {
      context.beginPath(); context.arc(point.x, point.y, 4, 0, Math.PI * 2); context.fill();
    }
  }

  function commitGradient() {
    if (!gradientStart || !gradientEnd || !gradientTargetId ||
        Math.hypot(gradientEnd.x - gradientStart.x, gradientEnd.y - gradientStart.y) < 2)
      return false;
    const options = toolSettings.gradient;
    const face = painter.getFaceTarget(gradientTargetId);
    if (!face || !painter.isMaterialVisible(gradientTargetId)) return false;
    const viewport = { width: gradientCanvas.width, height: gradientCanvas.height };
    const captureFor = (viewCamera) => options.xray ? null :
      captureVisibleUv(renderer, viewCamera,
        { object: face.mesh, face: { materialIndex: face.materialIndex } }, paintMeshes);
    const uvDistance = (a, b) => Math.min(Math.abs(a - b),
      textureResolution - Math.abs(a - b));
    const visibilityFor = (capture) => {
      if (!capture) return null;
      const tolerance = 3 + 3 * textureResolution /
        Math.max(1, Math.min(capture.width, capture.height));
      return (u, v, sx, sy) => {
      const expectedX = u * textureResolution;
      const expectedY = v * textureResolution;
      const centerX = Math.floor(sx), centerY = Math.floor(sy);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const uv = decodeVisibleUv(capture.buffer, capture.width, capture.height,
          centerX + ox, centerY + oy);
        if (uv && uvDistance(uv.x, expectedX) <= tolerance &&
            uvDistance(uv.y, expectedY) <= tolerance) return true;
      }
      return false;
      };
    };
    const visibleUv = visibilityFor(captureFor(camera));
    let mirror = null;
    if (mirrorEnabled) {
      const point = resolveMirrorHit.planePoint;
      const normal = resolveMirrorHit.planeNormal;
      const rect = renderer.domElement.getBoundingClientRect();
      let side = 0;
      const steps = Math.max(1, Math.ceil(Math.hypot(gradientEnd.x - gradientStart.x,
        gradientEnd.y - gradientStart.y) / 8));
      for (let i = 0; i <= steps && !side; i++) {
        const t = i / steps;
        const hit = hitTestAt(rect.left + gradientStart.x +
          (gradientEnd.x - gradientStart.x) * t,
        rect.top + gradientStart.y + (gradientEnd.y - gradientStart.y) * t);
        if (hit) {
          const distance = hit.point.clone().sub(point).dot(normal);
          if (Math.abs(distance) > 1e-5) side = Math.sign(distance);
        }
      }
      if (!side) side = Math.sign(camera.position.clone().sub(point).dot(normal)) || 1;
      const mirrorCamera = reflectedCamera(camera, point, normal);
      mirror = { camera: mirrorCamera, side, plane: { point, normal },
        visibleUv: visibilityFor(captureFor(mirrorCamera)) };
    }
    return painter.applyGradient(gradientTargetId, camera, viewport, gradientStart,
      gradientEnd, options, visibleUv, mirror);
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
    const { kind, options } = resolveTemporaryPaintTool(activeTool, toolSettings, event);
    if (kind !== strokeTool) {
      previousHit = null;
      previousMirrorHit = null;
      previousPaintScreen = null;
      strokeTool = kind;
    }
    const start = previousPaintScreen ?? end;
    const hits = initialHit !== undefined ? [initialHit] : gestureSamplingMode === 'uv' ?
      [hitTest(event)] : sampleScreenStroke(start, end, hitTestAt, 2);
    for (const hit of previousPaintScreen && gestureSamplingMode === 'surface' ? hits.slice(1) : hits) {
      previousHit = hit ? painter.paint(hit, kind, previousHit,
        options, gestureSamplingMode) : null;
      const mirrored = mirrorHitAt(hit);
      previousMirrorHit = mirrored ? painter.paint(mirrored, kind,
        previousMirrorHit, options, gestureSamplingMode) : null;
    }
    previousPaintScreen = end;
  }

  function previewLineAt(event) {
    if (!lineStartScreen) return;
    const end = { x: event.clientX, y: event.clientY };
    if (lineThrough && lineThroughTarget) {
      const paths = lineStylePaths(lineStartScreen, end, toolSettings.line);
      const hitPaths = withDoubleSidedPaintMeshes(() => paths.flatMap((points) => {
        const depths = [];
        for (let index = 1; index < points.length; index++) {
          const sampled = sampleThroughLine(points[index - 1], points[index], throughHitsAt);
          for (let depth = 0; depth < Math.max(depths.length, sampled.length); depth++) {
            if (!depths[depth]) depths[depth] = [];
            if (!sampled[depth]) depths[depth].push(null);
            else depths[depth].push(...(index === 1 ? sampled[depth] : sampled[depth].slice(1)));
          }
        }
        return depths;
      }));
      painter.updateLine(mirrorEnabled ?
        [...hitPaths, ...hitPaths.map((path) => path.map(mirrorHitAt))] : hitPaths);
      return;
    }
    if (gestureSamplingMode === 'uv') {
      const hit = hitTest(event);
      if (!hit || painter.targetIdAt(hit) !== painter.targetIdAt(lineStartHit)) return;
      painter.updateLine([[lineStartHit, hit], [lineStartMirrorHit, mirrorHitAt(hit)]]);
      return;
    }
    const paths = lineStylePaths(lineStartScreen, end, toolSettings.line);
    const hits = paths.map((points) => {
      const path = [];
      for (let index = 1; index < points.length; index++) {
        const segment = sampleScreenStroke(points[index - 1], points[index], hitTestAt, 2);
        path.push(...(index === 1 ? segment : segment.slice(1)));
      }
      return path;
    });
    painter.updateLine([...hits, ...(mirrorEnabled ? hits.map((path) => path.map(mirrorHitAt)) : [])]);
  }

  function resetCurve(cancel = false) {
    if (cancel) {
      painter.cancelLine();
      if ((pointerAction === 'curve' || pointerAction === 'preciseCurve') &&
          activePointer !== null) {
        const pointerId = activePointer;
        activePointer = null; pointerAction = null; strokeRect = null;
        if (renderer.domElement.hasPointerCapture(pointerId))
          renderer.domElement.releasePointerCapture(pointerId);
      }
    }
    curveStep = 0;
    curvePoints = [];
    curveStartHit = null;
    preciseAnchors = [];
    preciseDragIndex = -1;
    preciseDragOriginal = null;
    preciseDragStart = null;
    preciseGestureBefore = null;
    precisePath = undefined;
    curveCanvas.getContext('2d').clearRect(0, 0, curveCanvas.width, curveCanvas.height);
  }

  function preciseHistoryState() {
    return { targetId: selectedTargetId, settings: structuredClone(toolSettings.curve),
      anchors: preciseAnchors.map((anchor) => ({
        point: anchor.point.clone(), faceIndex: anchor.hit.faceIndex })) };
  }

  function currentPrecisePath() {
    if (precisePath !== undefined || preciseAnchors.length < 2)
      return precisePath ?? null;
    const face = painter.getFaceTarget(selectedTargetId);
    if (!face) return null;
    precisePath = buildSurfaceCurvePath(face.mesh, face.materialIndex,
      preciseAnchors, textureResolution, textureResolution);
    return precisePath;
  }

  function preciseScreenPoints() {
    const path = currentPrecisePath();
    const rect = renderer.domElement.getBoundingClientRect();
    if (!path) return preciseCurveScreenPoints(preciseAnchors, camera, rect, 4);
    const stride = Math.max(1, Math.ceil(path.samples.length / 2048));
    const scaleByFace = new Map(path.triangles.map((triangle) =>
      [triangle.faceIndex, triangle.worldPerTexel]));
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    const size = Math.max(1, toolSettings.curve?.size ?? 2);
    return path.samples.filter((sample, index) => index % stride === 0 ||
      index === path.samples.length - 1).map((sample) => {
      const view = sample.point.clone().project(camera);
      const edge = sample.point.clone().addScaledVector(cameraRight,
        size * (scaleByFace.get(sample.faceIndex) || 0)).project(camera);
      return { x: rect.left + (view.x + 1) * rect.width / 2,
        y: rect.top + (1 - view.y) * rect.height / 2,
        width: Math.hypot((edge.x - view.x) * rect.width / 2,
          (edge.y - view.y) * rect.height / 2) };
    });
  }

  function preciseAnchorAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    for (let index = preciseAnchors.length - 1; index >= 0; index--) {
      const view = preciseAnchors[index].point.clone().project(camera);
      const x = rect.left + (view.x + 1) * rect.width / 2;
      const y = rect.top + (1 - view.y) * rect.height / 2;
      if (Math.hypot(x - clientX, y - clientY) <= 10)
        return index;
    }
    return -1;
  }

  function previewCurveAt(event) {
    if (curvePoints.length < 2) return;
    curvePoints[curveStep === 0 ? 1 : curveStep + 1] =
      { x: event.clientX, y: event.clientY };
    renderCurvePreview();
  }

  function renderCurvePreview() {
    const context = curveCanvas.getContext('2d');
    context.clearRect(0, 0, curveCanvas.width, curveCanvas.height);
    const precise = toolSettings.curve?.curveMethod === 'precise';
    if (precise ? !preciseAnchors.length : curvePoints.length < 2) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const points = precise ? preciseScreenPoints() :
      curveScreenPoints(curvePoints, curveStep);
    const paths = styledPolylinePaths(points, toolSettings.curve);
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const projectedWidths = precise ? points.map((point) => point.width)
      .filter((width) => Number.isFinite(width) && width > 0)
      .sort((a, b) => a - b) : [];
    context.lineWidth = Math.max(1, projectedWidths.length ?
      projectedWidths[Math.floor(projectedWidths.length / 2)] :
      (toolSettings.curve?.size ?? 2));
    context.strokeStyle = toolSettings.curve?.color ?? '#ffffff';
    context.shadowColor = '#000000';
    context.shadowBlur = 3;
    for (const path of paths) {
      if (!path.length) continue;
      context.beginPath();
      context.moveTo(path[0].x - rect.left, path[0].y - rect.top);
      for (const point of path.slice(1)) context.lineTo(point.x - rect.left, point.y - rect.top);
      context.stroke();
    }
    context.shadowBlur = 0;
    context.fillStyle = '#70bfff';
    const anchors = precise ? preciseAnchors.map((anchor) => {
      const view = anchor.point.clone().project(camera);
      return { x: rect.left + (view.x + 1) * rect.width / 2,
        y: rect.top + (1 - view.y) * rect.height / 2 };
    }) : curvePoints;
    for (const point of anchors) {
      context.beginPath();
      context.arc(point.x - rect.left, point.y - rect.top, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function commitCurve() {
    if (toolSettings.curve?.lineStyle === 'texture') return commitCurveTexture();
    if (!curveStartHit || !painter.beginLine(curveStartHit, toolSettings.curve,
      mirrorHitAt(curveStartHit), curveMode, true)) return false;
    const paths = styledPolylinePaths(curveScreenPoints(curvePoints, 2), toolSettings.curve);
    const hits = paths.map((points) => {
      const path = [];
      for (let index = 1; index < points.length; index++) {
        const segment = sampleScreenStroke(points[index - 1], points[index], hitTestAt, 2);
        path.push(...(index === 1 ? segment : segment.slice(1)));
      }
      return path;
    });
    painter.updateLine([...hits, ...(mirrorEnabled ? hits.map((path) => path.map(mirrorHitAt)) : [])]);
    return painter.commitLine();
  }

  function commitPreciseCurve() {
    if (preciseAnchors.length < 2) return false;
    const path = currentPrecisePath();
    if (!path) return false;
    const targetId = selectedTargetId;
    const options = { ...toolSettings.curve };
    const history = preciseHistoryState();
    const mirror = mirrorEnabled ? { point: resolveMirrorHit.planePoint,
      normal: resolveMirrorHit.planeNormal } : null;
    if (options.lineStyle === 'texture' && !options.textureImage?.dataUrl) return false;
    if (options.lineStyle === 'texture') return curveImageData(options.textureImage)
      .then((image) => image && targetId === selectedTargetId ?
        painter.applySurfaceCurve(targetId, path, image, options, mirror, history) : false);
    return painter.applySurfaceCurve(targetId, path, null, options, mirror, history);
  }

  function movePreciseAnchor(event) {
    if (preciseDragIndex < 0 || !preciseDragStart ||
        Math.hypot(event.clientX - preciseDragStart.x,
          event.clientY - preciseDragStart.y) < 2) return;
    const hit = hitTest(event);
    if (!painter.canPaintAt(hit) ||
        painter.targetIdAt(hit) !== selectedTargetId) return;
    preciseAnchors[preciseDragIndex] = { point: hit.point.clone(), hit };
    precisePath = undefined;
    renderCurvePreview();
  }

  function finishPreciseCurve() {
    if (preciseAnchors.length < 2) return;
    let result;
    try { result = commitPreciseCurve(); }
    catch (error) {
      onSelectionChanged?.(`Curve failed: ${error.message}`);
      return;
    }
    if (result === false) {
      onSelectionChanged?.('Curve unchanged');
      return;
    }
    if (result instanceof Promise) result.then((changed) => {
      if (changed) { resetCurve(); onContentChanged?.(); }
      onSelectionChanged?.(changed ? 'Curve painted' : 'Curve unchanged');
    }).catch((error) => onSelectionChanged?.(`Curve failed: ${error.message}`));
    else {
      if (result) { resetCurve(); onContentChanged?.(); }
      onSelectionChanged?.(result ? 'Curve painted' : 'Curve unchanged');
    }
  }

  const curveImageCache = new Map();
  async function curveImageData(image) {
    if (!image?.dataUrl) return null;
    if (!curveImageCache.has(image.dataUrl)) {
      const pending = new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = source.naturalWidth;
          canvas.height = source.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(source, 0, 0);
          resolve(context.getImageData(0, 0, canvas.width, canvas.height));
        };
        source.onerror = () => reject(new Error('Could not decode curve image'));
        source.src = image.dataUrl;
      });
      curveImageCache.set(image.dataUrl, pending);
      pending.catch(() => curveImageCache.delete(image.dataUrl));
    }
    return curveImageCache.get(image.dataUrl);
  }

  async function commitCurveTexture(precisePoints = null, preciseStartHit = null) {
    const settings = { ...toolSettings.curve };
    const targetId = selectedTargetId;
    const startHit = preciseStartHit ?? curveStartHit;
    const points = precisePoints ?? curveScreenPoints(curvePoints, 2, 2);
    const rect = renderer.domElement.getBoundingClientRect();
    const localPoints = points.map((point) =>
      ({ x: point.x - rect.left, y: point.y - rect.top }));
    const image = await curveImageData(settings.textureImage);
    if (!image || !startHit || !painter.isMaterialVisible(targetId) ||
        targetId !== selectedTargetId) return false;
    const face = painter.getFaceTarget(targetId);
    if (!face) return false;
    const viewport = { width: curveCanvas.width, height: curveCanvas.height };
    const captureFor = (viewCamera) => captureVisibleUv(renderer, viewCamera,
      { object: face.mesh, face: { materialIndex: face.materialIndex } }, paintMeshes);
    const visibilityFor = (capture) => {
      const tolerance = 3 + 3 * textureResolution /
        Math.max(1, Math.min(capture.width, capture.height));
      return (u, v, sx, sy) => {
        const expectedX = u * textureResolution, expectedY = v * textureResolution;
        const centerX = Math.floor(sx), centerY = Math.floor(sy);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const uv = decodeVisibleUv(capture.buffer, capture.width, capture.height,
            centerX + ox, centerY + oy);
          const distanceX = Math.abs(uv?.x - expectedX);
          const distanceY = Math.abs(uv?.y - expectedY);
          if (uv && Math.min(distanceX, textureResolution - distanceX) <= tolerance &&
              Math.min(distanceY, textureResolution - distanceY) <= tolerance) return true;
        }
        return false;
      };
    };
    let mirror = null;
    if (mirrorEnabled) {
      const point = resolveMirrorHit.planePoint;
      const normal = resolveMirrorHit.planeNormal;
      const side = Math.sign(startHit.point.clone().sub(point).dot(normal)) || 1;
      const mirrorCamera = reflectedCamera(camera, point, normal);
      mirror = { camera: mirrorCamera, side, plane: { point, normal },
        visibleUv: visibilityFor(captureFor(mirrorCamera)) };
    }
    return painter.applyCurveTexture(targetId, camera, viewport, localPoints, image,
      { size: settings.size, opacity: settings.opacity,
        antialias: settings.antialias, seamless: settings.seamlessTexture },
      visibilityFor(captureFor(camera)), mirror);
  }

  function queueDraw(event) {
    pendingDraw = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey };
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
      else if (pointerAction === 'preciseCurve') movePreciseAnchor(next);
      else if (pointerAction === 'curve') previewCurveAt(next);
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

  function renderFaceRectangle() {
    const context = lassoCanvas.getContext('2d');
    context.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
    if (!faceStart || !faceEnd ||
        Math.hypot(faceEnd.x - faceStart.x, faceEnd.y - faceStart.y) <= 4) return;
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.strokeRect(faceStart.x + 0.5, faceStart.y + 0.5,
      faceEnd.x - faceStart.x, faceEnd.y - faceStart.y);
  }

  function finishFaceSelection(event) {
    if (event.type !== 'pointerup' || !faceStart) return;
    const end = viewportPoint(event);
    const target = painter.getFaceTarget(selectedTargetId);
    if (!target || !painter.isMaterialVisible(selectedTargetId)) return;
    let faces = new Set();
    if (Math.hypot(end.x - faceStart.x, end.y - faceStart.y) > 4) {
      const rect = { left: faceStart.x, top: faceStart.y,
        right: end.x, bottom: end.y };
      faces = captureVisibleFaces(renderer, camera, target.mesh,
        target.materialIndex, paintMeshes, rect);
      if (mirrorEnabled) {
        const width = renderer.domElement.getBoundingClientRect().width;
        const mirrorCamera = reflectedCamera(camera, resolveMirrorHit.planePoint,
          resolveMirrorHit.planeNormal);
        const mirrored = captureVisibleFaces(renderer, mirrorCamera, target.mesh,
          target.materialIndex, paintMeshes,
          { left: width - rect.right, top: rect.top,
            right: width - rect.left, bottom: rect.bottom });
        for (const index of mirrored) faces.add(index);
      }
    } else {
      const hit = hitTest(event);
      if (hit?.faceIndex !== undefined) faces.add(hit.faceIndex);
      const mirrored = mirrorHitAt(hit);
      if (mirrored?.faceIndex !== undefined) faces.add(mirrored.faceIndex);
    }
    const selected = painter.selectFaces(selectedTargetId, faces, faceMode);
    onSelectionChanged?.(selected ?
      (faceMode === 'subtract' ? 'Faces deselected' : 'Faces selected') :
      faceMode === 'replace' ? 'Selection cleared' : 'Selection unchanged');
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
    const changed = painter.endLasso(mask, mirrorMask);
    lassoSourceHit = null;
    lassoPath = [];
    renderLassoPath();
    onSelectionChanged?.(changed ?
      (lassoMode === 'subtract' ? 'Selection reduced' :
        lassoMode === 'add' ? 'Selection expanded' : 'Selection created') :
      lassoMode === 'replace' ? 'Selection needs a larger visible area' : 'Selection unchanged');
  }

  function onWarpHandleDown(event) {
    if (event.button !== 0 || !warpTarget || !warpAnchor ||
        warpControls.getMode() !== 'scale') return;
    const rect = renderer.domElement.getBoundingClientRect();
    warpHandleRaycaster.setFromCamera({
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: 1 - ((event.clientY - rect.top) / rect.height) * 2
    }, camera);
    warpAnchor.updateWorldMatrix(true, true);
    const handle = warpHandleRaycaster.intersectObjects(warpHandles, false)[0]?.object;
    if (!handle) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const signs = handle.userData.warpSigns;
    const project = (direction) => warpAnchor.localToWorld(
      new THREE.Vector3(...direction.map((sign) => sign * 0.5))).project(camera);
    const start = project(signs);
    const opposite = project(signs.map((sign) => -sign));
    warpHandleDrag = { pointerId: event.pointerId, signs,
      transform: readWarpTransform(), x: event.clientX, y: event.clientY,
      axisX: (start.x - opposite.x) * rect.width / 2,
      axisY: -(start.y - opposite.y) * rect.height / 2 };
    controls.enabled = false;
    renderer.domElement.setPointerCapture(event.pointerId);
    onProjectionStart?.(warpTarget.targetId, warpTarget.nodeId);
  }

  function onWarpHandleMove(event) {
    const drag = warpHandleDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const lengthSquared = drag.axisX ** 2 + drag.axisY ** 2;
    const factor = Math.max(0.01, lengthSquared < 144 ?
      1 + (drag.y - event.clientY) / 120 :
      1 + ((event.clientX - drag.x) * drag.axisX +
        (event.clientY - drag.y) * drag.axisY) / lengthSquared);
    const transform = resizeWarpProjection(drag.transform, drag.signs, factor);
    warpAnchor.position.set(...transform.position);
    warpAnchor.scale.set(...transform.scale);
    onProjectionPreview?.(warpTarget.targetId, warpTarget.nodeId, transform);
  }

  function onWarpHandleEnd(event) {
    const drag = warpHandleDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointercancel') {
      warpAnchor.position.set(...drag.transform.position);
      warpAnchor.scale.set(...drag.transform.scale);
    } else onWarpHandleMove(event);
    warpHandleDrag = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(event.pointerId))
      renderer.domElement.releasePointerCapture(event.pointerId);
    onProjectionEnd?.(warpTarget.targetId, warpTarget.nodeId, readWarpTransform());
  }

  function onPointerDown(event) {
    if (event.button === 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activePointer === null) {
        const color = painter.sample(hitTestAt(event.clientX, event.clientY, false));
        if (color) onColorPicked?.(color);
      }
      return;
    }
    if (warpTarget && (warpControls.axis || warpControls.dragging)) return;
    if (event.button === 0 && spacePressed) {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      event.preventDefault();
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    controls.mouseButtons.LEFT = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    activePointer = event.pointerId;
    gestureSamplingMode = samplingMode;
    strokeRect = renderer.domElement.getBoundingClientRect();
    previousHit = null;
    previousMirrorHit = null;
    previousPaintScreen = null;
    strokeTool = null;
    lineStartScreen = null;
    lineStartHit = null;
    lineStartMirrorHit = null;
    lineThrough = false;
    lineThroughTarget = null;
    const hit = hitTest(event);
    if (activeTool === 'faces') {
      pointerAction = 'faces';
      faceStart = viewportPoint(event);
      faceEnd = faceStart;
      faceMode = event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace';
    } else if (activeTool === 'lasso' || activeTool === 'wand') {
      if (activeTool === 'lasso')
        lassoMode = event.altKey ? 'subtract' : event.shiftKey ? 'add' : 'replace';
      const wandMode = event.altKey ? 'subtract' : event.shiftKey ? 'add' :
        (event.ctrlKey || event.metaKey) ? 'subtract' : 'replace';
      pointerAction = ((activeTool === 'lasso' && lassoMode === 'replace') ||
        (activeTool === 'wand' && wandMode === 'replace')) &&
        painter.selectedAt(hit) ? 'moveSelection' : activeTool;
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
      else if (activeTool === 'lasso') {
        if (painter.beginLasso(hit, lassoMode)) lassoSourceHit = hit;
        if (lassoSourceHit) {
          const rect = renderer.domElement.getBoundingClientRect();
          lassoPath = [{ x: event.clientX - rect.left, y: event.clientY - rect.top }];
          renderLassoPath();
        }
        lastLassoScreen = { x: event.clientX, y: event.clientY };
        lassoStartScreen = lastLassoScreen;
        lassoDragged = false;
      } else {
        const created = hit ? painter.selectWand(hit, toolSettings.wand, wandMode,
          mirrorHitAt(hit), gestureSamplingMode) : false;
        if (!hit && wandMode === 'replace') painter.clearSelection();
        onSelectionChanged?.(created ? 'Selection created' : 'Selection cleared');
      }
    } else if (activeTool === 'curve') {
      if (toolSettings.curve?.curveMethod === 'precise') {
        renderer.domElement.focus({ preventScroll: true });
        const anchorIndex = preciseAnchorAt(event.clientX, event.clientY);
        if (anchorIndex >= 0) {
          preciseGestureBefore = preciseHistoryState();
          preciseDragIndex = anchorIndex;
          preciseDragOriginal = preciseAnchors[anchorIndex];
          preciseDragStart = { x: event.clientX, y: event.clientY };
          pointerAction = 'preciseCurve';
        } else if (painter.canPaintAt(hit) &&
            painter.targetIdAt(hit) === selectedTargetId) {
          preciseGestureBefore = preciseHistoryState();
          preciseAnchors.push({ point: hit.point.clone(), hit });
          precisePath = undefined;
          preciseDragIndex = preciseAnchors.length - 1;
          preciseDragOriginal = null;
          preciseDragStart = { x: event.clientX, y: event.clientY };
          pointerAction = 'preciseCurve';
          renderCurvePreview();
        }
      } else if (curveStep === 0) {
        if (painter.canPaintAt(hit)) {
          const start = { x: event.clientX, y: event.clientY };
          curvePoints = [start, { ...start }];
          curveStartHit = hit;
          curveMode = gestureSamplingMode;
          pointerAction = 'curve';
          renderCurvePreview();
        }
      } else {
        pointerAction = 'curve';
        previewCurveAt(event);
      }
    } else if (activeTool === 'gradient') {
      pointerAction = 'gradient';
      gradientStart = viewportPoint(event);
      gradientEnd = gradientStart;
      gradientTargetId = selectedTargetId;
      renderGradientGuide();
    } else if (activeTool === 'line') {
      if (event.ctrlKey) {
        painter.beginThroughLine(toolSettings.line);
        lineThrough = true;
        lineThroughTarget = painter.getFaceTarget(selectedTargetId);
        lineStartScreen = { x: event.clientX, y: event.clientY };
        if (lineThroughTarget) previewLineAt(event);
      } else {
        const mirrored = mirrorHitAt(hit);
        if (painter.beginLine(hit, toolSettings.line, mirrored, gestureSamplingMode)) {
          lineStartScreen = { x: event.clientX, y: event.clientY };
          lineStartHit = hit;
          lineStartMirrorHit = mirrored;
        }
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
    if (pointerAction === 'faces') {
      faceEnd = viewportPoint(event);
      renderFaceRectangle();
    }
    else if (pointerAction === 'lasso') {
      if (lassoStartScreen && Math.hypot(event.clientX - lassoStartScreen.x,
        event.clientY - lassoStartScreen.y) > 4) lassoDragged = true;
      traceLassoTo(event);
    }
    else if (pointerAction === 'gradient') {
      gradientEnd = viewportPoint(event);
      renderGradientGuide();
    }
    else if (pointerAction === 'preciseCurve') queueDraw(event);
    else if (pointerAction === 'moveSelection' || pointerAction === 'curve') queueDraw(event);
    else if (activeTool === 'line' || activeTool === 'brush' ||
        activeTool === 'eraser' || activeTool === 'blur') queueDraw(event);
  }
  function endStroke(event) {
    if (event.pointerId !== activePointer) {
      if (event.button === 0) controls.mouseButtons.LEFT = null;
      return;
    }
    event.stopImmediatePropagation();
    if (drawFrame !== null) cancelAnimationFrame(drawFrame);
    drawFrame = null;
    pendingDraw = null;
    let curveCommitted = false;
    let gradientCommitted = false;
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
    strokeTool = null;
    if (pointerAction === 'faces') {
      try { finishFaceSelection(event); }
      catch (error) { onSelectionChanged?.(`Face selection failed: ${error.message}`); }
      finally {
        faceStart = null; faceEnd = null; faceMode = 'replace';
        renderFaceRectangle();
      }
    } else if (pointerAction === 'lasso') {
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
        if (lassoMode === 'replace') {
          const cleared = painter.clearSelection();
          onSelectionChanged?.(cleared ? 'Selection cleared' :
            hitTest(event) ? 'Hold and drag to draw a lasso' : 'Start the lasso on the model');
        } else onSelectionChanged?.('Selection unchanged');
      }
    } else if (pointerAction === 'moveSelection') {
      if (event.type === 'pointercancel') painter.cancelMove();
      else {
        if (painter.endMove()) onSelectionChanged?.('Selection moved');
      }
    } else if (pointerAction === 'gradient') {
      if (event.type === 'pointerup') {
        gradientEnd = viewportPoint(event);
        try { gradientCommitted = commitGradient(); }
        catch (error) { onSelectionChanged?.(`Gradient failed: ${error.message}`); }
      }
      gradientStart = gradientEnd = gradientTargetId = null;
      renderGradientGuide();
    } else if (pointerAction === 'preciseCurve') {
      if (event.type === 'pointercancel') {
        if (preciseDragOriginal) preciseAnchors[preciseDragIndex] = preciseDragOriginal;
        else preciseAnchors.splice(preciseDragIndex, 1);
        precisePath = undefined;
        renderCurvePreview();
      } else {
        movePreciseAnchor(event);
        if (preciseGestureBefore && painter.recordCurveDraftChange(
          preciseGestureBefore, preciseHistoryState()))
          onSelectionChanged?.('Curve point updated');
      }
      preciseDragIndex = -1;
      preciseDragOriginal = null;
      preciseDragStart = null;
      preciseGestureBefore = null;
    } else if (pointerAction === 'curve') {
      if (event.type === 'pointercancel') resetCurve(true);
      else {
        previewCurveAt(event);
        if (curveStep === 2) {
          curveCommitted = commitCurve();
          resetCurve();
          if (curveCommitted instanceof Promise) {
            curveCommitted.then((changed) => {
              onSelectionChanged?.(changed ? 'Curve painted' : 'Curve unchanged');
              if (changed) onContentChanged?.();
            }).catch((error) => onSelectionChanged?.(`Curve failed: ${error.message}`));
            curveCommitted = false;
          } else onSelectionChanged?.(curveCommitted ? 'Curve painted' : 'Curve unchanged');
        } else {
          curveStep++;
          onSelectionChanged?.(curveStep === 1 ?
            'Curve: drag to place the first handle' :
            'Curve: drag to place the second handle');
        }
      }
    } else if (activeTool === 'line') {
      if (event.type === 'pointercancel') painter.cancelLine();
      else { previewLineAt(event); painter.commitLine(); }
    } else if (activeTool !== 'eyedropper' && activeTool !== 'wand') painter.endStroke();
    const movedSelection = pointerAction === 'moveSelection';
    pointerAction = null;
    lineStartScreen = null;
    lineStartHit = null;
    lineStartMirrorHit = null;
    lineThrough = false;
    lineThroughTarget = null;
    lastLassoScreen = null;
    lassoStartScreen = null;
    lassoDragged = false;
    lassoMode = 'replace';
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (movedSelection || curveCommitted || gradientCommitted ||
        (activeTool !== 'eyedropper' && activeTool !== 'wand' &&
          activeTool !== 'curve' && activeTool !== 'gradient')) {
      onContentChanged?.();
    }
  }
  function bindRendererCanvas(canvas) {
    canvas.tabIndex = -1;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', onWarpHandleDown, true);
    canvas.addEventListener('pointermove', onWarpHandleMove, true);
    canvas.addEventListener('pointerup', onWarpHandleEnd, true);
    canvas.addEventListener('pointercancel', onWarpHandleEnd, true);
    canvas.addEventListener('pointerdown', onPointerDown, true);
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('pointerup', endStroke, true);
    canvas.addEventListener('pointercancel', endStroke, true);
  }
  bindRendererCanvas(renderer.domElement);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && activeTool === 'curve' &&
        toolSettings.curve?.curveMethod === 'precise' && preciseAnchors.length >= 2 &&
        activePointer === null &&
        !event.target.closest?.('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      finishPreciseCurve();
      return;
    }
    if (event.key !== 'Escape') return;
    if (pointerAction === 'gradient') {
      const pointerId = activePointer;
      activePointer = null; pointerAction = null; strokeRect = null;
      gradientStart = gradientEnd = gradientTargetId = null;
      renderGradientGuide();
      if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
        renderer.domElement.releasePointerCapture(pointerId);
      event.preventDefault();
      return;
    }
    if (pointerAction === 'curve' || pointerAction === 'preciseCurve' ||
        curveStep > 0 || preciseAnchors.length) {
      const pointerId = activePointer;
      activePointer = null; pointerAction = null; strokeRect = null;
      resetCurve(true);
      if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
        renderer.domElement.releasePointerCapture(pointerId);
      onSelectionChanged?.('Curve cancelled');
      return;
    }
    if (pointerAction === 'lasso') {
      const pointerId = activePointer;
      painter.cancelLasso();
      activePointer = null; pointerAction = null; strokeRect = null;
      lassoSourceHit = null; lassoPath = []; lassoMode = 'replace';
      lastLassoScreen = null; lassoStartScreen = null; lassoDragged = false;
      renderLassoPath();
      if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
        renderer.domElement.releasePointerCapture(pointerId);
      onSelectionChanged?.('Selection gesture cancelled');
      return;
    }
    if (pointerAction === 'faces') {
      const pointerId = activePointer;
      activePointer = null; pointerAction = null; strokeRect = null;
      faceStart = null; faceEnd = null; faceMode = 'replace';
      renderFaceRectangle();
      if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
        renderer.domElement.releasePointerCapture(pointerId);
      onSelectionChanged?.('Selection gesture cancelled');
      return;
    }
    if (painter.cancelLasso() || painter.cancelMove()) {
      lassoSourceHit = null; lassoPath = []; renderLassoPath();
      lassoMode = 'replace';
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
          resetCurve(true);
          try { paintableMeshes = painter.prepare(next); }
          catch (error) { return reject(error); }
          clearWarpTarget();
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
    resetCurve(true);
    clearWarpTarget();
    setTextureResolution(resolution);
    setLightRotation(0, 0);
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
    const visibility = painter.getMaterialVisibilityState();
    return { model: modelSource, resolution: textureResolution,
      textures: painter.exportProjectTextures(),
      view: { camera: camera.position.toArray(), target: controls.target.toArray(),
        lighting: currentLightingMode, grid: grid.visible, mirror: mirrorEnabled,
        sampling: samplingMode, antialias: antialiasEnabled,
        wireframe: wireframeVisible,
        materials: { visible: visibility.items.map((item) => item.visible),
          isolatedIndex: visibility.items.findIndex((item) => item.id === visibility.isolatedId) },
        lightRotation: { yaw: lightYaw, pitch: lightPitch } } };
  }

  async function restoreProjectData(saved, file = null) {
    setTextureResolution(saved.resolution ?? 1024);
    if (saved.model.kind === 'starter') newProject(textureResolution);
    else {
      if (!file) throw new Error(`Model not found: ${saved.model.name}`);
      await importGlb(file, saved.model.referenceId);
    }
    await painter.restoreProjectTextures(saved.textures);
    painter.restoreMaterialVisibilityState(saved.view?.materials);
    mirrorEnabled = saved.view?.mirror === true;
    samplingMode = saved.view?.sampling === 'uv' ? 'uv' : 'surface';
    setLightRotation(saved.view?.lightRotation?.yaw ?? 0,
      saved.view?.lightRotation?.pitch ?? 0);
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
  let wireframeVisible = false;

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    lassoCanvas.width = width; lassoCanvas.height = height;
    curveCanvas.width = width; curveCanvas.height = height;
    gradientCanvas.width = width; gradientCanvas.height = height;
    renderGradientGuide();
    renderCurvePreview();
    if (pointerAction === 'faces') renderFaceRectangle();
    else renderLassoPath();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  const renderFrame = () => { controls.update(); updateLightView(); renderer.render(scene, camera); };
  controls.addEventListener('change', () => {
    if (activeTool === 'curve' && preciseAnchors.length) renderCurvePreview();
  });
  renderer.setAnimationLoop(renderFrame);

  function setAntialiasEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === antialiasEnabled) return;
    const oldRenderer = renderer;
    const nextRenderer = createRenderer(enabled);
    host.insertBefore(nextRenderer.domElement, oldRenderer.domElement);
    renderer = nextRenderer;
    painter.setRenderer(nextRenderer);
    controls.connect(nextRenderer.domElement);
    warpControls.disconnect();
    warpControls.connect(nextRenderer.domElement);
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
    setWireframeVisible: (visible) => {
      wireframeVisible = Boolean(visible);
      painter.setWireframeEnabled(wireframeVisible);
    },
    setAntialiasEnabled,
    setProjectionTarget,
    beginProjectionPreview: painter.beginProjectionPreview,
    previewProjectionGraph: painter.previewProjectionGraph,
    endProjectionPreview: painter.endProjectionPreview,
    setLightRotation,
    getLightViewState,
    setMirrorEnabled: (enabled) => { mirrorEnabled = Boolean(enabled); },
    getMirrorEnabled: () => mirrorEnabled,
    setSamplingMode: (mode) => { samplingMode = mode === 'uv' ? 'uv' : 'surface'; },
    getSamplingMode: () => samplingMode,
    setLightingMode: (mode) => { currentLightingMode = mode; painter.setLightingMode(mode); },
    setTool: (tool) => {
      if (activeTool === 'curve' && tool !== 'curve') resetCurve(true);
      if (tool !== 'faces' && pointerAction === 'faces') {
        const pointerId = activePointer;
        activePointer = null; pointerAction = null; strokeRect = null;
        faceStart = null; faceEnd = null; faceMode = 'replace';
        renderFaceRectangle();
        if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId))
          renderer.domElement.releasePointerCapture(pointerId);
      }
      if (tool !== 'lasso' && lassoPath.length) {
        painter.cancelLasso(); lassoSourceHit = null; lassoPath = [];
        lassoMode = 'replace'; renderLassoPath();
      }
      activeTool = tool;
      if ((tool === 'lasso' || tool === 'wand' || tool === 'faces') && toolSettings[tool]) {
        painter.setMaskEnabled(toolSettings[tool].maskEnabled);
        painter.setBlurSelectionIsolation(toolSettings[tool].isolateBlur);
      }
    },
    setToolSettings: (tool, settings) => {
      if (tool === 'curve' && toolSettings.curve?.curveMethod !== settings.curveMethod)
        resetCurve(true);
      toolSettings[tool] = { ...settings };
      if (tool === 'curve' && (curvePoints.length || preciseAnchors.length))
        renderCurvePreview();
      if (tool === activeTool && (tool === 'lasso' || tool === 'wand' || tool === 'faces')) {
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
    undo: () => warpControls.dragging || warpHandleDrag ? false : painter.undo(),
    redo: () => warpControls.dragging || warpHandleDrag ? false : painter.redo(),
    canUndo: () => !warpControls.dragging && !warpHandleDrag && painter.canUndo(),
    canRedo: () => !warpControls.dragging && !warpHandleDrag && painter.canRedo(),
    copySelection: painter.copySelection,
    cutSelection: painter.cutSelection,
    pasteSelection: painter.pasteSelection,
    canCopySelection: painter.canCopySelection,
    canPasteSelection: painter.canPasteSelection,
    getLayerImage: painter.getLayerImage,
    getImageInfo: painter.getImageInfo,
    getModelFile: () => modelFile,
    getModelSource: () => ({ ...modelSource }),
    getTexturePreview: painter.getCompositePreview,
    getExportTextures: painter.getExportTextures,
    canFilter: painter.canFilter,
    beginFilter: (targetId) => painter.beginFilter(targetId, samplingMode),
    previewFilter: painter.previewFilter,
    applyFilter: painter.applyFilter,
    cancelFilter: painter.cancelFilter,
    getGraphTargets: painter.getGraphTargets,
    getMaterialVisibilityState: painter.getMaterialVisibilityState,
    setMaterialVisibility: painter.setMaterialVisibility,
    toggleMaterialIsolation: painter.toggleMaterialIsolation,
    setPaintTarget: (id) => {
      if (id !== selectedTargetId) resetCurve(true);
      selectedTargetId = id;
    },
    setGraph: (...args) => { resetCurve(true); return painter.setGraph(...args); },
    recordGraphChange: painter.recordGraphChange,
    mergeLayerDown: painter.mergeLayerDown,
    createImage: painter.createImage,
    setPaintSource: (...args) => { resetCurve(true); return painter.setPaintSource(...args); },
    importImage: async (targetId, nodeId, file) => {
      if (!file?.type.startsWith('image/')) throw new Error('Select an image file.');
      const bitmap = await createImageBitmap(file);
      try { return painter.createImage(targetId, nodeId, bitmap, file.name, null, true); }
      finally { bitmap.close(); }
    }
  };
}
