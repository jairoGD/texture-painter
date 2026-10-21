import { element, panel } from './index.js';
import './color-palette.css';

const PRESET_COLORS = [
  '#0d0d14', '#ffffff', '#ffc198', '#1f3a93', '#2f80ed',
  '#56ccf2', '#27ae60', '#6fcf97', '#f2c94c', '#f2994a',
  '#eb5757', '#c0392b', '#9b51e0', '#bb6bd9', '#e84393',
  '#8d5524', '#c68642', '#4f4f4f', '#828282', '#bdbdbd'
];

export function colorPalette({ color = '#000000', secondaryColor = '#ffffff', onChange } = {}) {
  let foreground = color.toLowerCase();
  let background = secondaryColor.toLowerCase();
  const savedColors = Array(12).fill(null);
  const foregroundPicker = element('input', { className: 'color-palette__native-picker',
    attributes: { type: 'color', value: foreground, 'aria-label': 'Choose foreground color' } });
  const backgroundPicker = element('input', { className: 'color-palette__hidden-picker',
    attributes: { type: 'color', value: background, 'aria-label': 'Choose background color' } });
  const foregroundSwatch = element('button', { className: 'color-palette__foreground',
    attributes: { type: 'button', 'aria-label': 'Choose foreground color', title: 'Choose paint color' },
    on: { click: () => foregroundPicker.click() } });
  const backgroundSwatch = element('button', { className: 'color-palette__background',
    attributes: { type: 'button', 'aria-label': 'Choose background color', title: 'Choose secondary color' },
    on: { click: () => backgroundPicker.click() } });
  const hexLabel = element('output', { className: 'color-palette__hex' });
  const presets = element('div', { className: 'color-palette__presets',
    attributes: { role: 'group', 'aria-label': 'Basic color palette' } });
  const saved = element('div', { className: 'color-palette__saved',
    attributes: { role: 'group', 'aria-label': 'Saved colors' } });

  function updateColors() {
    foregroundSwatch.style.backgroundColor = foreground;
    backgroundSwatch.style.backgroundColor = background;
    foregroundPicker.value = foreground;
    backgroundPicker.value = background;
    hexLabel.value = foreground.toUpperCase();
    for (const swatch of presets.children) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.color === foreground));
    }
  }

  function setColor(next) {
    if (!/^#[0-9a-f]{6}$/i.test(next)) return;
    foreground = next.toLowerCase();
    updateColors();
    onChange?.(foreground);
  }

  function renderSaved() {
    saved.replaceChildren(...savedColors.map((slotColor, index) => {
      const label = slotColor
        ? `Saved color ${index + 1}: ${slotColor}. Click to use, Shift-click to replace, right-click to clear.`
        : `Empty color slot ${index + 1}. Click to save the current color.`;
      const swatch = element('button', { className: `color-palette__slot${slotColor ? ' is-filled' : ''}`,
        attributes: { type: 'button', 'aria-label': label, title: label },
        on: {
          click: (event) => {
            if (!slotColor || event.shiftKey) {
              savedColors[index] = foreground;
              renderSaved();
            } else setColor(slotColor);
          },
          contextmenu: (event) => {
            event.preventDefault();
            savedColors[index] = null;
            renderSaved();
          }
        } });
      if (slotColor) swatch.style.backgroundColor = slotColor;
      return swatch;
    }));
  }

  for (const preset of PRESET_COLORS) {
    const swatch = element('button', { className: 'color-palette__preset',
      attributes: { type: 'button', 'aria-label': `Use ${preset}`, title: preset, 'data-color': preset },
      on: { click: () => setColor(preset) } });
    swatch.style.backgroundColor = preset;
    presets.append(swatch);
  }
  foregroundPicker.addEventListener('input', (event) => setColor(event.target.value));
  backgroundPicker.addEventListener('input', (event) => {
    background = event.target.value.toLowerCase();
    updateColors();
  });

  const swap = element('button', { className: 'color-palette__swap', text: '⇅',
    attributes: { type: 'button', 'aria-label': 'Swap foreground and background colors', title: 'Swap colors' },
    on: { click: () => {
      [foreground, background] = [background, foreground];
      updateColors();
      onChange?.(foreground);
    } } });
  const preview = element('div', { className: 'color-palette__preview' },
    [backgroundSwatch, foregroundSwatch, swap]);
  const current = element('div', { className: 'color-palette__current' },
    [foregroundPicker, hexLabel, backgroundPicker]);
  const top = element('div', { className: 'color-palette__top' }, [preview, current]);
  const root = panel({ title: 'Color', className: 'color-palette', children: [top, presets, saved] });
  renderSaved();
  updateColors();
  return { element: root, setColor, getColor: () => foreground };
}
