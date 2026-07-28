// sp3ctr-zone :: shared site behavior
// no dependencies, no build step — this is the whole thing.

const GLYPHS = "!<>-_\\/[]{}=+*^?#01";
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];

// Stands in for a side of the wavefront whose characters are re-rolled every
// frame, as opposed to a side that reads from a fixed string.
const CHURN = Symbol("churn");

// Ciphertext for a run of plaintext. Whitespace stays exactly where it was, so
// the sealed version keeps the original's word shapes and line breaks and reads
// like a redacted document rather than a wall of noise.
function garble(text) {
  return text
    .split("")
    .map((char) => (/\s/.test(char) ? char : randomGlyph()))
    .join("");
}

// Grabs an element's text nodes once, so an effect can rewrite the characters
// in place without flattening whatever markup they sit inside — a link or an
// <em> in the middle of a paragraph survives the scramble intact.
function textTarget(el) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);

  const lengths = nodes.map((node) => node.data.length);

  return {
    text: nodes.map((node) => node.data).join(""),
    paint(next) {
      let at = 0;
      nodes.forEach((node, index) => {
        node.data = next.slice(at, at + lengths[index]);
        at += lengths[index];
      });
    },
  };
}

// One animation loop drives every sweep running on the page. Sharing it means
// all the text a frame touches is rewritten together — one layout pass instead
// of one per paragraph — and because it's requestAnimationFrame rather than
// setInterval, a backgrounded tab stops the work outright instead of quietly
// scrambling text nobody is looking at.
const sweeps = new Set();
let looping = false;

function pump(now) {
  for (const run of sweeps) {
    if (now < run.due) continue;
    run.due = now + run.frame;
    run.advance();
  }

  looping = sweeps.size > 0;
  if (looping) requestAnimationFrame(pump);
}

// Runs a wavefront from the first character to the last. `behind` says where a
// character's value comes from once the front has gone by it, `ahead` where it
// comes from while the front is still approaching: either a fixed string, or
// CHURN for a side that re-rolls every frame — and that churn is what makes a
// stretch of text read as actively scrambling rather than merely wrong. When the
// front runs off the end, the run snaps to `settle` and stops.
function sweep(target, { shape, behind, ahead, settle, frame = 35, step = 2 }) {
  sweeps.delete(target.run);

  if (prefersReducedMotion) {
    target.paint(settle);
    return;
  }

  // Everything the frame loop needs is worked out once, here: the characters,
  // and the positions allowed to change — whitespace never moves, which is what
  // keeps the ciphertext's word shapes. Per frame this then costs writes into an
  // array that already exists, rather than re-splitting the string and
  // re-testing every character for whitespace sixty times a second.
  const buffer = [...shape];
  const movable = [];
  for (let index = 0; index < buffer.length; index++) {
    if (!/\s/.test(buffer[index])) movable.push(index);
  }

  // Frame zero: the front has covered nothing, so every position shows its
  // `ahead` value. When `ahead` is a fixed string, this is the only time those
  // positions are written at all.
  for (const index of movable) {
    buffer[index] = ahead === CHURN ? randomGlyph() : ahead[index];
  }

  let front = 0; // characters the front has covered
  let crossed = 0; // how far into `movable` that reaches

  const run = {
    frame,
    due: 0,
    advance() {
      front += step;

      if (front >= shape.length) {
        sweeps.delete(run);
        target.paint(settle);
        return;
      }

      const wasCrossed = crossed;
      while (crossed < movable.length && movable[crossed] < front) crossed++;

      // Only the churning side is rewritten each frame. A settled side gets
      // written once, as the front goes past it, and is then left alone.
      if (behind === CHURN) {
        for (let at = 0; at < crossed; at++) buffer[movable[at]] = randomGlyph();
      } else {
        for (let at = wasCrossed; at < crossed; at++) buffer[movable[at]] = behind[movable[at]];
      }

      if (ahead === CHURN) {
        for (let at = crossed; at < movable.length; at++) buffer[movable[at]] = randomGlyph();
      }

      target.paint(buffer.join(""));
    },
  };

  target.run = run;
  sweeps.add(run);

  if (!looping) {
    looping = true;
    requestAnimationFrame(pump);
  }
}

