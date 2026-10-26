import { createScene } from './editor/scene.js';
import { setTextureResolution } from './editor/texture-resolution.js';
import { listRecent, parseProject, PROJECT_VERSION, projectFileName,
  getModelHandle, removeRecent, saveModelHandle, saveRecent, writeProjectFile } from './editor/project-file.js';
import { TOOL_DEFINITIONS } from './editor/tools.js';
import { toolHint } from './editor/tool-hints.js';
import { colorPalette } from './ui/color-palette.js';
import { createNodeEditor } from './ui/node-editor.js';
import { createProjectHome } from './ui/project-home.js';
import { createLayersPanel } from './ui/layers-panel.js';
import { createTexturePreview } from './ui/texture-preview.js';
import { createTextureExportDialog } from './ui/texture-export-dialog.js';
import { createLightGizmo } from './ui/light-gizmo.js';
import { createModelRelinkDialog, MODEL_ACCEPT, MODEL_PICKER } from './ui/model-relink.js';
import { createSelectionSizeDialog } from './ui/selection-size-dialog.js';
import { createFilterDialog } from './ui/filter-dialog.js';
import { createBakeDialog } from './ui/bake-dialog.js';
import { FILTER_CATEGORIES } from './editor/filter-definitions.js';
import { writeTexturePngs } from './editor/texture-export.js';
import { dropdown, element, notice, panel, renderControl, renderPanel, toggleButton, toolbar } from './ui/index.js';
import mirrorIcon from './ui/icons/mirror.svg';
import samplingIcon from './ui/icons/sampling.svg';
import './style.css';

const app = document.querySelector('#app');
const fileInput = element('input', { attributes: { type: 'file', accept: MODEL_ACCEPT, hidden: '' } });
const projectInput = element('input', { attributes: { type: 'file', accept: '.tp3d,application/json', hidden: '' } });
const viewport = element('main', { className: 'viewport', attributes: { 'aria-label': '3D viewport' } });
const status = element('span', { className: 'status__message', text: 'Ready' });
const hint = element('span', { className: 'status__hint',
  attributes: { 'aria-live': 'polite' } });

const toolSettings = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.id,
  { ...tool.defaults, ...(tool.usesColor ? { color: '#000000' } : {}) }]));
let activeTool = 'brush';
let vertexMode = false;
const VERTEX_TOOLS = new Set(['vertexBrush', 'vertexBlur', 'vertexBucket',
  'vertexFaces', 'vertexSelect']);
