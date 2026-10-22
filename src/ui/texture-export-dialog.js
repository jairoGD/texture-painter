import { planTextureExport, textureFileName } from '../editor/texture-export.js';
import { button, element } from './index.js';
import './texture-export-dialog.css';

export function createTextureExportDialog({ getTextures, chooseDirectory, onExport, onComplete,
  onError }) {
  const list = element('div', { className: 'texture-export__list',
    attributes: { role: 'listbox', 'aria-label': 'Material textures' } });
  const preview = element('canvas', { className: 'texture-export__preview',
    attributes: { width: 512, height: 512, 'aria-label': 'Texture preview' } });
  const nameInput = element('input', { className: 'texture-export__name',
    attributes: { type: 'text', 'aria-label': 'Export name', spellcheck: 'false' } });
  const fileName = element('output', { className: 'texture-export__filename' });
  const folderName = element('span', { className: 'texture-export__folder-name',
    text: 'No folder selected' });
  const message = element('p', { className: 'texture-export__message',
    attributes: { role: 'status' } });
  const closeButton = button({ label: 'Close', icon: '×', variant: 'ghost',
    iconOnly: true, onClick: close });
  const folderButton = button({ label: 'Choose Folder', onClick: pickFolder });
  const exportButton = button({ label: 'Export', variant: 'primary', onClick: exportAll });
  const root = element('div', { className: 'texture-export', attributes: { hidden: '' } }, [
    element('section', { className: 'texture-export__card', attributes: {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'texture-export-title'
    } }, [
      element('div', { className: 'texture-export__header' }, [
        element('h2', { text: 'Export Texture', attributes: { id: 'texture-export-title' } }),
        closeButton
      ]),
      element('div', { className: 'texture-export__content' }, [
        list,
        element('div', { className: 'texture-export__detail' }, [
          element('div', { className: 'texture-export__preview-shell' }, [preview]),
          element('label', { className: 'texture-export__name-field' }, [
            element('span', { text: 'Name' }), nameInput
          ]),
          fileName
        ])
      ]),
      element('div', { className: 'texture-export__footer' }, [
        element('div', { className: 'texture-export__folder' }, [folderButton, folderName]),
        message,
        exportButton
      ])
    ])
  ]);
  let entries = [];
  let rows = [];
  let selected = 0;
  let directory = null;
  let busy = false;

  function validate(clearMessage = true) {
    try {
      planTextureExport(entries);
      if (clearMessage) {
        message.textContent = '';
        message.classList.remove('is-error');
      }
      exportButton.disabled = busy || !directory;
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('is-error');
      exportButton.disabled = true;
    }
  }

  function showSelected() {
    const entry = entries[selected];
    if (!entry) return;
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === selected)));
    nameInput.value = entry.name;
    fileName.value = textureFileName(entry.name) ?? '';
    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
    const scale = Math.min(preview.width / entry.canvas.width,
      preview.height / entry.canvas.height);
    const width = entry.canvas.width * scale;
    const height = entry.canvas.height * scale;
    context.drawImage(entry.canvas, (preview.width - width) / 2,
      (preview.height - height) / 2, width, height);
  }

  function open() {
    if (busy) return;
    entries = getTextures().map((texture) => ({ ...texture, name: texture.label }));
    selected = 0;
    rows = entries.map((entry, index) => {
      const name = element('span', { className: 'texture-export__row-name', text: entry.name });
      const size = element('span', { className: 'texture-export__row-size',
        text: `${entry.canvas.width} × ${entry.canvas.height}` });
      const row = element('button', { className: 'texture-export__row',
        attributes: { type: 'button', role: 'option', 'aria-selected': 'false' },
        on: { click: () => { selected = index; showSelected(); } } }, [name, size]);
      return row;
    });
    list.replaceChildren(...rows);
    root.hidden = false;
    if (entries.length) showSelected();
    validate();
    rows[0]?.focus();
  }

  function close() {
    if (busy) return;
    root.hidden = true;
  }

  async function pickFolder() {
    if (busy) return;
    try {
      const next = await chooseDirectory();
      if (!next) return;
      directory = next;
      folderName.textContent = next.name;
      validate();
    } catch (error) {
      if (error.name !== 'AbortError') {
        message.textContent = error.message || 'Could not choose the folder.';
        message.classList.add('is-error');
        onError?.(message.textContent);
      }
    }
  }

  async function exportAll() {
    if (busy || !directory) return;
    try { planTextureExport(entries); }
    catch (error) { validate(); return; }
    busy = true;
    folderButton.disabled = true;
    exportButton.disabled = true;
    closeButton.disabled = true;
    nameInput.disabled = true;
    for (const row of rows) row.disabled = true;
    try {
      const count = await onExport(directory, entries, (completed, total) => {
        message.textContent = `Exporting ${completed} / ${total}`;
        message.classList.remove('is-error');
      });
      root.hidden = true;
      onComplete?.(count, directory.name);
    } catch (error) {
      message.textContent = error.message || 'Could not export textures.';
      message.classList.add('is-error');
      onError?.(message.textContent);
    } finally {
      busy = false;
      folderButton.disabled = false;
      closeButton.disabled = false;
      nameInput.disabled = false;
      for (const row of rows) row.disabled = false;
      validate(false);
    }
  }

  nameInput.addEventListener('input', () => {
    const entry = entries[selected];
    if (!entry) return;
    entry.name = nameInput.value;
    rows[selected].querySelector('.texture-export__row-name').textContent = entry.name;
    fileName.value = textureFileName(entry.name) ?? '';
    validate();
  });
  root.addEventListener('pointerdown', (event) => { if (event.target === root) close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) close();
  });
  return { element: root, open, close };
}
