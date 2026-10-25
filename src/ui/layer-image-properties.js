import { element } from './index.js';
import { IMAGE_NUMBER_OPTIONS, IMAGE_SELECT_OPTIONS, imageNumberValue } from './image-node-options.js';

export function createLayerImageProperties({ onEdit, getImageInfo }) {
  const content = element('div', { className: 'layer-image-properties__content' });
  const root = element('section', { className: 'layer-image-properties',
    attributes: { 'aria-label': 'Selected layer image properties' } }, [
    element('div', { className: 'ui-section-header' }, [element('h2', { text: 'LAYER IMAGE' })]),
    content
  ]);

  function render(layer, targetId) {
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
        value: node[key] ?? (key === 'scale' ? 1 : 0),
        'aria-label': `Image ${label.toLowerCase()}` } });
      field.addEventListener('change', () => {
        const value = imageNumberValue(key, field.value, min, max);
        field.value = value;
        onEdit?.(node.id, key, value);
      });
      fields.append(element('label', {}, [element('span', { text: label }), field]));
    }
    const vertexColor = element('input', { attributes: {
      type: 'checkbox', 'aria-label': 'Vertex Color'
    } });
    vertexColor.checked = Boolean(node.vertexColor);
    vertexColor.addEventListener('change', () => onEdit?.(node.id, 'vertexColor', vertexColor.checked));
    const vertexColorOption = element('label', { className: 'layer-image-properties__vertex-color' },
      [vertexColor, element('span', { text: 'Vertex Color' })]);
    content.replaceChildren(heading, fields, vertexColorOption);
  }

  render(null);
  return { element: root, render };
}
