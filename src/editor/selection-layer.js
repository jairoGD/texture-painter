// A lasso mask belongs to the material's UV space. Only the pixels being edited
// belong to an individual image layer.
export function selectionOnPaintSurface(selection, paintSurface) {
  if (!selection || !paintSurface || selection.surface.id !== paintSurface.id ||
      selection.surface === paintSurface) return selection;
  return { ...selection, surface: paintSurface, floatingBase: null, floatingSourceImage: null,
    parts: selection.parts?.map((part) => ({ ...part, surface: paintSurface })) };
}
