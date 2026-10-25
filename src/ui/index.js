import './ui.css';
import './scrollbar.css';

export function element(tag, { className, text, attributes = {}, on = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value));
  }
  for (const [event, handler] of Object.entries(on)) node.addEventListener(event, handler);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function button({ label, icon, iconUrl, variant = 'default', title, tooltip, iconOnly = false, onClick, disabled = false }) {
  const content = [];
  if (iconUrl) {
    const mask = element('span', { className: 'ui-icon ui-icon--mask', attributes: { 'aria-hidden': 'true' } });
    mask.style.setProperty('--ui-icon-url', `url("${iconUrl}")`);
    content.push(mask);
  }
  if (icon) content.push(element('span', { className: 'ui-icon', text: icon, attributes: { 'aria-hidden': 'true' } }));
  if (!iconOnly) content.push(element('span', { text: label }));
  const node = element('button', {
    className: `ui-button ui-button--${variant}`,
    attributes: { type: 'button', title, 'data-tooltip': tooltip, 'aria-label': label },
    on: { click: onClick ?? (() => {}) }
  }, content);
  node.disabled = disabled;
  return node;
}

export function toggleButton({ label, iconUrl, pressed = false, onChange, className = '' }) {
  const node = button({ label, iconUrl, variant: 'toggle', iconOnly: true, title: label,
    onClick: () => {
      const next = node.getAttribute('aria-pressed') !== 'true';
      node.setPressed(next);
      onChange?.(next);
    } });
  node.className += ` ${className}`;
  node.setPressed = (value) => node.setAttribute('aria-pressed', String(Boolean(value)));
  node.setPressed(pressed);
  return node;
}

export function slider({ label, min = 0, max = 100, step = 1, value = min, unit = '', onChange }) {
  const output = element('output', { className: 'ui-slider__value' });
  const input = element('input', {
    className: 'ui-slider__input',
    attributes: { type: 'range', min, max, step, value, 'aria-label': label },
    on: { input: (event) => { output.value = `${event.target.value}${unit}`; onChange?.(Number(event.target.value)); } }
  });
  output.value = `${value}${unit}`;
  return element('label', { className: 'ui-slider' }, [
    element('span', { className: 'ui-slider__heading' }, [
      element('span', { text: label }), output
    ]),
    input
  ]);
}

export function checkbox({ label, checked = false, onChange }) {
  const input = element('input', {
    attributes: { type: 'checkbox', 'aria-label': label },
    on: { change: (event) => onChange?.(event.target.checked) }
  });
  input.checked = checked;
  return element('label', { className: 'ui-checkbox' }, [input, element('span', { text: label })]);
}

export function selectControl({ label, options = [], value, onChange }) {
  const input = element('select', { className: 'ui-field__input',
    attributes: { 'aria-label': label },
    on: { change: (event) => onChange?.(event.target.value) } },
  options.map((option) => element('option', { text: option.label,
    attributes: { value: option.value } })));
  input.value = value;
  return element('label', { className: 'ui-field' }, [element('span', { text: label }), input]);
}

export function numberControl({ label, value, min = 0, max = 4096, step = 1,
  unit = '', onChange }) {
  const input = element('input', { className: 'ui-field__input',
    attributes: { type: 'number', value, min, max, step, 'aria-label': label },
    on: { change: (event) => {
      const next = Number(event.target.value);
      if (!Number.isFinite(next)) { event.target.value = value; return; }
      const valid = Math.min(max, Math.max(min, next));
      event.target.value = valid;
      onChange?.(valid);
    } } });
  return element('label', { className: 'ui-field' }, [
    element('span', { text: `${label}${unit ? ` (${unit})` : ''}` }), input
  ]);
}

export function imageImport({ label, value, onChange }) {
  const input = element('input', { attributes: { type: 'file', accept: 'image/*',
    'aria-label': label } });
  input.hidden = true;
  const name = element('span', { className: 'ui-image-import__name',
    text: value?.name || 'No image selected' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const reader = new FileReader();
      reader.onload = () => onChange?.({ name: file.name, dataUrl: reader.result });
      reader.readAsDataURL(file);
    } catch { name.textContent = 'Could not open image'; }
  });
  const pick = button({ label: value ? 'Change image' : 'Import image',
    onClick: () => input.click() });
  return element('div', { className: 'ui-image-import' }, [
    element('span', { text: label }), name, pick, input
  ]);
}

export function colorPicker({ label, value = '#000000', onChange }) {
  const output = element('output', { className: 'ui-color-picker__value', text: value.toUpperCase() });
  const input = element('input', {
    className: 'ui-color-picker__input',
    attributes: { type: 'color', value, 'aria-label': label },
    on: { input: (event) => { output.value = event.target.value.toUpperCase(); onChange?.(event.target.value); } }
  });
  return element('label', { className: 'ui-color-picker' }, [
    element('span', { text: label }),
    element('span', { className: 'ui-color-picker__row' }, [input, output])
  ]);
}

