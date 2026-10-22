export const FILTER_CATEGORIES = [
  { id: 'color', label: 'Color', controls: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, value: 0, unit: '°' },
    { key: 'saturation', label: 'Saturation', min: 0, max: 200, value: 100, unit: '%' },
    { key: 'invert', label: 'Invert Colors', type: 'checkbox', value: false }
  ] },
  { id: 'tone', label: 'Tone', controls: [
    { key: 'luminance', label: 'Luminance', min: -100, max: 100, value: 0, unit: '%' },
    { key: 'brightness', label: 'Brightness', min: 0, max: 200, value: 100, unit: '%' },
    { key: 'contrast', label: 'Contrast', min: 0, max: 200, value: 100, unit: '%' }
  ] },
  { id: 'blur', label: 'Blur & Mosaic', controls: [
    { key: 'depth', label: 'Depth / Blur', min: 0, max: 20, step: 0.5, value: 0, unit: 'px' },
    { key: 'mosaic', label: 'Mosaic Blur', min: 1, max: 100, value: 1, unit: 'px' }
  ] },
  { id: 'palette', label: 'Palette', controls: [
    { key: 'posterize', label: 'Posterize (Color Depth)', min: 2, max: 256, value: 256 },
    { key: 'colorCount', label: 'Number of Colors', min: 0, max: 8, value: 0,
      display: (value) => value ? String(2 ** (9 - value)) : 'Original' }
  ] },
  { id: 'ramp', label: 'Color Ramp', controls: [
    { key: 'stops', type: 'ramp', value: [
      { position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }
    ] },
    { key: 'interpolation', value: 'linear' }
  ] }
];
