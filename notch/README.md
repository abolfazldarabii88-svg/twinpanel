# TwinPanel Notch Character Lab

An isolated first-pass visual prototype for the new TwinPanel notch, built with plain HTML, CSS and JavaScript. It does not alter the existing TwinPanel application entry point.

## Included in this slice

- A top-edge attached black notch with rounded lower corners.
- A larger transparent shadow area so the ambient shadow is not clipped by the visible body.
- Solid white eyes without pupils, with a restrained white glow.
- Smooth automatic blinking and pointer-following gaze inside the preview surface.
- Normal, wink, playful, sleepy, angry (red), dizzy spiral and start-working expression states.
- A staged start-working sequence, followed by playful and normal states.
- Reduced-motion preference support.

## Deliberate limitations

This is a browser preview, not yet a native desktop overlay. Pointer tracking currently uses pointer events inside the preview window; global Windows cursor coordinates need a native Electron bridge in the next integration slice. The preview controls are for development only and will not ship in the final notch UI.

## Run

Open `index.html` in a browser. No external assets, icon images, dependencies or network requests are needed.

## Next engineering steps

1. Review the character silhouette and animation timing against the hand-drawn reference.
2. Port the preview into a dedicated transparent Electron BrowserWindow, keeping the visible notch bounds separate from the larger shadow bounds.
3. Add native global cursor tracking and precise hit-testing against the visible black notch only.
4. Test the overlay on Windows at multiple DPI scales and monitor sizes.
