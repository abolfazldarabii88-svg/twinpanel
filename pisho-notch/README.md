# Pisho Notch

A tiny transparent Windows desktop overlay with animated cat-like eyes.

## Current Windows prototype

- A compact 200 × 72 logical-pixel overlay.
- Positioned near the top-center of the primary display.
- Native desktop window configured as always-on-top, borderless, transparent, and hidden from the taskbar.
- Two luminous cyan eyes with idle motion and automatic blinking.
- Pupils follow the pointer while it is over the overlay.
- No API keys, network calls, telemetry, or background service.

## Build the Windows installer

The GitHub Actions workflow at `.github/workflows/pisho-notch-windows.yml` builds an NSIS installer on a Windows runner.

1. Open the repository's **Actions** tab.
2. Select **Build Pisho Notch for Windows**.
3. Choose **Run workflow** on branch `feature/pisho-notch-prototype`.
4. When the run succeeds, download the `Pisho-Notch-Windows-Installer` artifact.

The installer is a CI artifact, not yet a published GitHub Release.

## Notes

- The overlay does not replace or hide the Windows taskbar.
- The initial version is deliberately limited to appearance and positioning.
- Pointer tracking currently responds while the pointer is over the overlay; global desktop pointer tracking can be added separately.
- RAM/CPU use and behavior across multiple monitors still need testing on a real Windows machine.