let lastBitmapTool = 'brush';
let lastVertexTool = 'vertexBrush';
let nodeEditor;
let layersPanel;
let toolsPanel = null;
let texturePreview;
let lightGizmo;
let projectId = null;
let projectName = '';
let projectHandle = null;
let currentModelHandle = null;
let dirty = false;
let loadingProject = false;
function markDirty() { if (projectId && !loadingProject) dirty = true; }
const scene = createScene(viewport, {
  onGraphTargetsChanged: (targets) => nodeEditor?.setTargets(targets),
  onGraphHistoryApplied: (targetId, graph) => nodeEditor?.applyHistoryGraph(targetId, graph),
  onRestoreCurve: (targetId, settings) => {
    nodeEditor?.selectTarget(targetId);
    toolSettings.curve = structuredClone(settings);
    scene.setToolSettings('curve', toolSettings.curve);
    selectTool('curve');
  },
  onSelectionChanged: (message) => {
    setStatus(message); editMenu.refresh(); selectMenu.refresh();
    nodeEditor?.refreshHistoryButtons();
  },
  onLightViewChanged: (state) => lightGizmo?.setState(state),
  onProjectionStart: (targetId, nodeId) => {
    nodeEditor?.beginWarpTransform(targetId, nodeId);
    scene.beginProjectionPreview(targetId);
  },
  onProjectionPreview: (targetId, nodeId, transform) =>
    nodeEditor?.previewWarpTransform(targetId, nodeId, transform),
  onProjectionEnd: (targetId, nodeId, transform) => {
    nodeEditor?.finishWarpTransform(targetId, nodeId, transform);
    scene.endProjectionPreview();
    markDirty();
  },
  onContentChanged: () => {
    const state = nodeEditor?.getState();
    const source = state?.graph?.nodes.find((node) => node.id === state.paintSource);
    layersPanel?.refreshThumbnails(source ? { targetId: state.targetId,
      imageKey: source.imageKey, vertexColor: source.vertexColor } : null);
    nodeEditor?.refreshHistoryButtons(); markDirty();
  }, onColorPicked: (color) => {
  palette.setColor(color);
  setStatus(`Sampled ${color.toUpperCase()}`);
} });
nodeEditor = createNodeEditor({ targets: scene.getGraphTargets(),
  onChange: (id, graph) => { scene.setGraph(id, graph); markDirty(); },
  onRecordGraphChange: (id, before, after) => scene.recordGraphChange(id, before, after),
  onUndo: undo, onRedo: redo, onCanUndo: () => scene.canUndo(),
  onCanRedo: () => scene.canRedo(),
  onPreviewChange: (id, graph) => scene.previewProjectionGraph(id, graph),
  onCreateImage: (id, nodeId) => scene.createImage(id, nodeId),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onPaintSourceChange: (id, nodeId) => { const changed = scene.setPaintSource(id, nodeId); if (changed) markDirty(); return changed; },
  onStateChange: (state) => {
    scene.setPaintTarget(state.targetId);
    scene.setProjectionTarget(state.targetId, state.graph, state.paintSource);
    layersPanel?.setState(state);
    texturePreview?.setTarget(state.targetId,
      state.targets.find((target) => target.id === state.targetId)?.label);
    syncToolMode(state);
  },
  onError: (message) => setStatus(message, true)
});
layersPanel = createLayersPanel({ nodeEditor,
  onCreateImage: (id, nodeId, source, name, preserveResolution) =>
    scene.createImage(id, nodeId, source, name, null, preserveResolution),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onMergeLayer: (id, layerId, graph) => scene.mergeLayerDown(id, layerId, graph),
  getImageCanvas: (id, key, vertexColor) => scene.getLayerImage(id, key, vertexColor),
  getImageInfo: (id, key) => scene.getImageInfo(id, key),
  getMaterialVisibilityState: () => scene.getMaterialVisibilityState(),
  onToggleMaterialVisibility: (id) => {
    const item = scene.getMaterialVisibilityState().items.find((entry) => entry.id === id);
    if (item && scene.setMaterialVisibility(id, !item.effectiveVisible)) markDirty();
  },
  onToggleMaterialIsolation: (id) => {
    if (scene.toggleMaterialIsolation(id)) markDirty();
  },
  onMaterialTransparencyChange: (id, mode) => {
    if (scene.setMaterialTransparency(id, mode)) markDirty();
  },
  onError: (message) => setStatus(message, true)
});
texturePreview = createTexturePreview({ getTexture: (id) => scene.getTexturePreview(id),
  onClose: () => displayMenu.refresh() });
const textureExportDialog = createTextureExportDialog({
  getTextures: () => scene.getExportTextures(),
  chooseDirectory: () => {
    if (!window.showDirectoryPicker)
      throw new Error('Folder export requires a browser with the File System Access API.');
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'texture-export' });
  },
  onExport: writeTexturePngs,
  onComplete: (count, folder) => setStatus(`${count} texture${count === 1 ? '' : 's'} exported to ${folder}`),
  onError: (message) => setStatus(message, true)
});
lightGizmo = createLightGizmo({
  onChange: (yaw, pitch) => { scene.setLightRotation(yaw, pitch); markDirty(); },
  onEnd: () => setStatus('Lighting rotated'),
  onReset: () => {
    scene.setLightRotation(0, 0);
    markDirty();
    setStatus('Lighting reset');
  }
});
lightGizmo.setState(scene.getLightViewState());
viewport.append(lightGizmo.element);
const initialTarget = nodeEditor.getState();
texturePreview.setTarget(initialTarget.targetId,
  initialTarget.targets.find((target) => target.id === initialTarget.targetId)?.label);
const modelRelink = createModelRelinkDialog();
for (const tool of TOOL_DEFINITIONS) scene.setToolSettings(tool.id, toolSettings[tool.id]);
const palette = colorPalette({ color: '#000000', onChange: (color) => {
  for (const tool of TOOL_DEFINITIONS.filter((item) => item.usesColor)) {
    toolSettings[tool.id].color = color;
    scene.setToolSettings(tool.id, toolSettings[tool.id]);
  }
  markDirty();
} });
let lightingMode = 'shaded';
let gridVisible = true;
let wireframeVisible = false;
let antialiasEnabled = true;
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

async function importModelFile(file, handle = null) {
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    const { paintableMeshes } = await scene.importModel(file);
    currentModelHandle = handle;
    let linkStored = false;
    if (handle) {
      try {
        await saveModelHandle(scene.getModelSource().referenceId, handle);
        linkStored = true;
      } catch { /* The model can still be located manually when reopening. */ }
    }
    markDirty();
    setStatus(`${file.name} imported · ${paintableMeshes} paintable mesh${paintableMeshes === 1 ? '' : 'es'}` +
      (linkStored ? '' : ' · locate the model when reopening'), !linkStored);
  } catch (error) {
    setStatus(error.message || 'Import failed', true);
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  await importModelFile(file);
});

