import { button, element } from './index.js';
import './floating-panel.css';

export function createFloatingPanel({ title, className = '', children = [], onClose }) {
  const subtitle = element('span', { className: 'ui-floating-panel__subtitle' });
  const close = button({ label: `Close ${title}`, icon: '×', variant: 'ghost', iconOnly: true,
    title: 'Close', onClick: () => { setVisible(false); onClose?.(); } });
  close.classList.add('ui-floating-panel__close');
  const header = element('div', { className: 'ui-floating-panel__header' }, [
    element('div', { className: 'ui-floating-panel__heading' }, [
      element('h2', { text: title }), subtitle
    ]), close
  ]);
  const root = element('section', { className: `ui-floating-panel ${className}`.trim(),
    attributes: { role: 'dialog', 'aria-label': title, hidden: '' } }, [header, ...children]);
  let placed = false;
  let drag = null;

  function place() {
    if (placed) return;
    root.style.left = `${Math.max(12, Math.round((window.innerWidth - root.offsetWidth) / 2))}px`;
    root.style.top = `${Math.max(70, Math.round((window.innerHeight - root.offsetHeight) / 2))}px`;
    placed = true;
  }
  function setVisible(visible) {
    root.hidden = !visible;
    if (visible) place();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    root.style.left = `${Math.max(0, Math.min(window.innerWidth - root.offsetWidth,
      drag.left + event.clientX - drag.x))}px`;
    root.style.top = `${Math.max(0, Math.min(window.innerHeight - root.offsetHeight,
      drag.top + event.clientY - drag.y))}px`;
  }
  function endDrag(event) {
    if (event.pointerId !== drag?.pointerId) return;
    drag = null;
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  }
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || close.contains(event.target)) return;
    const rect = root.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: rect.left, top: rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener('pointermove', move);
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => {
    if (!placed) return;
    root.style.left = `${Math.max(0, Math.min(parseFloat(root.style.left),
      window.innerWidth - root.offsetWidth))}px`;
    root.style.top = `${Math.max(0, Math.min(parseFloat(root.style.top),
      window.innerHeight - root.offsetHeight))}px`;
  });

  return { element: root, setVisible, isVisible: () => !root.hidden,
    setSubtitle: (value) => { subtitle.textContent = value || ''; } };
}
