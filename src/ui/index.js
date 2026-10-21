import './ui.css';

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

export function button({ label, icon, variant = 'default', title, onClick, disabled = false }) {
  const content = [];
  if (icon) content.push(element('span', { className: 'ui-icon', text: icon, attributes: { 'aria-hidden': 'true' } }));
  content.push(element('span', { text: label }));
  const node = element('button', {
    className: `ui-button ui-button--${variant}`,
    attributes: { type: 'button', title, 'aria-label': label },
    on: { click: onClick ?? (() => {}) }
  }, content);
  node.disabled = disabled;
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
      const option = button({ label: item.label, icon: item.icon, variant: 'menu-item', onClick: () => {
        close();
        item.onSelect();
      } });
      option.setAttribute('role', 'menuitem');
      return option;
    })
  );
  const root = element('div', { className: 'ui-dropdown' }, [trigger, menu]);
  const close = () => {
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  };
  trigger.addEventListener('click', () => {
    const wasOpen = root.classList.contains('is-open');
    document.querySelectorAll('.ui-dropdown.is-open').forEach((node) => node.classList.remove('is-open'));
    root.classList.toggle('is-open', !wasOpen);
    trigger.setAttribute('aria-expanded', String(!wasOpen));
  });
  document.addEventListener('pointerdown', (event) => { if (!root.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
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
  ['checkbox', checkbox],
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
