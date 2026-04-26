# App.jsx Responsibility Split Strategy

Last updated: 2026-04-26

## Purpose

This document defines how to split responsibilities currently concentrated in [src/App.jsx](/Users/mn/Documents/Codex/2026-04-26/github-plugin-github-openai-curated-https/dot-plate-pro/src/App.jsx).

The goal of this ticket is not to immediately refactor the file. The goal is to make future split decisions predictable when new features are added.

## Current State

As of 2026-04-26, `src/App.jsx` is 938 lines and combines multiple kinds of work in one place:

- editor UI layout and tab navigation
- canvas drawing state and editing tools
- touch, drag, pinch, and virtual pad interactions
- image import, reprocessing, save/load, and export flows
- layer ordering and layer smoothing settings
- 3D scene generation and STL export
- local visual styling injected from the component

This concentration increases the chance that a small feature change touches unrelated logic.

## Responsibility Map

### 1. App Shell and Navigation

Scope:

- `activeTab`
- header buttons
- bottom navigation
- modal and export overlay visibility

Target split:

- `AppShell`
- `BottomNav`
- `ExportOverlay`
- `ConfirmResetModal`

Reason:

- shell-level UI should not be coupled to editor behavior or 3D generation details

### 2. Project and Document Metadata

Scope:

- `projectName`
- `outputFileName`
- `author`
- `createdAt`
- `originalFilePath`
- project save/load handlers

Target split:

- `useProjectMetadata`
- `ProjectSettingsPanel`

Reason:

- metadata changes are independent from canvas interaction and should be reusable across settings and persistence flows

### 3. Pixel Document and Editing State

Scope:

- `pixels`
- `history`
- `tool`
- `currentColor`
- `brushSize`
- `selection`
- `clipboard`
- `cursorPos`
- `isPlotting`
- `handleToolAction`
- undo/redo

Target split:

- `usePixelDocument`
- `useEditorTools`

Reason:

- this is the core editing model and should become the stable center for future feature work

### 4. Canvas Viewport and Input Interactions

Scope:

- `zoom`
- `isCanvasLocked`
- hand tool dragging
- pinch zoom
- canvas centering
- scroll container behavior

Target split:

- `useCanvasViewport`
- `EditorCanvas`

Reason:

- gesture handling is already complex and changes frequently on mobile-related tickets

### 5. Original Image Preview

Scope:

- `showOriginal`
- `pipZoom`
- original image drag panning
- preview zoom controls

Target split:

- `OriginalImagePreview`

Reason:

- the preview pane now has its own gestures and controls and can evolve independently from the editor canvas

### 6. Source Image Sampling and Reprocessing

Scope:

- `sourceImage`
- `gridSize`
- `sampleOffsetX`
- `sampleOffsetY`
- `reprocessImage`
- upload flow

Target split:

- `useSourceImageSampling`
- `ResolutionToolbar`

Reason:

- import and sampling logic has a different lifecycle from manual canvas editing

### 7. Layer Stack and Per-Layer Modeling Rules

Scope:

- `layerOrder`
- `layerHeightAdjustments`
- `layerSmoothingSettings`
- layer move and adjustment handlers

Target split:

- `LayersPanel`
- `useLayerModelSettings`

Reason:

- layer configuration is a distinct domain and should not be embedded inside the editor view tree

### 8. 3D Modeling Pipeline

Scope:

- contour extraction helpers
- smoothing helpers
- polygon offset helpers
- Three.js scene setup
- STL export

Target split:

- `lib/modeling/contours`
- `lib/modeling/smoothing`
- `ThreePreviewPanel`
- `useThreePreview`

Reason:

- this is the heaviest responsibility in the file and the least related to editor tab rendering

### 9. Local Styling Utilities

Scope:

- inline style injection
- custom scrollbar and range input styling

Target split:

- `EditorGlobalStyles`
- shared utility classes in CSS when the build setup allows it

Reason:

- style infrastructure should not be buried at the end of the main component

## Split Priority

Priority order for future extraction:

1. Canvas viewport and input interactions
2. Original image preview
3. Pixel document and editing state
4. Source image sampling and reprocessing
5. Layer stack and per-layer modeling rules
6. 3D modeling pipeline
7. App shell and navigation
8. Project metadata
9. Local styling utilities

Why this order:

- the first two areas are already changing frequently due to mobile usability tickets
- the editing model is central and should be stabilized early once the surrounding UI is easier to reason about
- the 3D pipeline is large, but changing it too early increases regression risk unless editor-facing responsibilities are already separated

## When a Feature Ticket Must Bring a Split Ticket

Create a separate split or cleanup ticket alongside a feature ticket when any of the following is true:

- the feature adds a new gesture or touch interaction to the editor canvas
- the feature adds new controls to the original image preview
- the feature adds another export mode or import pathway
- the feature adds more per-layer settings or modeling rules
- the feature requires touching both editor interaction code and 3D generation code in the same change
- the feature would introduce another large `useEffect`, another large event handler, or another new cluster of refs inside `App.jsx`

## Safe Boundaries for Future Refactors

When splitting code, preserve these boundaries first:

- keep pixel document state and rendering output behavior unchanged
- keep project JSON format unchanged unless the ticket explicitly changes it
- keep mobile-first interaction behavior unchanged unless the ticket is about input behavior
- keep 3D output dimensions and layer ordering unchanged unless the ticket is about modeling rules

## Relationship to Gemini.md

[Gemini.md](/Users/mn/Documents/Codex/2026-04-26/github-plugin-github-openai-curated-https/dot-plate-pro/Gemini.md) currently states a single-file principle for environmental reasons.

Current interpretation:

- treat the single-file rule as a constraint, not as a ban on planning
- prefer extracting within `App.jsx` first by grouping logic into clearly named blocks if file splitting is risky
- when the environment allows it, use this document as the migration order for real file extraction
- any ticket that breaks the single-file rule should explicitly mention why the maintenance gain outweighs the constraint

## Decision Rule

If a new ticket changes one responsibility area, stay local.

If a new ticket changes two or more responsibility areas in the list above, open a split or cleanup ticket and decide the boundary before implementation.
