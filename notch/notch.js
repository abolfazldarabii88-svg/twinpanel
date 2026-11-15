(() => {
  const face = document.querySelector("#face");
  const eyes = [...document.querySelectorAll(".eye")];
  const buttons = [...document.querySelectorAll("[data-action]")];
  let blinkTimer;
  let workingTimer;
  const setExpression = name => {
    face.dataset.expression = name;
    buttons.forEach(button => button.classList.toggle("active", button.dataset.action === name));
    if (name === "working") {
      clearTimeout(workingTimer);
      workingTimer = setTimeout(() => setExpression("playful"), 3400);
      setTimeout(() => { if (face.dataset.expression === "playful") setExpression("normal"); }, 5000);
    }
  };
  const blink = () => {
    if (!["working", "dizzy"].includes(face.dataset.expression)) {
      face.classList.add("blink");
      setTimeout(() => face.classList.remove("blink"), 190);
    }
    scheduleBlink();
  };
  const scheduleBlink = () => {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(blink, 2600 + Math.random() * 3000);
  };
  document.addEventListener("pointermove", event => {
    const bounds = face.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const dx = Math.max(-5, Math.min(5, (event.clientX - centerX) / 24));
    const dy = Math.max(-4, Math.min(4, (event.clientY - centerY) / 30));
    eyes.forEach((eye, index) => {
      eye.style.setProperty("--gaze-x", (dx * (index ? .88 : 1)).toFixed(2) + "px");
      eye.style.setProperty("--gaze-y", dy.toFixed(2) + "px");
    });
  }, { passive: true });
  buttons.forEach(button => button.addEventListener("click", () => setExpression(button.dataset.action)));
  setExpression("normal");
  scheduleBlink();
})();
