import { button, element } from './index.js';
import './selection-size-dialog.css';

export function createSelectionSizeDialog({ onApply }) {
  const title = element('h2', { attributes: { id: 'selection-size-title' } });
  const amount = element('input', { className: 'selection-size-dialog__input', attributes: {
    type: 'number', min: '1', max: '100', step: '1', value: '1',
    'aria-label': 'Pixels'
  } });
  const error = element('p', { className: 'selection-size-dialog__error',
    attributes: { role: 'status' } });
  const cancel = button({ label: 'Cancel', variant: 'ghost', onClick: close });
  const apply = button({ label: 'Confirm', variant: 'primary', onClick: confirm });
  const root = element('div', { className: 'selection-size-dialog', attributes: { hidden: '' } }, [
    element('section', { className: 'selection-size-dialog__card', attributes: {
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'selection-size-title'
    } }, [
      title,
      element('label', { className: 'selection-size-dialog__field' }, [
        element('span', { text: 'Pixels' }), amount
      ]),
      error,
      element('div', { className: 'selection-size-dialog__actions' }, [cancel, apply])
    ])
  ]);
  let mode = 'expand';

  function close() { root.hidden = true; }
  function confirm() {
    const pixels = Number(amount.value);
    if (!Number.isInteger(pixels) || pixels < 1 || pixels > 100) {
      error.textContent = 'Enter a whole number from 1 to 100.';
      amount.focus();
      return;
    }
    onApply(mode, pixels);
    close();
  }
  function open(nextMode) {
    mode = nextMode;
    title.textContent = mode === 'expand' ? 'Expand Selection' : 'Contract Selection';
    amount.value = '1';
    error.textContent = '';
    root.hidden = false;
    amount.focus();
    amount.select();
  }
  root.addEventListener('pointerdown', (event) => { if (event.target === root) close(); });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Enter') { event.preventDefault(); confirm(); }
  });
  return { element: root, open, close };
}
