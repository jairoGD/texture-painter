import { FILTER_CATEGORIES } from '../editor/filter-definitions.js';
import { createColorRampControl } from './color-ramp-control.js';
import { button, element } from './index.js';
import './filter-dialog.css';

export function createFilterDialog({ onBegin, onPreview, onApply, onCancel, onError }) {
  const title = element('h2', { attributes: { id: 'filter-dialog-title' } });
  const closeButton = button({ label: 'Close filter', icon: '×', variant: 'ghost',
    iconOnly: true, onClick: cancel });
  const header = element('div', { className: 'filter-dialog__header' }, [title, closeButton]);
  const controls = element('div', { className: 'filter-dialog__controls' });
  const cancelButton = button({ label: 'Cancel', variant: 'ghost', onClick: cancel });
  const applyButton = button({ label: 'Apply', variant: 'primary', onClick: apply });
  const card = element('section', { className: 'filter-dialog__card', attributes: {
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'filter-dialog-title'
  } }, [header, controls,
    element('div', { className: 'filter-dialog__actions' }, [cancelButton, applyButton])]);
  const root = element('div', { className: 'filter-dialog', attributes: { hidden: '' } }, [card]);
  let category = null;
  let settings = null;
  let previewTimer = null;

  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      try { onPreview(category.id, { ...settings }); }
      catch (error) { onError?.(error.message || 'Could not preview filter.'); cancel(); }
    }, 80);
  }

  function close() {
    clearTimeout(previewTimer);
    previewTimer = null;
    root.hidden = true;
    category = null;
    settings = null;
  }

  function cancel() {
    if (root.hidden) return;
    onCancel();
    close();
  }

  function apply() {
    if (root.hidden) return;
    clearTimeout(previewTimer);
    previewTimer = null;
    try { onApply(category.id, { ...settings }); close(); }
    catch (error) { onError?.(error.message || 'Could not apply filter.'); cancel(); }
  }

  function rangeControl(control) {
    const value = element('output', { className: 'filter-dialog__value' });
    const showValue = (next) => control.display ? control.display(next) : `${next}${control.unit ?? ''}`;
    value.value = showValue(control.value);
    const input = element('input', { attributes: {
      type: 'range', min: control.min, max: control.max, step: control.step ?? 1,
      value: control.value, 'aria-label': control.label
    }, on: { input: (event) => {
      settings[control.key] = Number(event.target.value);
      value.value = showValue(settings[control.key]);
      preview();
    } } });
    return element('label', { className: 'filter-dialog__range' }, [
      element('span', { className: 'filter-dialog__range-title' }, [
        element('span', { text: control.label }), value
      ]), input
    ]);
  }

  function checkControl(label, key, checked = false) {
    const input = element('input', { attributes: { type: 'checkbox', 'aria-label': label },
      on: { change: (event) => { settings[key] = event.target.checked; preview(); } } });
    input.checked = checked;
    return element('label', { className: 'filter-dialog__check' },
      [input, element('span', { text: label })]);
  }

  function open(id) {
    const next = FILTER_CATEGORIES.find((item) => item.id === id);
    if (!next || !onBegin()) return false;
    category = next;
    settings = Object.fromEntries(next.controls.map((control) => [control.key,
      control.key === 'stops' ? control.value.map((stop) => ({ ...stop })) : control.value]));
    settings.allLayers = false;
    title.textContent = next.label;
    const fields = next.id === 'ramp' ? [createColorRampControl(settings, preview)] :
      next.controls.map((control) => control.type === 'checkbox' ?
        checkControl(control.label, control.key, control.value) : rangeControl(control));
    controls.replaceChildren(...fields,
    element('div', { className: 'filter-dialog__divider' }),
    checkControl('All Layers', 'allLayers'));
    card.style.left = `${Math.max(16, window.innerWidth - 312)}px`;
    card.style.top = '72px';
    root.hidden = false;
    closeButton.focus();
    if (next.id === 'ramp') preview();
    return true;
  }

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const left = card.offsetLeft, top = card.offsetTop;
    const move = (next) => {
      card.style.left = `${Math.max(0, Math.min(window.innerWidth - card.offsetWidth,
        left + next.clientX - startX))}px`;
      card.style.top = `${Math.max(0, Math.min(window.innerHeight - card.offsetHeight,
        top + next.clientY - startY))}px`;
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  });
  root.addEventListener('pointerdown', (event) => { if (event.target === root) cancel(); });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  });
  return { element: root, open, cancel, isOpen: () => !root.hidden };
}