async function chooseModelFile() {
  if (!window.showOpenFilePicker) { fileInput.click(); return; }
  try {
    const [handle] = await window.showOpenFilePicker(MODEL_PICKER);
    if (handle) await importModelFile(await handle.getFile(), handle);
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message || 'Could not open model.', true);
  }
}

const fileMenu = dropdown({ label: 'File', items: [
  { label: 'New Project', onSelect: () => {
    projectHome.show(Boolean(projectId));
    projectHome.showNew();
  } },
  { label: 'Open Project', onSelect: chooseProjectFile },
  { label: 'Save Project', shortcut: 'Ctrl+S', getDisabled: () => !projectId, onSelect: saveProject },
  { label: 'Save Project As', getDisabled: () => !projectId, onSelect: () => saveProject(true) },
  { type: 'separator' },
  { label: 'Import Model', onSelect: chooseModelFile },
  { label: 'Export Texture', getDisabled: () => !projectId,
    onSelect: () => textureExportDialog.open() }
] });

function undo() {
  if (scene.undo()) { setStatus('Undid action'); layersPanel.refreshThumbnails(); markDirty(); }
  nodeEditor?.refreshHistoryButtons();
  editMenu.refresh();
  selectMenu.refresh();
}

function redo() {
  if (scene.redo()) { setStatus('Redid action'); layersPanel.refreshThumbnails(); markDirty(); }
  nodeEditor?.refreshHistoryButtons();
  editMenu.refresh();
  selectMenu.refresh();
}

function copySelection() {
  if (scene.copySelection()) setStatus('Selection copied');
  editMenu.refresh();
}

function cutSelection() {
  if (scene.cutSelection()) {
    setStatus('Selection cut'); layersPanel.refreshThumbnails(); markDirty();
  }
  editMenu.refresh();
  selectMenu.refresh();
}

function pasteSelection() {
  if (scene.pasteSelection(nodeEditor.getState().targetId)) {
    selectTool('lasso');
    setStatus('Selection pasted · drag to move');
    layersPanel.refreshThumbnails(); markDirty();
  }
  editMenu.refresh();
  selectMenu.refresh();
}

const editMenu = dropdown({ label: 'Edit', items: [
  { label: 'Undo', shortcut: 'Ctrl+Z', getDisabled: () => !scene.canUndo(), onSelect: undo },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', getDisabled: () => !scene.canRedo(), onSelect: redo },
  { type: 'separator' },
  { label: 'Copy', shortcut: 'Ctrl+C', getDisabled: () => !scene.canCopySelection(), onSelect: copySelection },
  { label: 'Cut', shortcut: 'Ctrl+X', getDisabled: () => !scene.canCopySelection(), onSelect: cutSelection },
  { label: 'Paste', shortcut: 'Ctrl+V', getDisabled: () => !scene.canPasteSelection(), onSelect: pasteSelection }
] });

function invertSelection() {
  if (scene.invertSelection()) setStatus('Selection inverted');
  editMenu.refresh();
  selectMenu.refresh();
}

function openSelectionSize(mode) {
  if (scene.canResizeSelection())
    selectionSizeDialog.open(mode, scene.getSelectionUnit());
}

const selectMenu = dropdown({ label: 'Select', items: [
  { label: 'Select more', shortcut: 'Ctrl++', getDisabled: () => !scene.canResizeSelection(),
    onSelect: () => openSelectionSize('expand') },
  { label: 'Select less', shortcut: 'Ctrl+-', getDisabled: () => !scene.canResizeSelection(),
    onSelect: () => openSelectionSize('contract') },
  { label: 'Invert Selection', shortcut: 'Ctrl+I', getDisabled: () => !scene.canInvertSelection(),
    onSelect: invertSelection }
] });

const filterDialog = createFilterDialog({
  onBegin: () => scene.beginFilter(nodeEditor.getState().targetId),
  onPreview: (category, settings) => scene.previewFilter(category, settings),
  onApply: (category, settings) => {
    const changed = scene.applyFilter(category, settings);
    if (changed) {
      layersPanel.refreshThumbnails();
      markDirty();
      setStatus(`${FILTER_CATEGORIES.find((item) => item.id === category)?.label} filter applied`);
    }
    editMenu.refresh();
  },
  onCancel: () => scene.cancelFilter(),
  onError: (message) => setStatus(message, true)
});
const filterMenu = dropdown({ label: 'Filter', items: FILTER_CATEGORIES.map((category) => ({
  label: category.label, getDisabled: () => !scene.canFilter(nodeEditor.getState().targetId),
  onSelect: () => filterDialog.open(category.id)
})) });
const bakeDialog = createBakeDialog({
  onBake: async (type, targetId, settings, onProgress, signal) => {
    const image = type === 'curvature' ?
      await scene.bakeCurvature(targetId, settings, onProgress, signal) :
      await scene.bakeAmbientOcclusion(targetId, settings, onProgress, signal);
    return layersPanel.addBakedLayer(targetId, image,
      type === 'curvature' ? 'Curvature' : 'Ambient Occlusion',
      type === 'curvature' ? 'mix' : 'multiply');
  },
  onComplete: (type) => {
    markDirty();
    nodeEditor.refreshHistoryButtons();
    setStatus(`${type === 'curvature' ? 'Curvature' : 'Ambient occlusion'} baked into a new layer`);
  },
  onError: (message) => setStatus(message, true)
});

