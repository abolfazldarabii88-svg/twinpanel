const notch = document.querySelector("#notch");
const irises = document.querySelectorAll(".iris");
let blinkTimer;

function blink() {
  notch.classList.add("blink");
  window.setTimeout(() => notch.classList.remove("blink"), 190);
  scheduleBlink();
}

function scheduleBlink() {
  window.clearTimeout(blinkTimer);
  blinkTimer = window.setTimeout(blink, 2600 + Math.random() * 3600);
}

window.addEventListener("pointermove", (event) => {
  const bounds = notch.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const dx = Math.max(-3, Math.min(3, (event.clientX - centerX) / 65));
  const dy = Math.max(-2, Math.min(2, (event.clientY - centerY) / 80));
  irises.forEach((iris) => {
    iris.style.setProperty("--gaze-x", dx.toFixed(1) + "px");
    iris.style.setProperty("--gaze-y", dy.toFixed(1) + "px");
  });
});

scheduleBlink();
