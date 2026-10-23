import { button, element } from './index.js';
import { IMAGE_NUMBER_OPTIONS, IMAGE_SELECT_OPTIONS, imageNumberValue } from './image-node-options.js';

export function createLayerImageProperties({ onEdit, onNew, onOpen, onPaint, getImageInfo }) {
  const content = element('div', { className: 'layer-image-properties__content' });
  const root = element('section', { className: 'layer-image-properties',
    attributes: { 'aria-label': 'Selected layer image properties' } }, [
    element('div', { className: 'ui-section-header' }, [element('h2', { text: 'LAYER IMAGE' })]),
    content
  ]);

  function render(layer, targetId, paintSource) {
    if (!layer || layer.source.type !== 'image') {
      content.replaceChildren(element('p', { className: 'layer-image-properties__empty',
        text: 'Select an image layer.' }));
      return;
    }
    const node = layer.source;
    const info = getImageInfo?.(targetId, node.imageKey);
    const heading = element('div', { className: 'layer-image-properties__image' }, [
      element('span', { className: 'layer-image-properties__name',
        text: node.imageName || layer.label, attributes: { title: node.imageName || layer.label } }),
      info ? element('span', { className: 'layer-image-properties__size',
        text: `${info.width} × ${info.height}`, attributes: { title: 'Original image resolution' } }) : null
    ]);
    const actions = element('div', { className: 'layer-image-properties__actions' }, [
      button({ label: 'New', variant: 'ghost', onClick: () => onNew?.(node.id) }),
      button({ label: 'Open', variant: 'ghost', onClick: () => onOpen?.(node.id) }),
      button({ label: paintSource === node.id ? 'Painting here' : 'Paint here', variant: 'ghost',
        disabled: !node.imageKey || paintSource === node.id, onClick: () => onPaint?.(node.id) })
    ]);
    const fields = element('div', { className: 'layer-image-properties__fields' });
    for (const [key, label, choices] of IMAGE_SELECT_OPTIONS) {
      const field = element('select', { attributes: { 'aria-label': `Image ${label.toLowerCase()}` } },
        choices.map(([value, title]) => element('option', { text: title,
          attributes: { value } })));
      field.value = node[key];
      field.addEventListener('change', () => onEdit?.(node.id, key, field.value));
      fields.append(element('label', {}, [element('span', { text: label }), field]));
    }
    for (const [key, label, min, max] of IMAGE_NUMBER_OPTIONS) {
      const field = element('input', { attributes: { type: 'number', min, max, step: '0.1',
        value: node[key], 'aria-label': `Image ${label.toLowerCase()}` } });
      field.addEventListener('change', () => {
        const value = imageNumberValue(key, field.value, min, max);
        field.value = value;
        onEdit?.(node.id, key, value);
      });
      fields.append(element('label', {}, [element('span', { text: label }), field]));
    }
    content.replaceChildren(heading, actions, fields);
  }

  render(null);
  return { element: root, render };
}
