# Bundle Size Investigation

Last updated: 2026-04-26

## Goal

This document records the current production bundle size, identifies the most likely growth factors, and lists follow-up optimization directions.

This ticket does not require immediate code-splitting or performance refactors. It establishes a baseline so future features can be evaluated against it.

## Current Build Metrics

Measured with `npm run build` on 2026-04-26:

- `dist/index.html`: `0.46 kB` (`0.29 kB` gzip)
- `dist/assets/index-*.css`: about `30.01 kB` (`5.85 kB` gzip)
- `dist/assets/index-*.js`: about `799.00 kB` (`215.48 kB` gzip)

Build warning observed:

- Vite reports that some chunks are larger than `500 kB` after minification
- the current build is still emitted successfully

## Main Growth Factors

### 1. Three.js is loaded in the main entry

Observed in [src/App.jsx](/Users/mn/Documents/Codex/2026-04-26/github-plugin-github-openai-curated-https/dot-plate-pro/src/App.jsx):

- `three`
- `OrbitControls`
- `STLExporter`

These imports are static, so users downloading only the editor still pay for 3D preview and STL export code.

### 2. App.jsx is a single large entry surface

`App.jsx` currently contains:

- editor canvas behavior
- original image preview behavior
- settings UI
- layers UI
- 3D preview setup
- export logic
- geometry helpers

Because this is all assembled into one component tree, Vite has almost no natural route or tab boundaries to split.

### 3. Geometry and smoothing helpers live in the same initial bundle

The following helpers are bundled into the main entry even before the user opens the 3D tab:

- contour extraction
- path smoothing
- polygon offsetting
- area and polygon utilities

These are likely needed only for 3D generation and STL export.

### 4. No lazy-loading boundary exists for the 3D tab

The `3D View` is tab-based, but the implementation is not dynamically imported. The current tab structure is a UI state toggle, not a bundling boundary.

## Optimization Priority

### Priority 1: Lazy-load the 3D view stack

Target:

- Three.js
- OrbitControls
- STLExporter
- 3D scene setup
- geometry helper code used only by 3D generation

Expected effect:

- reduce the initial JS downloaded by users who stay in the editor flow
- create the first meaningful split point without changing user-facing behavior

### Priority 2: Separate editor-facing logic from export/modeling logic

Target:

- move canvas editing logic away from modeling helpers
- make future bundle analysis easier by creating clearer ownership boundaries

Expected effect:

- better maintainability
- easier follow-up optimization work

### Priority 3: Re-check toolbar and preview dependencies after `App.jsx` split

Target:

- determine whether original image preview and settings panels can be isolated further

Expected effect:

- smaller main editor path over time

## Recommended Follow-up Tickets

If optimization work is prioritized later, the next tickets should be cut separately:

1. Lazy-load 3D preview and STL export dependencies
2. Extract geometry helper functions from `App.jsx`
3. Re-measure bundle size after `App.jsx` responsibility splits

## Guardrails

Any optimization ticket should preserve:

- current editor behavior
- current project JSON format
- current 3D output dimensions and layer ordering
- mobile touch interactions already fixed in recent tickets

## Conclusion

The current bundle is acceptable for now, but the biggest clear opportunity is not micro-optimization. It is creating a real loading boundary around the 3D feature set.