function applySelectionSize(mode, amount, unit = scene.getSelectionUnit()) {
  if (scene.resizeSelection(amount, mode === 'expand')) {
    const measure = unit === 'faces' ? `${amount} face${amount === 1 ? '' : 's'}` :
      unit === 'vertices' ? `${amount} ${amount === 1 ? 'vertex' : 'vertices'}` :
      `${amount} px`;
    setStatus(mode === 'expand' ? `Selection expanded by ${measure}` :
      `Selection contracted by ${measure}`);
  }
  editMenu.refresh();
  selectMenu.refresh();
}

const selectionSizeDialog = createSelectionSizeDialog({ onApply: applySelectionSize });

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      !event.target.closest?.('input, textarea, select, [contenteditable], .node-editor')) {
    if ((key === '+' || key === '=' || event.code === 'NumpadAdd') &&
        scene.canResizeSelection()) {
      event.preventDefault(); applySelectionSize('expand', 1); return;
    }
    if (!event.shiftKey && (key === '-' || event.code === 'NumpadSubtract') &&
        scene.canResizeSelection()) {
      event.preventDefault(); applySelectionSize('contract', 1); return;
    }
    if (!event.shiftKey && key === 'i' && scene.canInvertSelection()) {
      event.preventDefault(); invertSelection(); return;
    }
    if (!event.shiftKey) {
      if (key === 'c' && scene.canCopySelection()) {
        event.preventDefault(); copySelection(); return;
      }
      if (key === 'x' && scene.canCopySelection()) {
        event.preventDefault(); cutSelection(); return;
      }
      if (key === 'v' && scene.canPasteSelection()) {
        event.preventDefault(); pasteSelection(); return;
      }
    }
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveProject();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  if (event.shiftKey) redo();
  else undo();
});

const modeLabel = element('span', { className: 'viewport-header__mode', text: '●  SHADED' });
function applyLightingMode(mode) {
  lightingMode = mode;
  scene.setLightingMode(mode);
  lightGizmo.setVisible(mode === 'shaded');
  modeLabel.textContent = mode === 'unlit' ? '●  UNLIT' : '●  SHADED';
}
const displayMenu = dropdown({ label: 'Display', items: [
  { type: 'checkbox', label: 'Show grid', getChecked: () => gridVisible, keepOpen: true, onSelect: () => {
    gridVisible = !gridVisible;
    scene.setGridVisible(gridVisible);
    markDirty();
  } },
  { type: 'checkbox', label: 'Wireframe', getChecked: () => wireframeVisible,
    keepOpen: true, onSelect: () => {
      wireframeVisible = !wireframeVisible;
      scene.setWireframeVisible(wireframeVisible);
      markDirty();
    } },
  { type: 'checkbox', label: '2D Texture', getChecked: () => texturePreview.isVisible(),
    keepOpen: true, onSelect: () => texturePreview.setVisible(!texturePreview.isVisible()) }
] });
const renderingMenu = dropdown({ label: 'Rendering', items: [
  { type: 'radio', label: 'Shaded', getChecked: () => lightingMode === 'shaded', onSelect: () => {
    applyLightingMode('shaded');
    markDirty();
  } },
  { type: 'radio', label: 'Unlit', getChecked: () => lightingMode === 'unlit', onSelect: () => {
    applyLightingMode('unlit');
    markDirty();
  } },
  { type: 'separator' },
  { type: 'checkbox', label: 'Antialiasing', getChecked: () => antialiasEnabled,
    keepOpen: true, onSelect: () => {
      antialiasEnabled = !antialiasEnabled;
      scene.setAntialiasEnabled(antialiasEnabled);
      markDirty();
    } }
] });
const bakeMenu = dropdown({ label: 'Bake', items: [
  { label: 'Ambient occlusion', getDisabled: () => !nodeEditor.getState().targetId,
    onSelect: () => {
      const state = nodeEditor.getState();
      const material = state.targets.find((item) => item.id === state.targetId);
      bakeDialog.open(state.targetId, material?.label ?? 'Selected material');
    } },
  { label: 'Curvature', getDisabled: () => !nodeEditor.getState().targetId,
    onSelect: () => {
      const state = nodeEditor.getState();
      const material = state.targets.find((item) => item.id === state.targetId);
      bakeDialog.open(state.targetId, material?.label ?? 'Selected material', 'curvature');
    } }
] });

