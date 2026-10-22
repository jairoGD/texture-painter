import { createScene } from './editor/scene.js';
import { setTextureResolution } from './editor/texture-resolution.js';
import { listRecent, parseProject, PROJECT_VERSION, projectFileName,
  getModelHandle, removeRecent, saveModelHandle, saveRecent, writeProjectFile } from './editor/project-file.js';
import { TOOL_DEFINITIONS } from './editor/tools.js';
import { colorPalette } from './ui/color-palette.js';
import { createNodeEditor } from './ui/node-editor.js';
import { createProjectHome } from './ui/project-home.js';
import { createLayersPanel } from './ui/layers-panel.js';
import { createTexturePreview } from './ui/texture-preview.js';
import { createModelRelinkDialog, GLB_PICKER } from './ui/model-relink.js';
import { createSelectionSizeDialog } from './ui/selection-size-dialog.js';
import { createFilterDialog } from './ui/filter-dialog.js';
import { FILTER_CATEGORIES } from './editor/filter-definitions.js';
import { dropdown, element, notice, panel, renderControl, renderPanel, toggleButton, toolbar } from './ui/index.js';
import mirrorIcon from './ui/icons/mirror.svg';
import samplingIcon from './ui/icons/sampling.svg';
import './style.css';

const app = document.querySelector('#app');
const fileInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
const projectInput = element('input', { attributes: { type: 'file', accept: '.tp3d,application/json', hidden: '' } });
const viewport = element('main', { className: 'viewport', attributes: { 'aria-label': '3D viewport' } });
const status = element('span', { className: 'status__message', text: 'Ready' });
const hint = notice({ text: 'Left drag: paint · Alt + left drag or middle drag: orbit · Space + left drag: pan · Wheel: zoom' });

const toolSettings = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.id,
  { ...tool.defaults, ...(tool.usesColor ? { color: '#000000' } : {}) }]));
let activeTool = 'brush';
let nodeEditor;
let layersPanel;
let texturePreview;
let projectId = null;
let projectName = '';
let projectHandle = null;
let currentModelHandle = null;
let dirty = false;
let loadingProject = false;
function markDirty() { if (projectId && !loadingProject) dirty = true; }
const scene = createScene(viewport, {
  onGraphTargetsChanged: (targets) => nodeEditor?.setTargets(targets),
  onSelectionChanged: (message) => { setStatus(message); editMenu.refresh(); selectMenu.refresh(); },
  onContentChanged: () => { layersPanel?.refreshThumbnails(); markDirty(); }, onColorPicked: (color) => {
  palette.setColor(color);
  setStatus(`Sampled ${color.toUpperCase()}`);
} });
nodeEditor = createNodeEditor({ targets: scene.getGraphTargets(),
  onChange: (id, graph) => { scene.setGraph(id, graph); markDirty(); },
  onCreateImage: (id, nodeId) => scene.createImage(id, nodeId),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onPaintSourceChange: (id, nodeId) => { const changed = scene.setPaintSource(id, nodeId); if (changed) markDirty(); return changed; },
  onStateChange: (state) => {
    scene.setPaintTarget(state.targetId);
    layersPanel?.setState(state);
    texturePreview?.setTarget(state.targetId,
      state.targets.find((target) => target.id === state.targetId)?.label);
  },
  onError: (message) => setStatus(message, true)
});
layersPanel = createLayersPanel({ nodeEditor,
  onCreateImage: (id, nodeId) => scene.createImage(id, nodeId),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onMergeLayer: (id, layerId, graph) => scene.mergeLayerDown(id, layerId, graph),
  getImageCanvas: (id, key) => scene.getLayerImage(id, key),
  onError: (message) => setStatus(message, true)
});
texturePreview = createTexturePreview({ getTexture: (id) => scene.getTexturePreview(id),
  onClose: () => displayMenu.refresh() });
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
let antialiasEnabled = true;
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

