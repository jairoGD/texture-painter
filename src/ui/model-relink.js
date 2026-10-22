import { button, element } from './index.js';
import './model-relink.css';

export const GLB_PICKER = { id: 'texture-painter-model',
  types: [{ description: 'GLB model', accept: { 'model/gltf-binary': ['.glb'] } }],
  excludeAcceptAllOption: true };

export function createModelRelinkDialog() {
  const name = element('strong', { className: 'model-relink__name' });
  const message = element('p', { className: 'model-relink__message' });
  const fileInput = element('input', { attributes: { type: 'file', accept: '.glb,model/gltf-binary', hidden: '' } });
  const retry = button({ label: 'Try saved location', variant: 'ghost' });
  const browse = button({ label: 'Locate GLB', variant: 'primary' });
  const cancel = button({ label: 'Cancel', variant: 'ghost' });
  const root = element('div', { className: 'model-relink', attributes: { hidden: '' } }, [
    element('section', { className: 'model-relink__card', attributes: {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'model-relink-title'
    } }, [
      element('h2', { text: 'Model not found', attributes: { id: 'model-relink-title' } }),
      name, message,
      element('div', { className: 'model-relink__actions' }, [retry, cancel, browse]), fileInput
    ])
  ]);
  let resolvePending = null;
  let savedHandle = null;

  function finish(result) {
    root.hidden = true;
    fileInput.value = '';
    const resolve = resolvePending;
    resolvePending = null;
    savedHandle = null;
    resolve?.(result);
  }
  function accept(file, handle = null) {
    if (!file || !/\.glb$/i.test(file.name)) {
      message.textContent = 'Choose a .glb file.';
      return;
    }
    finish({ file, handle });
  }
  retry.addEventListener('click', async () => {
    if (!savedHandle) return;
    try {
      const permission = savedHandle.queryPermission ?
        await savedHandle.queryPermission({ mode: 'read' }) : 'granted';
      if (permission !== 'granted' && await savedHandle.requestPermission({ mode: 'read' }) !== 'granted')
        throw new Error('Access to the saved file was not granted.');
      accept(await savedHandle.getFile(), savedHandle);
    } catch {
      message.textContent = 'The saved file is unavailable. Locate the GLB manually.';
    }
  });
  browse.addEventListener('click', async () => {
    if (!window.showOpenFilePicker) { fileInput.click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker(GLB_PICKER);
      if (handle) accept(await handle.getFile(), handle);
    } catch (error) {
      if (error.name !== 'AbortError') message.textContent = error.message || 'Could not open the GLB.';
    }
  });
  fileInput.addEventListener('change', () => accept(fileInput.files?.[0]));
  cancel.addEventListener('click', () => finish(null));

  function prompt(modelName, handle = null) {
    if (resolvePending) finish(null);
    name.textContent = modelName;
    message.textContent = 'Locate the original GLB to restore this project.';
    savedHandle = handle;
    retry.hidden = !handle;
    root.hidden = false;
    browse.focus();
    return new Promise((resolve) => { resolvePending = resolve; });
  }

  return { element: root, prompt };
}
