import { button, element } from './index.js';
import eyeIcon from './icons/layer-eye.svg';
import hiddenIcon from './icons/layer-hidden.svg';
import starIcon from './icons/material-star.svg';
import './materials-panel.css';

export function createMaterialsPanel({ onSelect, onToggleVisibility, onToggleIsolation }) {
  const list = element('ul', { className: 'materials-panel__list' });
  const root = element('section', { className: 'materials-panel',
    attributes: { 'aria-label': 'Model materials' } }, [
    element('div', { className: 'ui-section-header' }, [element('h2', { text: 'MATERIALS' })]), list
  ]);

  function setState(targets, activeId, visibility = {}) {
    root.hidden = targets.length === 0;
    const state = new Map(visibility.items?.map((item) => [item.id, item]) ?? []);
    list.replaceChildren(...targets.map(({ id, label, color }) => {
      const material = state.get(id);
      const visible = material?.effectiveVisible !== false;
      const isolated = visibility.isolatedId === id;
      const swatch = element('span', { className: 'materials-panel__swatch',
        attributes: { 'aria-hidden': 'true' } });
      if (/^#[\da-f]{6}$/i.test(color)) swatch.style.backgroundColor = color;
      const entry = element('button', { className: 'ui-button ui-button--ghost materials-panel__item',
        attributes: { type: 'button', title: label, 'aria-pressed': String(id === activeId) },
        on: { click: () => onSelect(id) } }, [
        swatch, element('span', { className: 'materials-panel__name', text: label })
      ]);
      const eye = button({ label: visible ? `Hide ${label}` : `Show ${label}`,
        iconUrl: visible ? eyeIcon : hiddenIcon, variant: 'ghost', iconOnly: true,
        title: visible ? `Hide ${label}` : `Show ${label}`,
        onClick: () => onToggleVisibility?.(id) });
      eye.classList.add('materials-panel__toggle');
      eye.setAttribute('aria-pressed', String(visible));
      const star = button({ label: isolated ? `Restore material visibility` : `Isolate ${label}`,
        iconUrl: starIcon, variant: 'ghost', iconOnly: true,
        title: isolated ? 'Restore material visibility' : `Isolate ${label}`,
        onClick: () => onToggleIsolation?.(id) });
      star.classList.add('materials-panel__toggle', 'materials-panel__isolate');
      star.setAttribute('aria-pressed', String(isolated));
      return element('li', { className: `materials-panel__row${id === activeId ? ' is-active' : ''}${visible ? '' : ' is-hidden'}` },
        [entry, eye, star]);
    }));
  }

  return { element: root, setState };
}
