export function strokeWidthAt(size, profile = 'circle', taper = 100, progress = 0.5) {
  const width = Math.max(1, Number(size) || 1);
  if (profile !== 'tapered') return width;
  const amount = Math.max(0, Math.min(1, (Number(taper) || 0) / 100));
  const position = Math.max(0, Math.min(1, progress));
  return Math.max(1, width * (1 - amount * (1 - Math.sin(Math.PI * position))));
}
