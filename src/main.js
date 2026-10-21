import { createScene } from './editor/scene.js';
import { dropdown, element, notice, renderPanel, toolbar } from './ui/index.js';
import './style.css';

const app = document.querySelector('#app');
const fileInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
const viewport = element('main', { className: 'viewport', attributes: { 'aria-label': '3D viewport' } });
const status = element('span', { className: 'status__message', text: 'Ready' });
const hint = notice({ text: 'Left drag: paint · Alt + left drag: orbit · Right drag: pan · Wheel: zoom' });

const scene = createScene(viewport);
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
  toolbar({ items: [fileMenu, displayMenu], className: 'app-header__menu' }),
  element('span', { className: 'app-header__tag', text: 'EDITOR  /  01' })
]);

const sidebar = element('aside', { className: 'sidebar' }, [
  renderPanel({ title: 'Tools', subtitle: 'Paint directly on the model', controls: [
    { type: 'toolGroup', active: 'brush', onChange: scene.setTool, items: [
      { value: 'brush', label: 'Brush', icon: '●' },
      { value: 'eraser', label: 'Eraser', icon: '◌' }
    ] }
  ] })
]);

const viewportHeader = element('div', { className: 'viewport-header' }, [
  element('span', { className: 'viewport-header__title', text: 'PERSPECTIVE VIEW' }),
  modeLabel
]);

const workspace = element('div', { className: 'workspace' }, [
  sidebar,
  element('div', { className: 'viewport-shell' }, [viewportHeader, viewport, hint])
]);

const footer = element('footer', { className: 'status-bar' }, [
  element('span', { text: 'TEXTURE PAINTER  /  WORKSPACE' }),
  status,
  element('span', { text: 'THREE.JS  ·  LOCAL' })
]);

app.append(header, workspace, footer, fileInput);
