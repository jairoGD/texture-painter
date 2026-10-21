import { createScene } from './editor/scene.js';
import { TOOL_DEFINITIONS } from './editor/tools.js';
import { colorPalette } from './ui/color-palette.js';
import { createNodeEditor } from './ui/node-editor.js';
import { dropdown, element, notice, panel, renderControl, renderPanel, toolbar } from './ui/index.js';
import './style.css';

const app = document.querySelector('#app');
const fileInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
const viewport = element('main', { className: 'viewport', attributes: { 'aria-label': '3D viewport' } });
const status = element('span', { className: 'status__message', text: 'Ready' });
const hint = notice({ text: 'Left drag: paint · Alt + left drag or middle drag: orbit · Space + left drag: pan · Wheel: zoom' });

const toolSettings = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.id,
  { ...tool.defaults, ...(tool.usesColor ? { color: '#000000' } : {}) }]));
let activeTool = 'brush';
let nodeEditor;
const scene = createScene(viewport, {
  onGraphTargetsChanged: (targets) => nodeEditor?.setTargets(targets),
  onPaintTargetChanged: (id) => nodeEditor?.selectTarget(id),
  onSelectionChanged: setStatus, onColorPicked: (color) => {
  palette.setColor(color);
  setStatus(`Sampled ${color.toUpperCase()}`);
} });
nodeEditor = createNodeEditor({ targets: scene.getGraphTargets(), onChange: (id, graph) => scene.setGraph(id, graph) });
for (const tool of TOOL_DEFINITIONS) scene.setToolSettings(tool.id, toolSettings[tool.id]);
const palette = colorPalette({ color: '#000000', onChange: (color) => {
  for (const tool of TOOL_DEFINITIONS.filter((item) => item.usesColor)) {
    toolSettings[tool.id].color = color;
    scene.setToolSettings(tool.id, toolSettings[tool.id]);
  }
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
    hint.remove();
    setStatus(`${file.name} imported · ${paintableMeshes} paintable mesh${paintableMeshes === 1 ? '' : 'es'}`);
  } catch (error) {
    setStatus(error.message || 'Import failed', true);
  } finally {
    fileInput.value = '';
  }
});

const fileMenu = dropdown({ label: 'File', items: [
  { label: 'Import Model', icon: '↥', onSelect: () => fileInput.click() }
] });

function undo() {
  if (scene.undo()) setStatus('Undid action');
  editMenu.refresh();
}

function redo() {
  if (scene.redo()) setStatus('Redid action');
  editMenu.refresh();
}

const editMenu = dropdown({ label: 'Edit', items: [
  { label: 'Undo', shortcut: 'Ctrl+Z', getDisabled: () => !scene.canUndo(), onSelect: undo },
  { label: 'Redo', shortcut: 'Ctrl+Shift+Z', getDisabled: () => !scene.canRedo(), onSelect: redo }
] });

document.addEventListener('keydown', (event) => {
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
    modeLabel.textContent = '●  SHADED';
  } },
  { type: 'radio', label: 'Unlit', getChecked: () => lightingMode === 'unlit', onSelect: () => {
    lightingMode = 'unlit';
    scene.setLightingMode(lightingMode);
    modeLabel.textContent = '●  UNLIT';
  } },
  { type: 'separator' },
  { type: 'checkbox', label: 'Show grid', getChecked: () => gridVisible, keepOpen: true, onSelect: () => {
    gridVisible = !gridVisible;
    scene.setGridVisible(gridVisible);
  } }
] });

const header = element('header', { className: 'app-header' }, [
  element('div', { className: 'brand' }, [
    element('span', { className: 'brand__mark', text: '◈', attributes: { 'aria-hidden': 'true' } }),
    element('span', { className: 'brand__name', text: 'TEXTURE PAINTER' })
  ]),
  toolbar({ items: [fileMenu, editMenu, displayMenu], className: 'app-header__menu' }),
  element('span', { className: 'app-header__tag', text: 'EDITOR  /  01' })
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
    }
  })));
}
function selectTool(tool) {
  activeTool = tool;
  scene.setTool(tool);
  renderProperties();
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
  ])
]);

const footer = element('footer', { className: 'status-bar' }, [
  element('span', { text: 'TEXTURE PAINTER  /  WORKSPACE' }),
  status,
  element('span', { text: 'THREE.JS  ·  LOCAL' })
]);

app.append(header, workspace, footer, fileInput);
