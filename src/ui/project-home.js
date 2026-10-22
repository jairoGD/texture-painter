import { TEXTURE_RESOLUTIONS } from '../editor/texture-resolution.js';
import { GLB_PICKER } from './model-relink.js';
import { button, element } from './index.js';
import './project-home.css';

export function createProjectHome({ onNew, onOpen, onRecent, onRemoveRecent }) {
  const recentList = element('div', { className: 'project-home__recent-list' });
  const message = element('p', { className: 'project-home__message', attributes: { role: 'status' } });
  const close = button({ label: 'Back to editor', variant: 'ghost', onClick: hide });
  close.classList.add('project-home__close');
  const nameInput = element('input', { className: 'project-home__input',
    attributes: { type: 'text', value: 'Untitled Project', maxlength: '100', 'aria-label': 'Project name' } });
  const resolutionInput = element('select', { className: 'project-home__input',
    attributes: { 'aria-label': 'Texture resolution' } },
  TEXTURE_RESOLUTIONS.map((size) => element('option', { text: `${size} × ${size}`,
    attributes: { value: size, selected: size === 1024 ? '' : undefined } })));
  const modelInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
  const modelName = element('span', { className: 'project-home__model-name', text: 'No model selected' });
  let model = null;
  const chooseModel = button({ label: 'Choose GLB', onClick: selectModel });
  const create = button({ label: 'Create Project', variant: 'primary', onClick: createProject });
  const back = button({ label: 'Back', variant: 'ghost', onClick: showHome });
  const home = element('div', { className: 'project-home__home' }, [
    element('div', { className: 'project-home__choices' }, [
      button({ label: 'New Project', variant: 'primary', onClick: showNew }),
      button({ label: 'Open Project', onClick: onOpen })
    ]),
    element('div', { className: 'project-home__recent-head' }, [
      element('h2', { text: 'Recent Projects' })
    ]),
    recentList
  ]);
  const setup = element('div', { className: 'project-home__setup', attributes: { hidden: '' } }, [
    element('h2', { text: 'New Project' }),
    element('label', { className: 'project-home__field' }, [
      element('span', { text: 'Project name' }), nameInput
    ]),
    element('label', { className: 'project-home__field' }, [
      element('span', { text: 'Texture resolution' }), resolutionInput
    ]),
    element('div', { className: 'project-home__field' }, [
      element('span', { text: 'Model' }),
      element('div', { className: 'project-home__model-row' }, [chooseModel, modelName])
    ]),
    element('div', { className: 'project-home__setup-actions' }, [back, create]),
    modelInput
  ]);
  const root = element('div', { className: 'project-home' }, [
    element('div', { className: 'project-home__card' }, [
      element('div', { className: 'project-home__top' }, [
        element('h1', { text: 'TEXTURE PAINTER' }), close
      ]), home, setup, message
    ])
  ]);

  function setModel(file, handle = null) {
    if (!file || !/\.glb$/i.test(file.name)) {
      setMessage('Choose a .glb model.');
      return;
    }
    model = { file, handle };
    modelName.textContent = file.name;
    modelName.title = file.name;
    setMessage('');
  }
  async function selectModel() {
    if (!window.showOpenFilePicker) { modelInput.click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker(GLB_PICKER);
      if (handle) setModel(await handle.getFile(), handle);
    } catch (error) {
      if (error.name !== 'AbortError') setMessage(error.message || 'Could not open model.');
    }
  }
  modelInput.addEventListener('change', () => {
    setModel(modelInput.files?.[0]);
    modelInput.value = '';
  });
  async function createProject() {
    const name = nameInput.value.trim();
    if (!name) { setMessage('Enter a project name.'); nameInput.focus(); return; }
    if (!model) { setMessage('Choose a GLB model.'); chooseModel.focus(); return; }
    create.disabled = true;
    setMessage('');
    try { await onNew({ name, resolution: Number(resolutionInput.value), model }); }
    catch (error) { if (error.name !== 'AbortError') setMessage(error.message || 'Could not create project.'); }
    finally { create.disabled = false; }
  }
  function setRecents(records) {
    if (!records.length) {
      recentList.replaceChildren(element('p', { className: 'project-home__empty',
        text: 'No recent projects' }));
      return;
    }
    recentList.replaceChildren(...records.map((record) => {
      const date = new Date(record.updatedAt);
      const control = button({ label: record.name, variant: 'ghost', onClick: () => onRecent(record) });
      control.classList.add('project-home__recent');
      control.append(element('span', { className: 'project-home__recent-date',
        text: Number.isNaN(date.getTime()) ? '' : date.toLocaleString() }));
      const remove = button({ label: `Remove ${record.name} from recent projects`, icon: '×',
        variant: 'ghost', iconOnly: true, onClick: () => onRemoveRecent(record.id) });
      return element('div', { className: 'project-home__recent-row' }, [control, remove]);
    }));
  }
  function showHome() { setup.hidden = true; home.hidden = false; setMessage(''); }
  function showNew() {
    home.hidden = true;
    setup.hidden = false;
    nameInput.value = 'Untitled Project';
    resolutionInput.value = '1024';
    model = null;
    modelName.textContent = 'No model selected';
    setMessage('');
    nameInput.focus();
  }
  function show(canClose = false) {
    close.hidden = !canClose;
    root.hidden = false;
    showHome();
  }
  function hide() { root.hidden = true; }
  function setMessage(text) { message.textContent = text; }
  show(false);
  return { element: root, show, showNew, hide, setRecents, setMessage };
}