const projectTag = element('span', { className: 'app-header__tag', text: 'NO PROJECT' });
const samplingButton = toggleButton({ label: 'Switch to UV sampling', iconUrl: samplingIcon,
  className: 'app-header__sampling', onChange: (enabled) => {
    const mode = enabled ? 'uv' : 'surface';
    scene.setSamplingMode(mode);
    updateSamplingButton(mode);
    markDirty();
    setStatus(mode === 'uv' ? 'UV sampling' : '3D surface sampling');
  } });
function updateSamplingButton(mode) {
  samplingButton.setPressed(mode === 'uv');
  const label = mode === 'uv' ? 'Switch to 3D surface sampling' : 'Switch to UV sampling';
  samplingButton.setAttribute('title', label);
  samplingButton.setAttribute('aria-label', label);
}
const mirrorButton = toggleButton({ label: 'Mirror on X axis', iconUrl: mirrorIcon,
  className: 'app-header__mirror', onChange: (enabled) => {
    scene.setMirrorEnabled(enabled);
    markDirty();
    setStatus(`Mirror ${enabled ? 'on' : 'off'}`);
  } });
const header = element('header', { className: 'app-header' }, [
  element('div', { className: 'brand' }, [
    element('span', { className: 'brand__mark', text: '◈', attributes: { 'aria-hidden': 'true' } }),
    element('span', { className: 'brand__name', text: 'TEXTURE PAINTER' })
  ]),
  toolbar({ items: [fileMenu, editMenu, selectMenu, filterMenu, displayMenu, renderingMenu,
    bakeMenu], className: 'app-header__menu' }),
  element('div', { className: 'app-header__right' }, [samplingButton, mirrorButton, projectTag])
]);

const propertiesBody = element('div', { className: 'tool-properties' });
const propertiesPanel = panel({ title: 'Properties', subtitle: 'Brush', children: [propertiesBody] });
function renderProperties() {
  const tool = TOOL_DEFINITIONS.find((item) => item.id === activeTool);
  propertiesPanel.querySelector('.ui-panel__heading p').textContent = tool.label;
  propertiesBody.replaceChildren(...tool.controls.filter((control) =>
    (!control.when || Object.entries(control.when).every(([key, value]) =>
      toolSettings[activeTool][key] === value)) &&
    (!control.unless || !Object.entries(control.unless).every(([key, value]) =>
      toolSettings[activeTool][key] === value))).map((control) => renderControl({
    ...control,
    value: toolSettings[activeTool][control.key],
    checked: control.key ? toolSettings[activeTool][control.key] : undefined,
    onClick: control.action === 'clearVertexSelection' ? () => {
      if (scene.clearVertexSelection(nodeEditor.getState().targetId))
        setStatus('Vertex selection cleared');
    } : control.action === 'clearSelection' ? () => {
      if (scene.clearSelection()) setStatus('Selection cleared');
      editMenu.refresh();
    } : undefined,
    onChange: (value) => {
      toolSettings[activeTool][control.key] = value;
      scene.setToolSettings(activeTool, toolSettings[activeTool]);
      if (control.key === 'lineStyle' || control.key === 'stroke' ||
          control.key === 'proportionalStroke' ||
          control.type === 'imageImport') renderProperties();
      if (['curveMethod', 'stroke', 'proportionalStroke'].includes(control.key))
        renderToolHint();
      markDirty();
    }
  })));
}
function renderToolHint() {
  const tool = TOOL_DEFINITIONS.find((item) => item.id === activeTool);
  if (!tool) return;
  hint.textContent = `${tool.label}  ·  ${toolHint(tool.id, toolSettings[tool.id])}`;
  hint.title = hint.textContent;
}
function selectTool(tool) {
  if (vertexMode !== VERTEX_TOOLS.has(tool)) return;
  activeTool = tool;
  if (vertexMode) lastVertexTool = tool;
  else lastBitmapTool = tool;
  scene.setTool(tool);
  toolsPanel?.querySelector('.ui-tool-group')?.setActive(tool);
  renderProperties();
  renderToolHint();
  markDirty();
}
function syncToolMode(state) {
  const vertex = Boolean(state.graph?.nodes.find((node) =>
    node.id === state.paintSource && node.type === 'image' && node.vertexColor));
  scene.setVertexSelectionVisible(vertex);
  if (vertexMode === vertex || !toolsPanel) { vertexMode = vertex; return; }
  vertexMode = vertex;
  const available = TOOL_DEFINITIONS.filter((tool) =>
    VERTEX_TOOLS.has(tool.id) === vertex);
  const nextTool = vertex ? lastVertexTool : lastBitmapTool;
  const group = renderControl({ type: 'toolGroup', active: nextTool,
    onChange: selectTool,
    items: available.map(({ id, label, iconUrl }) => ({ value: id, label, iconUrl })) });
  toolsPanel.querySelector('.ui-tool-group').replaceWith(group);
  toolsPanel.querySelector('.ui-panel__heading p').textContent =
    vertex ? 'Paint vertex colors on the model' : 'Paint directly on the model';
  selectTool(nextTool);
}
renderProperties();
renderToolHint();
const sidebar = element('aside', { className: 'sidebar' }, [
  palette.element,
  toolsPanel = renderPanel({ title: 'Tools', subtitle: 'Paint directly on the model', controls: [
    { type: 'toolGroup', active: 'brush', onChange: selectTool,
      items: TOOL_DEFINITIONS.filter(({ id }) => !VERTEX_TOOLS.has(id))
        .map(({ id, label, iconUrl }) => ({ value: id, label, iconUrl })) }
  ] }),
  propertiesPanel
]);
syncToolMode(nodeEditor.getState());

