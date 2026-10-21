import { createScene } from './editor/scene.js';
import { listRecent, parseProject, PROJECT_VERSION, projectFileName,
  removeRecent, saveRecent, writeProjectFile } from './editor/project-file.js';
import { TOOL_DEFINITIONS } from './editor/tools.js';
import { colorPalette } from './ui/color-palette.js';
import { createNodeEditor } from './ui/node-editor.js';
import { createProjectHome } from './ui/project-home.js';
import { createLayersPanel } from './ui/layers-panel.js';
import { dropdown, element, notice, panel, renderControl, renderPanel, toolbar } from './ui/index.js';
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
let projectId = null;
let projectName = '';
let projectHandle = null;
let dirty = false;
let loadingProject = false;
function markDirty() { if (projectId && !loadingProject) dirty = true; }
const scene = createScene(viewport, {
  onGraphTargetsChanged: (targets) => nodeEditor?.setTargets(targets),
  onPaintTargetChanged: (id) => nodeEditor?.selectTarget(id),
  onSelectionChanged: setStatus, onContentChanged: markDirty, onColorPicked: (color) => {
  palette.setColor(color);
  setStatus(`Sampled ${color.toUpperCase()}`);
} });
nodeEditor = createNodeEditor({ targets: scene.getGraphTargets(),
  onChange: (id, graph) => { scene.setGraph(id, graph); markDirty(); },
  onCreateImage: (id, nodeId) => scene.createImage(id, nodeId),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onPaintSourceChange: (id, nodeId) => { const changed = scene.setPaintSource(id, nodeId); if (changed) markDirty(); return changed; },
  onStateChange: (state) => layersPanel?.setState(state),
  onError: (message) => setStatus(message, true)
});
layersPanel = createLayersPanel({ nodeEditor,
  onCreateImage: (id, nodeId) => scene.createImage(id, nodeId),
  onImportImage: (id, nodeId, file) => scene.importImage(id, nodeId, file),
  onMergeLayer: (id, layerId, graph) => scene.mergeLayerDown(id, layerId, graph),
  onError: (message) => setStatus(message, true)
});
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
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    const { paintableMeshes } = await scene.importGlb(file);
    markDirty();
    hint.remove();
    setStatus(`${file.name} imported · ${paintableMeshes} paintable mesh${paintableMeshes === 1 ? '' : 'es'}`);
  } catch (error) {
    setStatus(error.message || 'Import failed', true);
  } finally {
    fileInput.value = '';
  }
});

const fileMenu = dropdown({ label: 'File', items: [
  { label: 'New Project', onSelect: () => projectHome.show(Boolean(projectId)) },
  { label: 'Open Project', onSelect: chooseProjectFile },
  { label: 'Save Project', shortcut: 'Ctrl+S', getDisabled: () => !projectId, onSelect: saveProject },
  { label: 'Save Project As', getDisabled: () => !projectId, onSelect: () => saveProject(true) },
  { type: 'separator' },
  { label: 'Import Model', onSelect: () => fileInput.click() }
] });

function undo() {
  if (scene.undo()) { setStatus('Undid action'); markDirty(); }
  editMenu.refresh();
}

function redo() {
  if (scene.redo()) { setStatus('Redid action'); markDirty(); }
  editMenu.refresh();
}

const editMenu = dropdown({ label: 'Edit', items: [
  { label: 'Undo', shortcut: 'Ctrl+Z', getDisabled: () => !scene.canUndo(), onSelect: undo },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', getDisabled: () => !scene.canRedo(), onSelect: redo }
] });

document.addEventListener('keydown', (event) => {
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
  { type: 'checkbox', label: 'Show grid', getChecked: () => gridVisible, keepOpen: true, onSelect: () => {
    gridVisible = !gridVisible;
    scene.setGridVisible(gridVisible);
    markDirty();
  } }
] });

const projectTag = element('span', { className: 'app-header__tag', text: 'NO PROJECT' });
const header = element('header', { className: 'app-header' }, [
  element('div', { className: 'brand' }, [
    element('span', { className: 'brand__mark', text: '◈', attributes: { 'aria-hidden': 'true' } }),
    element('span', { className: 'brand__name', text: 'TEXTURE PAINTER' })
  ]),
  toolbar({ items: [fileMenu, editMenu, displayMenu], className: 'app-header__menu' }),
  projectTag
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
  renderProperties();
  markDirty();
}
renderProperties();
const sidebar = element('aside', { className: 'sidebar' }, [
  palette.element,
  renderPanel({ title: 'Tools', subtitle: 'Paint directly on the model', controls: [
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
  renderProperties();
  lightingMode = ['shaded', 'unlit'].includes(view.lighting) ? view.lighting : 'shaded';
  gridVisible = view.grid !== false;
  scene.setLightingMode(lightingMode);
  scene.setGridVisible(gridVisible);
  modeLabel.textContent = lightingMode === 'unlit' ? '●  UNLIT' : '●  SHADED';
  displayMenu.refresh();
  nodeEditor.restoreProjectState(saved.nodes);
}

function newProject(name) {
  if (!canLeaveProject()) return;
  loadingProject = true;
  try {
    scene.newProject();
    restoreEditorSettings();
    projectId = crypto.randomUUID();
    projectName = name;
    projectHandle = null;
    projectTag.textContent = projectName;
    dirty = true;
    projectHome.hide();
    fileMenu.refresh();
    setStatus(`${projectName} created · save to create a .tp3d file`);
  } catch (error) {
    projectHome.setMessage(error.message || 'Could not create project.');
  } finally { loadingProject = false; }
}

async function openProject(project, handle = null) {
  if (!canLeaveProject()) return;
  loadingProject = true;
  projectHome.setMessage('');
  setStatus(`Opening ${project.name}…`);
  let previous = null;
  try {
    if (projectId) previous = { scene: scene.exportProjectData(),
      editor: { nodes: nodeEditor.getProjectState(), palette: palette.getState(),
        activeTool, toolSettings: structuredClone(toolSettings) }, dirty };
    await scene.restoreProjectData(project.scene);
    restoreEditorSettings(project.editor, project.scene.view);
    projectId = project.id;
    projectName = project.name;
    projectHandle = handle;
    projectTag.textContent = projectName;
    dirty = false;
    projectHome.hide();
    fileMenu.refresh();
    setStatus(`${projectName} opened`);
    try { await saveRecent(project, handle); await refreshRecent(); }
    catch { setStatus(`${projectName} opened · recent list unavailable`); }
  } catch (error) {
    if (previous) {
      try {
        await scene.restoreProjectData(previous.scene);
        restoreEditorSettings(previous.editor, previous.scene.view);
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
    const savedName = handle.name.replace(/\.tp3d$/i, '') || projectName;
    const project = { format: 'tp3d', version: PROJECT_VERSION,
      id: projectId, name: savedName, updatedAt: new Date().toISOString(),
      scene: scene.exportProjectData(),
      editor: { nodes: nodeEditor.getProjectState(), palette: palette.getState(),
        activeTool, toolSettings: structuredClone(toolSettings) } };
    await writeProjectFile(handle, project);
    projectHandle = handle;
    projectName = savedName;
    projectTag.textContent = projectName;
    dirty = false;
    setStatus(`${handle.name} saved`);
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

app.append(header, workspace, footer, fileInput, projectInput, projectHome.element);
refreshRecent();
