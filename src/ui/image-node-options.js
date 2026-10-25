export const IMAGE_SELECT_OPTIONS = [
  ['interpolation', 'Interpolation', [['linear', 'Linear'], ['closest', 'Closest']]],
  ['projection', 'Projection', [['flat', 'Flat (UV)'], ['warp', 'Warp Projection'], ['box', 'Box'],
    ['sphere', 'Sphere'], ['tube', 'Tube']]],
  ['extension', 'Extension', [['repeat', 'Repeat'], ['extend', 'Extend'],
    ['clip', 'Clip'], ['mirror', 'Mirror']]]
];

export const IMAGE_NUMBER_OPTIONS = [
  ['scale', 'Scale', 0.01, 16],
  ['rotation', 'Rotation (°)', -360, 360],
  ['offsetU', 'Offset U', -8, 8],
  ['offsetV', 'Offset V', -8, 8]
];

export function imageNumberValue(key, value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || (key === 'scale' ? 1 : 0)));
}
