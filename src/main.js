import { createScene } from './editor/scene.js';
import { dropdown, element, notice, registerControl, renderPanel, toolbar } from './ui/index.js';
import './style.css';

const app = document.querySelector('#app');
const fileInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
const viewport = element('main', { className: 'viewport', attributes: { 'aria-label': '3D viewport' } });
const status = element('span', { className: 'status__message', text: 'Ready' });
const modelName = element('strong', { className: 'model-name', text: 'Untitled scene' });
const hint = notice({ text: 'Import a GLB model to begin. Use the mouse to orbit, pan and zoom.' });

const scene = createScene(viewport);
function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(`Loading ${file.name}…`);
  try {
    await scene.importGlb(file);
    modelName.textContent = file.name;
    hint.remove();
    setStatus(`${file.name} imported`);
  } catch (error) {
    setStatus(error.message || 'Import failed', true);
  } finally {
    fileInput.value = '';
  }
});

const menu = dropdown({ label: 'File', items: [
  { label: 'Import Model', icon: '↥', onSelect: () => fileInput.click() }
] });

registerControl('modelCard', ({ name }) => element('div', { className: 'scene-card' }, [
  element('span', { className: 'scene-card__icon', text: '◈', attributes: { 'aria-hidden': 'true' } }),
  element('div', { className: 'scene-card__text' }, [name, element('small', { text: '3D model' })])
]));

const header = element('header', { className: 'app-header' }, [
  element('div', { className: 'brand' }, [
    element('span', { className: 'brand__mark', text: '◈', attributes: { 'aria-hidden': 'true' } }),
    element('span', { className: 'brand__name', text: 'TEXTURE PAINTER' })
  ]),
  toolbar({ items: [menu], className: 'app-header__menu' }),
  element('span', { className: 'app-header__tag', text: 'EDITOR  /  01' })
]);

const sidebar = element('aside', { className: 'sidebar' }, [
  renderPanel({ title: 'Scene', subtitle: 'Current workspace', controls: [
    { type: 'modelCard', name: modelName },
    { type: 'button', label: 'Import Model', icon: '↥', variant: 'primary', onClick: () => fileInput.click() }
  ] }),
  renderPanel({ title: 'Viewport', subtitle: 'Display settings', controls: [
    { type: 'checkbox', label: 'Show grid', checked: true, onChange: scene.setGridVisible },
    { type: 'slider', label: 'Exposure', min: 0.2, max: 2.5, step: 0.05, value: 1.25, onChange: scene.setExposure },
    { type: 'button', label: 'Frame model', onClick: scene.frame }
  ] })
]);

const viewportHeader = element('div', { className: 'viewport-header' }, [
  element('span', { className: 'viewport-header__title', text: 'PERSPECTIVE VIEW' }),
  element('span', { className: 'viewport-header__mode', text: '●  SOLID' })
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
