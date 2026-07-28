// sp3ctr-zone :: shared site behavior
// no dependencies, no build step — this is the whole thing.

const GLYPHS = "!<>-_\\/[]{}=+*^?#01";
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Progressively reveals `finalText` inside `el`, cycling random glyphs
// over the not-yet-revealed characters. Skips straight to the end
// result if the visitor has asked for reduced motion.
function scramble(el, finalText, { frame = 35, reveal = 2 } = {}) {
  clearInterval(el._scrambleTimer);

  if (prefersReducedMotion) {
    el.textContent = finalText;
    return;
  }

  let revealedChars = 0;
  el._scrambleTimer = setInterval(() => {
    revealedChars += reveal;

    el.textContent = finalText
      .split("")
      .map((char, index) => {
        if (char === " " || char === "\n") return char;
        if (index < revealedChars) return char;
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      })
      .join("");

    if (revealedChars >= finalText.length) clearInterval(el._scrambleTimer);
  }, frame);
}

// Scramble the wordmark into place once, on load.
document.querySelectorAll("[data-scramble-in]").forEach((el) => {
  const text = el.textContent;
  scramble(el, text, { frame: 30, reveal: 1 });
});

// Live status-line clock.
const clock = document.querySelector("[data-clock]");
if (clock) {
  const tick = () => { clock.textContent = new Date().toTimeString().slice(0, 8); };
  tick();
  setInterval(tick, 1000);
}
