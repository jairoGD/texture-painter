import brushIcon from '../ui/icons/brush.svg';
import eraserIcon from '../ui/icons/eraser.svg';
import bucketIcon from '../ui/icons/bucket.svg';
import lineIcon from '../ui/icons/line.svg';
import curveIcon from '../ui/icons/curve.svg';
import eyedropperIcon from '../ui/icons/eyedropper.svg';
import blurIcon from '../ui/icons/blur.svg';
import lassoIcon from '../ui/icons/lasso.svg';
import magicIcon from '../ui/icons/magic.svg';
import wireIcon from '../ui/icons/wire.svg';
import gradientIcon from '../ui/icons/gradient.svg';
import stampIcon from '../ui/icons/stamp.svg';

const size = { type: 'slider', key: 'size', label: 'Size', min: 2, max: 128, step: 1, unit: ' px' };
const fineSize = { ...size, min: 1 };
const hardness = { type: 'slider', key: 'hardness', label: 'Hardness', min: 0, max: 100, step: 1, unit: '%' };
const opacity = { type: 'slider', key: 'opacity', label: 'Opacity', min: 1, max: 100, step: 1, unit: '%' };
const antialias = { type: 'checkbox', key: 'antialias', label: 'Antialiasing' };
const lineStyleDefaults = { lineStyle: 'solid', dashLength: 16, dashGap: 8,
  waveHeight: 8, waveSpacing: 32 };
const lineStyleControls = [
  { type: 'select', key: 'lineStyle', label: 'Appearance', options: [
    { value: 'solid', label: 'Continuous' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'wavy', label: 'Wavy' }
  ] },
  { type: 'number', key: 'dashLength', label: 'Dash length', min: 1, max: 1024,
    step: 1, unit: 'px', when: { lineStyle: 'dashed' } },
  { type: 'number', key: 'dashGap', label: 'Dash spacing', min: 1, max: 1024,
    step: 1, unit: 'px', when: { lineStyle: 'dashed' } },
  { type: 'number', key: 'waveHeight', label: 'Wave height', min: 0, max: 512,
    step: 1, unit: 'px', when: { lineStyle: 'wavy' } },
  { type: 'number', key: 'waveSpacing', label: 'Wave spacing', min: 2, max: 1024,
    step: 1, unit: 'px', when: { lineStyle: 'wavy' } }
];
const textureStyleDefaults = { textureImage: null, seamlessTexture: false,
  flipTexture: false };
const textureStyleControls = [
  { ...lineStyleControls[0], options: [...lineStyleControls[0].options,
    { value: 'texture', label: 'Texture' }] },
  ...lineStyleControls.slice(1),
  { type: 'imageImport', key: 'textureImage', label: 'Image',
    when: { lineStyle: 'texture' } },
  { type: 'checkbox', key: 'seamlessTexture', label: 'Align texture ends',
    when: { lineStyle: 'texture' } },
  { type: 'checkbox', key: 'flipTexture', label: 'Flip',
    when: { lineStyle: 'texture' } }
];
export const TOOL_DEFINITIONS = [
  { id: 'brush', label: 'Brush', iconUrl: brushIcon,
    usesColor: true, defaults: { size: 10, hardness: 100, opacity: 100, antialias: true },
    controls: [fineSize, hardness, opacity, antialias] },
  { id: 'eraser', label: 'Eraser', iconUrl: eraserIcon,
    defaults: { size: 10, hardness: 100, opacity: 100, antialias: true },
    controls: [size, hardness, opacity, antialias] },
  { id: 'bucket', label: 'Bucket', iconUrl: bucketIcon,
    usesColor: true, defaults: { tolerance: 0, opacity: 100 },
    controls: [{ type: 'slider', key: 'tolerance', label: 'Tolerance', min: 0, max: 100, step: 1, unit: '%' }, opacity] },
  { id: 'line', label: 'Line', iconUrl: lineIcon,
    usesColor: true, defaults: { size: 2, hardness: 100, opacity: 100, antialias: true,
      ...lineStyleDefaults, ...textureStyleDefaults },
    controls: [fineSize, hardness, opacity, antialias, ...textureStyleControls] },
  { id: 'curve', label: 'Curve', iconUrl: curveIcon,
    usesColor: true, defaults: { size: 2, hardness: 100, opacity: 100, antialias: true,
      ...lineStyleDefaults, ...textureStyleDefaults, curveMethod: 'dynamic' },
    controls: [
      { type: 'select', key: 'curveMethod', label: 'Method', options: [
        { value: 'dynamic', label: 'Dynamic' },
        { value: 'precise', label: 'Precise' }
      ] },
      fineSize, hardness, opacity, antialias, ...textureStyleControls] },
  { id: 'gradient', label: 'Gradient', iconUrl: gradientIcon,
    defaults: { startColor: { color: '#000000', alpha: 100 },
      endColor: { color: '#000000', alpha: 0 }, xray: false },
    controls: [
      { type: 'colorAlpha', key: 'startColor', label: 'Start color' },
      { type: 'colorAlpha', key: 'endColor', label: 'End color' },
      { type: 'checkbox', key: 'xray', label: 'X-ray' }
    ] },
  { id: 'stamp', label: 'Stamp', iconUrl: stampIcon,
    defaults: { image: null, size: 64, rotation: 0, opacity: 100,
      antialias: true, stroke: false, proportionalStroke: true },
    controls: [
      { type: 'imageImport', key: 'image', label: 'Image' },
      { type: 'slider', key: 'size', label: 'Size', min: 1, max: 512,
        step: 1, unless: { stroke: true, proportionalStroke: true } },
      { type: 'number', key: 'rotation', label: 'Rotation', min: -180,
        max: 180, step: 1, unit: '°' },
      opacity, antialias,
      { type: 'checkbox', key: 'stroke', label: 'Stroke' },
      { type: 'checkbox', key: 'proportionalStroke', label: 'Proportional width',
        when: { stroke: true } }
    ] },
  { id: 'blur', label: 'Blur', iconUrl: blurIcon,
    defaults: { size: 72, hardness: 35, strength: 20, spread: 20 },
    controls: [size, hardness,
      { type: 'slider', key: 'strength', label: 'Strength', min: 1, max: 100, step: 1, unit: '%' },
      { type: 'slider', key: 'spread', label: 'Spread', min: 1, max: 32, step: 1, unit: ' px' }] },
  { id: 'lasso', label: 'Lasso', iconUrl: lassoIcon,
    defaults: { maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'wand', label: 'Wand', iconUrl: magicIcon,
    defaults: { threshold: 30, similar: false, allLayers: false,
      maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'slider', key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1 },
      { type: 'checkbox', key: 'similar', label: 'Select Similar' },
      { type: 'checkbox', key: 'allLayers', label: 'Sample All Layers' },
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'faces', label: 'Face Select', iconUrl: wireIcon,
    defaults: { maskEnabled: true, isolateBlur: true },
    controls: [
      { type: 'checkbox', key: 'maskEnabled', label: 'Mask painting to selection' },
      { type: 'checkbox', key: 'isolateBlur', label: 'Keep blur inside selection' },
      { type: 'button', action: 'clearSelection', label: 'Clear Selection' }
    ] },
  { id: 'eyedropper', label: 'Eyedropper', iconUrl: eyedropperIcon,
    defaults: {}, controls: [] }
];
