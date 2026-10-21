# Texture Painter

Early foundation for a browser-based 3D texture painting editor built with three.js.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates a self-contained static build in `dist/`. The three.js package is installed in `node_modules` and bundled into the build; the editor does not load it from a CDN.

On Windows, after `npm install` has been run once, double-click `start-editor.bat` to start the local server and open the editor automatically. Keep the command window open while using the editor; press Ctrl+C there to stop it.

## Current features

- 3D viewport with immediate orbit motion: Alt + left drag to orbit, right drag to pan, mouse wheel to zoom.
- File → Import Model opens a local `.glb` file. Each imported mesh with UV coordinates receives a new white 1024×1024 canvas texture.
- Display → Shaded / Unlit changes the model's lighting mode; Display → Show grid toggles the grid.
- Brush and Eraser paint directly on the model. Left drag paints dark strokes onto its UV texture; the eraser paints white.
- Edit → Undo / Redo works per paint stroke. The shortcuts are Ctrl+Z and Ctrl+Shift+Z (Command equivalents on macOS). Importing another model starts a fresh paint history.
- Reusable interface module in `src/ui/` with buttons, dropdowns, tool groups, panels and other controls. Panels are rendered from control definitions. New control types can be added with `registerControl()`; updating a shared component updates every use in the editor.

This is the first painting pass. Textures currently stay in memory during the session; saving and exporting painted textures are future work. Models need UV coordinates for painting.
