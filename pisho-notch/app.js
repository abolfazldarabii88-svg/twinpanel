const notch = document.querySelector("#notch");
const eyes = document.querySelectorAll(".eye");
let blinkTimer;

function blink() {
  notch.classList.add("blink");
  window.setTimeout(() => notch.classList.remove("blink"), 210);
  scheduleBlink();
}

function scheduleBlink() {
  window.clearTimeout(blinkTimer);
  blinkTimer = window.setTimeout(blink, 2800 + Math.random() * 4200);
}

// Native Windows cursor tracking keeps Pisho's gaze responsive even when
// the pointer is nowhere near the small notch window.
const tauriEvent = window.__TAURI__?.event;
if (tauriEvent?.listen) {
  tauriEvent.listen("pisho-gaze", ({ payload }) => {
    const [x, y] = payload;
    eyes.forEach((eye, index) => {
      const offset = index === 0 ? -0.6 : 0.6;
      eye.style.setProperty("--gaze-x", (x + offset).toFixed(2) + "px");
      eye.style.setProperty("--gaze-y", y.toFixed(2) + "px");
    });
  });
}

scheduleBlink();