// Decrypting: plaintext trails the front, glyph churn runs ahead of it.
function decryptText(target, plain, options) {
  sweep(target, { shape: plain, behind: plain, ahead: CHURN, settle: plain, ...options });
}

// Re-sealing is deliberately not the decrypt run backwards. The front leaves
// churn *behind* it and leaves plaintext ahead, so the scramble spreads a
// character at a time until the whole run is moving — and only once the front
// has taken all of it does the text freeze into `cipher` and come to rest.
function sealText(target, plain, cipher, options) {
  sweep(target, { shape: plain, behind: CHURN, ahead: plain, settle: cipher, ...options });
}

// How many characters the front should cover per frame for a run of `length` to
// finish in roughly `frames` frames — a long paragraph and a short one then take
// about the same couple of seconds instead of the long one crawling.
const paceFor = (length, frames) => Math.max(1, Math.ceil(length / frames));

// The CRT atmosphere is full-screen and never stops moving, and that — not the
// scrambling text — is nearly all of what this page costs to run: every frame
// any of it asks for is a full-viewport composite through a blend layer, a
// vignette and a scanline grid. None of that is worth a single frame while the
// window is in the background, so it all pauses on blur and picks up exactly
// where it left off on focus. Nothing changes for anyone actually looking at it.
const setIdle = (idle) => document.documentElement.toggleAttribute("data-idle", idle);
addEventListener("blur", () => setIdle(true));
addEventListener("focus", () => setIdle(false));
document.addEventListener("visibilitychange", () => setIdle(document.hidden));
// only the hidden case is checked up front: some browsers report no focus for a
// freshly loaded window, and starting a visible page with its atmosphere frozen
// would read as broken rather than as thrifty.
setIdle(document.hidden);

// The CRT switch in the titlebar. Which state the page loads in was already
// decided by the inline script in <head> — before the first paint, so the tube
// can't flash on and then vanish. This only wires up the control and remembers
// what the visitor picks.
const crtToggle = document.querySelector("[data-crt-toggle]");
if (crtToggle) {
  const isOn = () => document.documentElement.dataset.crt !== "off";

  const label = () => {
    crtToggle.textContent = `CRT: ${isOn() ? "ON" : "OFF"}`;
    crtToggle.setAttribute("aria-pressed", String(isOn()));
  };

  crtToggle.addEventListener("click", () => {
    const turningOff = isOn();
    if (turningOff) document.documentElement.dataset.crt = "off";
    else delete document.documentElement.dataset.crt;

    try {
      localStorage.setItem("sp3ctr:crt", turningOff ? "off" : "on");
    } catch (e) {
      // storage is off limits in this browser; the choice just won't outlive
      // the page, which is better than throwing on a click.
    }
    label();
  });

  label();
}

// Scramble the wordmark into place once, on load.
document.querySelectorAll("[data-scramble-in]").forEach((el) => {
  const target = textTarget(el);
  decryptText(target, target.text, { frame: 30, step: 1 });
});

// Live status-line clock, prefixed with the viewer's timezone code (EDT, CEST,
// …; zones without an abbreviation fall back to a GMT offset). The code is
// resolved on every tick rather than cached once, so a page left open across a
// DST rollover corrects itself.
const clock = document.querySelector("[data-clock]");
if (clock) {
  const zoneFormat = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" });
  const zone = (date) =>
    zoneFormat.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";

  const tick = () => {
    const now = new Date();
    clock.textContent = `${zone(now)} ${now.toTimeString().slice(0, 8)}`;
  };
  tick();
  setInterval(tick, 1000);
}
