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
- Brush and Eraser paint directly on the model; Bucket fills a connected color region in the UV texture; Line draws a straight stroke with a live preview; Eyedropper samples a painted color. Choose a tool on the left and adjust its color, size, hardness, opacity, or bucket tolerance in Properties. The eraser paints white.
- Blur mixes neighboring texture pixels with a local Gaussian brush. Size and Hardness shape its footprint, Strength controls how much the blurred result replaces the current color, and Spread controls how far nearby color travels. Drag over a painted edge to soften and extend it; each drag is one undoable stroke.
- Lasso selects the visible part of a model's UV texture: hold the mouse button and draw a freehand contour on the model; releasing closes it. A single click does not start a persistent contour. Drag inside the highlighted area to cut and move its pixels on the same material. The selection stays active as a paint mask for Brush, Eraser, Bucket, Line, and Blur; turn off **Mask painting to selection** or use **Clear Selection** in Lasso Properties. Escape cancels a selection in progress. Selection creation, movement, and clearing participate in Undo/Redo.
- Edit → Undo / Redo works per paint stroke. The shortcuts are Ctrl+Z and Ctrl+Shift+Z (Command equivalents on macOS). Importing another model starts a fresh paint history.
- Reusable interface module in `src/ui/` with buttons, dropdowns, tool groups, panels and other controls. Panels are rendered from control definitions. New control types can be added with `registerControl()`; updating a shared component updates every use in the editor.

Textures currently stay in memory during the session; saving and exporting painted textures are future work. Models need UV coordinates for painting. Each material slot has its own texture, so a Line stroke and Lasso selection remain on their starting slot. Bucket operates on connected pixels of that UV texture. Overlapping UVs share texture pixels and therefore cannot be selected independently.
