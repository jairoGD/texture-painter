import { element } from './index.js';
import './materials-panel.css';

export function createMaterialsPanel({ onSelect }) {
  const list = element('ul', { className: 'materials-panel__list' });
  const root = element('section', { className: 'materials-panel',
    attributes: { 'aria-label': 'Model materials' } }, [
    element('div', { className: 'ui-section-header' }, [element('h2', { text: 'MATERIALS' })]), list
  ]);

  function setState(targets, activeId) {
    root.hidden = targets.length === 0;
    list.replaceChildren(...targets.map(({ id, label, color }) => {
      const swatch = element('span', { className: 'materials-panel__swatch',
        attributes: { 'aria-hidden': 'true' } });
      if (/^#[\da-f]{6}$/i.test(color)) swatch.style.backgroundColor = color;
      const entry = element('button', { className: 'ui-button ui-button--ghost materials-panel__item',
        attributes: { type: 'button', title: label, 'aria-pressed': String(id === activeId) },
        on: { click: () => onSelect(id) } }, [
        swatch, element('span', { className: 'materials-panel__name', text: label })
      ]);
      return element('li', {}, [entry]);
    }));
  }

  return { element: root, setState };
}