const viewportHeader = element('div', { className: 'viewport-header' }, [
  element('span', { className: 'viewport-header__title', text: 'PERSPECTIVE VIEW' }),
  modeLabel
]);

const workspace = element('div', { className: 'workspace' }, [
  sidebar,
  element('div', { className: 'editor-area' }, [
    element('div', { className: 'viewport-shell' }, [viewportHeader, viewport]),
    nodeEditor.element
  ]),
  layersPanel.element
]);

const footer = element('footer', { className: 'status-bar' }, [
  hint,
  status
]);

function canLeaveProject() {
  return !dirty || window.confirm('This project has unsaved changes. Continue without saving them?');
}

function chooseProjectFile() {
  if (!window.showOpenFilePicker) { projectInput.click(); return; }
  openProjectFromPicker();
}

async function resolveProjectModel(model) {
  if (model.kind === 'starter') return { file: null, handle: null, relinked: false };
  let handle = null;
  try { handle = await getModelHandle(model.referenceId); }
  catch { /* The model can still be located manually. */ }
  if (handle) {
    try {
      const permission = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
      if (permission === 'granted') return { file: await handle.getFile(), handle, relinked: false };
    } catch { /* The saved file may have moved or been deleted. */ }
  }
  const choice = await modelRelink.prompt(model.name, handle);
  if (!choice) throw new DOMException('Project opening cancelled.', 'AbortError');
  return { ...choice, relinked: true };
}

async function openProjectFromPicker() {
  try {
    const [handle] = await window.showOpenFilePicker({
      id: 'texture-painter-project',
      types: [{ description: 'Texture Painter Project', accept: { 'application/json': ['.tp3d'] } }],
      excludeAcceptAllOption: true
    });
    if (handle) await openProject(parseProject(await (await handle.getFile()).text()), handle);
  } catch (error) {
    if (error.name === 'AbortError') return;
    projectHome.setMessage(error.message || 'Could not open project.');
    setStatus(error.message || 'Could not open project.', true);
  }
}

function restoreEditorSettings(saved = {}, view = {}) {
  for (const tool of TOOL_DEFINITIONS) {
    toolSettings[tool.id] = { ...tool.defaults,
      ...(tool.usesColor ? { color: '#000000' } : {}),
      ...(saved.toolSettings?.[tool.id] ?? {}) };
    scene.setToolSettings(tool.id, toolSettings[tool.id]);
  }
  palette.loadState(saved.palette);
  activeTool = TOOL_DEFINITIONS.some((tool) => tool.id === saved.activeTool) ? saved.activeTool : 'brush';
  if (VERTEX_TOOLS.has(activeTool)) lastVertexTool = activeTool;
  else lastBitmapTool = activeTool;
  const restoredState = nodeEditor.getState();
  const restoredVertex = Boolean(restoredState.graph?.nodes.find((node) =>
    node.id === restoredState.paintSource && node.vertexColor));
  if (restoredVertex !== vertexMode) {
    vertexMode = !restoredVertex;
    syncToolMode(restoredState);
  }
  activeTool = restoredVertex ? lastVertexTool : lastBitmapTool;
  scene.setTool(activeTool);
  toolsPanel.querySelector('.ui-tool-group').setActive(activeTool);
  renderProperties();
  renderToolHint();
  const restoredLighting = ['shaded', 'unlit'].includes(view.lighting) ? view.lighting : 'shaded';
  gridVisible = view.grid !== false;
  wireframeVisible = view.wireframe === true;
  antialiasEnabled = view.antialias !== false;
  applyLightingMode(restoredLighting);
  scene.setGridVisible(gridVisible);
  scene.setWireframeVisible(wireframeVisible);
  scene.setAntialiasEnabled(antialiasEnabled);
  scene.setMirrorEnabled(view.mirror === true);
  mirrorButton.setPressed(scene.getMirrorEnabled());
  scene.setSamplingMode(view.sampling === 'uv' ? 'uv' : 'surface');
  updateSamplingButton(scene.getSamplingMode());
  displayMenu.refresh();
  renderingMenu.refresh();
  nodeEditor.restoreProjectState(saved.nodes);
}

