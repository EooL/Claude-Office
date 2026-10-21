# BUG-E2E-01 fix: horizontal scroll at 768 and 390 wide

## Verified cause

The report's guess (flex row with a fixed 754px room next to a 300px chat column) is not the cause. That row lives inside `.app-wrapper`, which is a fixed 1056x682 window (`src/styles/office.css`, `.app-wrapper`), centred with `position: absolute; left: 50%; transform: translate(-50%, -50%)`. In a viewport narrower than 1056 the wrapper's right edge sits at `viewport/2 + 528` (768 -> 912, 390 -> 723+; the reported 912 matches exactly), which creates the horizontal scrollbar, and its left part is cut off at negative x and cannot be scrolled to. The inner layout was never responsive because the app was designed as a fixed-size window (the Electron app zooms it, see `electron/helpers.cjs`).

## Change

- `src/styles/office.css`: `.app-wrapper` transform is now `translate(-50%, -50%) scale(var(--fit, 1))`.
- `src/main.tsx`: a small `fit()` sets `--fit` on `<html>` to `min(1, innerWidth/1056, innerHeight/682)` at load and on `resize`.

The window is shrunk to fit, never enlarged, so at >= 1056x682 `--fit` is 1 and the layout is identical. Electron compact mode overrides the transform with `none !important`, so it is unaffected. Stacking chat under the scene was not chosen: it would restructure a fixed-geometry scene (absolute-positioned rooms, characters, incident layer).

## Measurements (real Chrome, same-origin iframes of each size against a disposable server, empty AGENT_OFFICE_HOME, port 3457)

The browser window could not be resized (resize_window had no effect on the viewport), so each size was measured in an iframe of that size. Before-values are from the report.

| Viewport | scrollWidth / clientWidth before | after | --fit |
|---|---|---|---|
| 1280x800 | 1280 / 1280 | 1280 / 1280 (wrapper left 112, width 1056, as before) | 1 |
| 768x1024 | 912 / 768 | 768 / 768 | 0.727 |
| 390x844 | 778 / 390 | 390 / 390 | 0.369 |

## Screenshots

- `e2e-full/fix-responsive-768x1024-in-iframe.jpg` (the whole app fits the 768 wide frame).
- 1280x800 and 390x844 screenshots were not written (only numeric measurement); 1280 is unchanged by construction (scale(1)) and by the numbers above, but no pixel diff was done.

## Remaining issues, not fixed

- At 390 wide the scene is at 37% scale: text (chat, title bar) is tiny and touch targets are well below 44px. A real mobile layout (stacked scene and chat) would need a separate design.
- Pointer/drag code that uses `offsetX`/client deltas inside the scaled window (e.g. PlacementHelper) was not checked under scale < 1.
- Tall-and-narrow viewports leave large empty bands above and below the scaled window.
