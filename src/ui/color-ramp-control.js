import { colorRampAt } from '../editor/filter-effects.js';
import { button, element } from './index.js';

function toHex(rgb) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function createColorRampControl(settings, onChange) {
  let selected = settings.stops[0];
  const gradient = element('div', { className: 'color-ramp__gradient', attributes: {
    'aria-label': 'Color ramp; click to add a stop'
  } });
  const pins = element('div', { className: 'color-ramp__pins' });
  const position = element('input', { attributes: {
    type: 'number', min: 0, max: 100, step: 1, 'aria-label': 'Stop position'
  } });
  const color = element('input', { attributes: { type: 'color', 'aria-label': 'Stop color' } });
  const add = button({ label: '+ Add Stop', onClick: addStop });
  const remove = button({ label: '− Remove Stop', onClick: removeStop });
  const interpolation = element('select', { attributes: { 'aria-label': 'Interpolation' } }, [
    element('option', { text: 'Linear', attributes: { value: 'linear' } }),
    element('option', { text: 'Constant', attributes: { value: 'constant' } })
  ]);
  interpolation.value = settings.interpolation;

  function paintGradient() {
    const stops = [...settings.stops].sort((a, b) => a.position - b.position);
    gradient.style.background = settings.interpolation === 'constant' ?
      `linear-gradient(to right, ${stops.map((stop, index) => {
        const next = stops[index + 1];
        return `${stop.color} ${stop.position * 100}%${next ? `, ${stop.color} ${next.position * 100}%` : ''}`;
      }).join(', ')})` :
      `linear-gradient(to right, ${stops.map((stop) =>
        `${stop.color} ${stop.position * 100}%`).join(', ')})`;
  }

  function select(stop) {
    selected = stop;
    position.value = String(Math.round(stop.position * 100));
    color.value = stop.color;
    for (const pin of pins.children)
      pin.classList.toggle('is-selected', pin._stop === stop);
  }

  function renderPins() {
    pins.replaceChildren(...settings.stops.map((stop) => {
      const pin = element('button', { className: 'color-ramp__pin', attributes: {
        type: 'button', 'aria-label': `Stop at ${Math.round(stop.position * 100)} percent`
      } });
      pin._stop = stop;
      pin.style.left = `${stop.position * 100}%`;
      pin.style.backgroundColor = stop.color;
      pin.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        select(stop);
        pin.setPointerCapture(event.pointerId);
      });
      pin.addEventListener('pointermove', (event) => {
        if (!pin.hasPointerCapture(event.pointerId)) return;
        const rect = gradient.getBoundingClientRect();
        stop.position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        pin.style.left = `${stop.position * 100}%`;
        pin.setAttribute('aria-label', `Stop at ${Math.round(stop.position * 100)} percent`);
        position.value = String(Math.round(stop.position * 100));
        paintGradient();
        onChange();
      });
      pin.addEventListener('pointerup', () => renderPins());
      pin.addEventListener('click', () => select(stop));
      return pin;
    }));
    select(selected);
    remove.disabled = settings.stops.length <= 2;
    paintGradient();
  }

  function insert(positionValue) {
    const rgb = colorRampAt(positionValue, settings.stops, settings.interpolation);
    const stop = { position: positionValue, color: toHex(rgb) };
    settings.stops.push(stop);
    selected = stop;
    renderPins();
    onChange();
  }

  function addStop() {
    const sorted = [...settings.stops].sort((a, b) => a.position - b.position);
    const index = sorted.indexOf(selected);
    const neighbor = sorted[index + 1] ?? sorted[index - 1];
    insert(neighbor ? (selected.position + neighbor.position) / 2 : 0.5);
  }

  function removeStop() {
    if (settings.stops.length <= 2) return;
    settings.stops.splice(settings.stops.indexOf(selected), 1);
    selected = settings.stops[0];
    renderPins();
    onChange();
  }

  gradient.addEventListener('click', (event) => {
    const rect = gradient.getBoundingClientRect();
    insert(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
  });
  position.addEventListener('input', () => {
    if (position.value === '') return;
    selected.position = Math.max(0, Math.min(100, Number(position.value))) / 100;
    renderPins();
    onChange();
  });
  color.addEventListener('input', () => {
    selected.color = color.value;
    renderPins();
    onChange();
  });
  interpolation.addEventListener('change', () => {
    settings.interpolation = interpolation.value;
    paintGradient();
    onChange();
  });

  const root = element('div', { className: 'color-ramp' }, [
    element('span', { className: 'color-ramp__label', text: 'Color Ramp' }),
    element('div', { className: 'color-ramp__track' }, [gradient, pins]),
    element('div', { className: 'color-ramp__fields' }, [
      element('label', {}, [element('span', { text: 'Position' }), position]),
      element('label', {}, [element('span', { text: 'Color' }), color])
    ]),
    element('div', { className: 'color-ramp__buttons' }, [add, remove]),
    element('label', { className: 'color-ramp__interpolation' }, [
      element('span', { text: 'Interpolation' }), interpolation
    ])
  ]);
  renderPins();
  return root;
}