async function importModelFile(file, handle = null) {
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    const { paintableMeshes } = await scene.importGlb(file);
    currentModelHandle = handle;
    let linkStored = false;
    if (handle) {
      try {
        await saveModelHandle(scene.getModelSource().referenceId, handle);
        linkStored = true;
      } catch { /* The model can still be located manually when reopening. */ }
    }
    markDirty();
    hint.remove();
    setStatus(`${file.name} imported · ${paintableMeshes} paintable mesh${paintableMeshes === 1 ? '' : 'es'}` +
      (linkStored ? '' : ' · locate the GLB when reopening'), !linkStored);
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
    const [handle] = await window.showOpenFilePicker(GLB_PICKER);
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
  { label: 'Import Model', onSelect: chooseModelFile }
] });

function undo() {
  if (scene.undo()) { setStatus('Undid action'); layersPanel.refreshThumbnails(); markDirty(); }
  editMenu.refresh();
  selectMenu.refresh();
}

function redo() {
  if (scene.redo()) { setStatus('Redid action'); layersPanel.refreshThumbnails(); markDirty(); }
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

const selectMenu = dropdown({ label: 'Select', items: [
  { label: 'Select more', getDisabled: () => !scene.canResizeSelection(),
    onSelect: () => selectionSizeDialog.open('expand') },
  { label: 'Select less', getDisabled: () => !scene.canResizeSelection(),
    onSelect: () => selectionSizeDialog.open('contract') },
  { label: 'Invert Selection', getDisabled: () => !scene.canInvertSelection(),
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

const selectionSizeDialog = createSelectionSizeDialog({ onApply: (mode, pixels) => {
  if (scene.resizeSelection(pixels, mode === 'expand'))
    setStatus(mode === 'expand' ? `Selection expanded by ${pixels} px` :
      `Selection contracted by ${pixels} px`);
  editMenu.refresh();
  selectMenu.refresh();
} });

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
      !event.target.closest?.('input, textarea, select, [contenteditable], .node-editor')) {
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
const displayMenu = dropdown({ label: 'Display', items: [
  { type: 'checkbox', label: 'Show grid', getChecked: () => gridVisible, keepOpen: true, onSelect: () => {
    gridVisible = !gridVisible;
    scene.setGridVisible(gridVisible);
    markDirty();
  } },
  { type: 'checkbox', label: '2D Texture', getChecked: () => texturePreview.isVisible(),
    keepOpen: true, onSelect: () => texturePreview.setVisible(!texturePreview.isVisible()) }
] });
const renderingMenu = dropdown({ label: 'Rendering', items: [
  { type: 'radio', label: 'Shaded', getChecked: () => lightingMode === 'shaded', onSelect: () => {
    lightingMode = 'shaded';
    scene.setLightingMode(lightingMode);
    markDirty();
    modeLabel.textContent = '●  SHADED';
  } },
  { type: 'radio', label: 'Unlit', getChecked: () => lightingMode === 'unlit', onSelect: () => {
    lightingMode = 'unlit';
    scene.setLightingMode(lightingMode);
    markDirty();
    modeLabel.textContent = '●  UNLIT';
  } },
  { type: 'separator' },
  { type: 'checkbox', label: 'Antialiasing', getChecked: () => antialiasEnabled,
    keepOpen: true, onSelect: () => {
      antialiasEnabled = !antialiasEnabled;
      scene.setAntialiasEnabled(antialiasEnabled);
      markDirty();
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
  toolbar({ items: [fileMenu, editMenu, selectMenu, filterMenu, displayMenu, renderingMenu], className: 'app-header__menu' }),
  element('div', { className: 'app-header__right' }, [samplingButton, mirrorButton, projectTag])
]);

const propertiesBody = element('div', { className: 'tool-properties' });
const propertiesPanel = panel({ title: 'Properties', subtitle: 'Brush', children: [propertiesBody] });
function renderProperties() {
  const tool = TOOL_DEFINITIONS.find((item) => item.id === activeTool);
  propertiesPanel.querySelector('.ui-panel__heading p').textContent = tool.label;
  propertiesBody.replaceChildren(...tool.controls.map((control) => renderControl({
    ...control,
    value: toolSettings[activeTool][control.key],
    checked: control.key ? toolSettings[activeTool][control.key] : undefined,
    onClick: control.action === 'clearSelection' ? () => {
      if (scene.clearSelection()) setStatus('Selection cleared');
      editMenu.refresh();
    } : undefined,
    onChange: (value) => {
      toolSettings[activeTool][control.key] = value;
      scene.setToolSettings(activeTool, toolSettings[activeTool]);
      markDirty();
    }
  })));
}
function selectTool(tool) {
  activeTool = tool;
  scene.setTool(tool);
  toolsPanel?.querySelector('.ui-tool-group')?.setActive(tool);
  renderProperties();
  markDirty();
}
renderProperties();
let toolsPanel = null;
const sidebar = element('aside', { className: 'sidebar' }, [
  palette.element,
  toolsPanel = renderPanel({ title: 'Tools', subtitle: 'Paint directly on the model', controls: [
    { type: 'toolGroup', active: 'brush', onChange: selectTool,
      items: TOOL_DEFINITIONS.map(({ id, label, iconUrl }) => ({ value: id, label, iconUrl })) }
  ] }),
  propertiesPanel
]);

const viewportHeader = element('div', { className: 'viewport-header' }, [
  element('span', { className: 'viewport-header__title', text: 'PERSPECTIVE VIEW' }),
  modeLabel
]);

const workspace = element('div', { className: 'workspace' }, [
  sidebar,
  element('div', { className: 'editor-area' }, [
    element('div', { className: 'viewport-shell' }, [viewportHeader, viewport, hint]),
    nodeEditor.element
  ]),
  layersPanel.element
]);

const footer = element('footer', { className: 'status-bar' }, [
  element('span', { text: 'TEXTURE PAINTER  /  WORKSPACE' }),
  status,
  element('span', { text: 'THREE.JS  ·  LOCAL' })
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
  scene.setTool(activeTool);
  toolsPanel.querySelector('.ui-tool-group').setActive(activeTool);
  renderProperties();
  lightingMode = ['shaded', 'unlit'].includes(view.lighting) ? view.lighting : 'shaded';
  gridVisible = view.grid !== false;
  antialiasEnabled = view.antialias !== false;
  scene.setLightingMode(lightingMode);
  scene.setGridVisible(gridVisible);
  scene.setAntialiasEnabled(antialiasEnabled);
  scene.setMirrorEnabled(view.mirror === true);
  mirrorButton.setPressed(scene.getMirrorEnabled());
  scene.setSamplingMode(view.sampling === 'uv' ? 'uv' : 'surface');
  updateSamplingButton(scene.getSamplingMode());
  modeLabel.textContent = lightingMode === 'unlit' ? '●  UNLIT' : '●  SHADED';
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
    await scene.importGlb(selectedModel.file);
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
    hint.remove();
    projectHome.hide();
    fileMenu.refresh();
    let modelLinkStored = false;
    if (currentModelHandle) {
      try { await saveModelHandle(project.scene.model.referenceId, currentModelHandle); modelLinkStored = true; }
      catch { /* The GLB can be located manually when reopening. */ }
    }
    setStatus(`${name} created · ${resolution} × ${resolution}` +
      (modelLinkStored ? '' : ' · locate the GLB when reopening'), !modelLinkStored);
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
    let modelLinkStored = modelSource.kind !== 'glb';
    if (modelSource.kind === 'glb' && currentModelHandle) {
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
    setStatus(`${handle.name} saved${modelLinkStored ? '' : ' · locate the GLB when reopening'}`,
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
  projectHome.element, modelRelink.element, selectionSizeDialog.element, filterDialog.element);
refreshRecent();