export function colorAlpha({ label, value = { color: '#000000', alpha: 100 }, onChange }) {
  const current = { color: value?.color || '#000000', alpha: value?.alpha ?? 100 };
  const color = element('input', { className: 'ui-color-picker__input',
    attributes: { type: 'color', value: current.color, 'aria-label': `${label} color` },
    on: { input: (event) => {
      current.color = event.target.value;
      onChange?.({ ...current });
    } } });
  const alphaValue = element('output', { text: `${current.alpha}%` });
  const alpha = element('input', { attributes: { type: 'range', min: 0, max: 100,
    step: 1, value: current.alpha, 'aria-label': `${label} opacity` },
    on: { input: (event) => {
      current.alpha = Number(event.target.value);
      alphaValue.value = `${current.alpha}%`;
      onChange?.({ ...current });
    } } });
  return element('div', { className: 'ui-color-alpha' }, [
    element('span', { text: label }),
    element('div', { className: 'ui-color-alpha__row' }, [color, alpha, alphaValue])
  ]);
}

export function panel({ title, subtitle, children = [], className = '' }) {
  return element('section', { className: `ui-panel ${className}`.trim() }, [
    element('div', { className: 'ui-panel__heading' }, [
      element('h2', { text: title }),
      subtitle ? element('p', { text: subtitle }) : null
    ]),
    ...children
  ]);
}

export function dropdown({ label, items }) {
  const trigger = button({ label, variant: 'menu' });
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const menu = element('div', { className: 'ui-dropdown__menu', attributes: { role: 'menu' } },
    items.map((item) => {
      if (item.type === 'separator') return element('hr', { className: 'ui-dropdown__separator', attributes: { role: 'separator' } });
      const option = button({ label: item.label, icon: item.icon, variant: 'menu-item', onClick: () => {
        item.onSelect();
        refresh();
        if (!item.keepOpen) close();
      } });
      option.setAttribute('role', item.type === 'radio' ? 'menuitemradio' : item.type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem');
      if (item.type === 'radio' || item.type === 'checkbox') {
        option.prepend(element('span', { className: 'ui-dropdown__check', text: '✓', attributes: { 'aria-hidden': 'true' } }));
      }
      if (item.shortcut) option.append(element('span', { className: 'ui-dropdown__shortcut', text: item.shortcut, attributes: { 'aria-hidden': 'true' } }));
      option._menuItem = item;
      return option;
    })
  );
  const root = element('div', { className: 'ui-dropdown' }, [trigger, menu]);
  const refresh = () => {
    for (const option of menu.children) {
      const item = option._menuItem;
      if (item?.getChecked) option.setAttribute('aria-checked', String(item.getChecked()));
      if (item?.getDisabled) option.disabled = item.getDisabled();
    }
  };
  const close = () => {
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    const wasOpen = root.classList.contains('is-open');
    document.querySelectorAll('.ui-dropdown.is-open').forEach((node) => {
      node.classList.remove('is-open');
      node.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded', 'false');
    });
    refresh();
    root.classList.toggle('is-open', !wasOpen);
    trigger.setAttribute('aria-expanded', String(!wasOpen));
  });
  document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  root.refresh = refresh;
  return root;
}

export function toolGroup({ items, active, onChange }) {
  const buttons = new Map();
  const root = element('div', { className: 'ui-tool-group', attributes: { role: 'group', 'aria-label': 'Tools' } });
  const setActive = (value) => {
    for (const [key, node] of buttons) node.setAttribute('aria-pressed', String(key === value));
  };
  const select = (value) => {
    setActive(value);
    onChange?.(value);
  };
  for (const item of items) {
    const node = button({ label: item.label, icon: item.icon, iconUrl: item.iconUrl,
      variant: 'tool', iconOnly: true, tooltip: item.label, onClick: () => select(item.value) });
    node.setAttribute('aria-pressed', String(item.value === active));
    buttons.set(item.value, node);
    root.append(node);
  }
  root.setActive = setActive;
  return root;
}

export function toolbar({ items, className = '' }) {
  return element('div', { className: `ui-toolbar ${className}`.trim() }, items);
}

export function notice({ text, tone = 'info' }) {
  return element('div', { className: `ui-notice ui-notice--${tone}`, text, attributes: { role: 'status' } });
}

const controlTypes = new Map([
  ['button', button],
  ['slider', slider],
  ['colorPicker', colorPicker],
  ['colorAlpha', colorAlpha],
  ['checkbox', checkbox],
  ['select', selectControl],
  ['number', numberControl],
  ['imageImport', imageImport],
  ['toolGroup', toolGroup],
  ['notice', notice]
]);

export function registerControl(type, renderer) {
  if (controlTypes.has(type)) throw new Error(`Control type already registered: ${type}`);
  controlTypes.set(type, renderer);
}

export function renderControl({ type, ...props }) {
  const renderer = controlTypes.get(type);
  if (!renderer) throw new Error(`Unknown control type: ${type}`);
  return renderer(props);
}

export function renderPanel({ title, subtitle, controls, className }) {
  return panel({ title, subtitle, className, children: controls.map(renderControl) });
}