function projectDocument(id, name) {
  return { format: 'tp3d', version: PROJECT_VERSION,
    id, name, updatedAt: new Date().toISOString(),
    scene: scene.exportProjectData(),
    editor: { nodes: nodeEditor.getProjectState(), palette: palette.getState(),
      activeTool, toolSettings: structuredClone(toolSettings) } };
}

async function newProject({ name, resolution, model: selectedModel }) {
  if (!canLeaveProject()) return;
  if (!window.showSaveFilePicker)
    throw new Error('Use Chrome or Edge to choose where to save the project.');
  const handle = await window.showSaveFilePicker({
    id: 'texture-painter-project',
    suggestedName: projectFileName(name),
    types: [{ description: 'Texture Painter Project', accept: { 'application/json': ['.tp3d'] } }],
    excludeAcceptAllOption: true
  });
  const previous = projectId ? { scene: scene.exportProjectData(),
    modelFile: scene.getModelFile(), modelHandle: currentModelHandle,
    editor: { nodes: nodeEditor.getProjectState(), palette: palette.getState(),
      activeTool, toolSettings: structuredClone(toolSettings) }, dirty } : null;
  loadingProject = true;
  setStatus(`Creating ${name}…`);
  try {
    setTextureResolution(resolution);
    await scene.importModel(selectedModel.file);
    restoreEditorSettings();
    const id = crypto.randomUUID();
    const project = projectDocument(id, name);
    await writeProjectFile(handle, project);
    projectId = id;
    projectName = name;
    projectHandle = handle;
    currentModelHandle = selectedModel.handle;
    projectTag.textContent = name;
    dirty = false;
    projectHome.hide();
    fileMenu.refresh();
    let modelLinkStored = false;
    if (currentModelHandle) {
      try { await saveModelHandle(project.scene.model.referenceId, currentModelHandle); modelLinkStored = true; }
      catch { /* The model can be located manually when reopening. */ }
    }
    setStatus(`${name} created · ${resolution} × ${resolution}` +
      (modelLinkStored ? '' : ' · locate the model when reopening'), !modelLinkStored);
    try { await saveRecent(project, handle); await refreshRecent(); }
    catch { setStatus(`${name} created · recent list unavailable`); }
  } catch (error) {
    try {
      if (previous) {
        await scene.restoreProjectData(previous.scene, previous.modelFile);
        restoreEditorSettings(previous.editor, previous.scene.view);
        currentModelHandle = previous.modelHandle;
        dirty = previous.dirty;
      } else {
        scene.newProject();
        restoreEditorSettings();
      }
    } catch { /* Keep the setup screen available after a failed import. */ }
    setStatus(error.message || 'Could not create project.', true);
    throw error;
  } finally { loadingProject = false; }
}

async function openProject(project, handle = null) {
  if (!canLeaveProject()) return;
  loadingProject = true;
  projectHome.setMessage('');
  setStatus(`Opening ${project.name}…`);
  let previous = null;
  try {
    const modelReference = await resolveProjectModel(project.scene.model);
    if (projectId) previous = { scene: scene.exportProjectData(),
      modelFile: scene.getModelFile(), modelHandle: currentModelHandle,
      editor: { nodes: nodeEditor.getProjectState(), palette: palette.getState(),
        activeTool, toolSettings: structuredClone(toolSettings) }, dirty };
    await scene.restoreProjectData(project.scene, modelReference.file);
    restoreEditorSettings(project.editor, project.scene.view);
    currentModelHandle = modelReference.handle;
    if (modelReference.handle) {
      try { await saveModelHandle(project.scene.model.referenceId, modelReference.handle); }
      catch { /* Reopening can still use the manual locator. */ }
    }
    if (modelReference.relinked) project.scene.model = scene.getModelSource();
    projectId = project.id;
    projectName = project.name;
    projectHandle = handle;
    projectTag.textContent = projectName;
    dirty = modelReference.relinked;
    projectHome.hide();
    fileMenu.refresh();
    setStatus(`${projectName} opened${modelReference.relinked ? ' · model located; save project' : ''}`);
    try { await saveRecent(project, handle); await refreshRecent(); }
    catch { setStatus(`${projectName} opened · recent list unavailable`); }
  } catch (error) {
    if (error.name === 'AbortError') { setStatus('Project opening cancelled'); return; }
    if (previous) {
      try {
        await scene.restoreProjectData(previous.scene, previous.modelFile);
        restoreEditorSettings(previous.editor, previous.scene.view);
        currentModelHandle = previous.modelHandle;
        dirty = previous.dirty;
      } catch { /* Keep the project chooser open if the previous scene cannot be restored. */ }
    }
    projectHome.show(Boolean(projectId));
    projectHome.setMessage(error.message || 'Could not open project.');
    setStatus(error.message || 'Could not open project.', true);
  } finally { loadingProject = false; }
}

async function saveProject(saveAs = false) {
  if (!projectId || loadingProject) return;
  if (bakeDialog.isBusy()) {
    setStatus('Wait for the bake to finish before saving.', true);
    return;
  }
  if (filterDialog.isOpen()) {
    setStatus('Apply or cancel the filter before saving.', true);
    return;
  }
  let handle = saveAs ? null : projectHandle;
  if (handle) {
    try {
      if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        setStatus('Write access denied. Use File → Save Project As to choose another file.', true);
        return;
      }
    } catch (error) { setStatus(error.message || 'Could not access the project file.', true); return; }
  } else {
    if (!window.showSaveFilePicker) {
      setStatus('Choose a browser that supports saving to a folder, such as Chrome or Edge.', true);
      return;
    }
    try {
      handle = await window.showSaveFilePicker({
        id: 'texture-painter-project',
        suggestedName: projectFileName(projectName),
        types: [{ description: 'Texture Painter Project', accept: { 'application/json': ['.tp3d'] } }],
        excludeAcceptAllOption: true
      });
    } catch (error) {
      if (error.name !== 'AbortError') setStatus(error.message || 'Could not open the save dialog.', true);
      return;
    }
  }
  setStatus(`Saving ${handle.name}…`);
  try {
    const modelSource = scene.getModelSource();
    let modelLinkStored = modelSource.kind === 'starter';
    if (modelSource.kind !== 'starter' && currentModelHandle) {
      try {
        await saveModelHandle(modelSource.referenceId, currentModelHandle);
        modelLinkStored = true;
      } catch { /* The project file can still be saved and relinked later. */ }
    }
    const project = projectDocument(projectId, projectName);
    await writeProjectFile(handle, project);
    projectHandle = handle;
    projectTag.textContent = projectName;
    dirty = false;
    setStatus(`${handle.name} saved${modelLinkStored ? '' : ' · locate the model when reopening'}`,
      !modelLinkStored);
    try { await saveRecent(project, handle); await refreshRecent(); }
    catch { setStatus(`${handle.name} saved · recent list unavailable`); }
  } catch (error) { setStatus(error.message || 'Could not save project.', true); }
}

async function refreshRecent() {
  try { projectHome.setRecents(await listRecent()); }
  catch { projectHome.setMessage('Recent projects are unavailable in this browser. You can still open .tp3d files.'); }
}

projectInput.addEventListener('change', async () => {
  const file = projectInput.files?.[0];
  projectInput.value = '';
  if (!file) return;
  try { await openProject(parseProject(await file.text())); }
  catch (error) {
    projectHome.setMessage(error.message || 'Could not read project.');
    setStatus(error.message || 'Could not read project.', true);
  }
});

async function openRecent(record) {
  try {
    if (record.handle) {
      const allowed = !record.handle.requestPermission ||
        await record.handle.requestPermission({ mode: 'read' }) === 'granted';
      if (allowed) {
        const file = await record.handle.getFile();
        await openProject(parseProject(await file.text()), record.handle);
        return;
      }
    }
    await openProject(parseProject(record.document));
  } catch (error) {
    projectHome.setMessage(error.message || 'Could not read recent project.');
  }
}

const projectHome = createProjectHome({ onNew: newProject, onOpen: chooseProjectFile,
  onRecent: openRecent,
  onRemoveRecent: async (id) => {
    try { await removeRecent(id); await refreshRecent(); }
    catch { projectHome.setMessage('Could not remove this recent project.'); }
  } });

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

app.append(header, workspace, footer, fileInput, projectInput, texturePreview.element,
  projectHome.element, modelRelink.element, selectionSizeDialog.element, filterDialog.element,
  bakeDialog.element,
  textureExportDialog.element);
refreshRecent();
