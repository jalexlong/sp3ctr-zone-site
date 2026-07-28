// sp3ctr-zone :: sealed text, end to end
//
// js/cipher.js is the part that meets the visitor: it seals every [data-seal]
// region on load, then decrypts and reseals as they hover, tab and tap. These
// tests build the two shapes of markup the site actually ships and drive the
// real event handlers against them.
//
//   the log page       a <span data-seal> of one line, inside the <a> that is
//                      the whole entry. The region has no block children, so
//                      it is its own single block — which is subtle enough to
//                      have caused a regression, and is why it's tested apart
//                      from the shape below.
//
//   a transmission     a <div data-seal> of several <p>s, each scrambling on
//                      its own clock so the page decrypts in a cascade.
//
// What's being checked throughout is the one promise the effect makes: the
// plaintext is never on screen except when the visitor has asked for it and the
// run has got that far. Everything else is decoration.

const test = require("node:test");
const assert = require("node:assert");
const { tree, open } = require("./harness");

// All letters and spaces, so any match against it is real. See sweep.test.js.
const PLAIN = "the signal came through at dusk and nobody wanted to say what it meant";
const LINES = ["one " + PLAIN, "two " + PLAIN, "three " + PLAIN];

// The log page: an entry link wrapping a one-line sealed preview.
function logPage() {
  const region = tree("span", { attrs: { "data-seal": "" } }, [PLAIN]);
  const trigger = tree("a", { attrs: { "data-cipher-trigger": "" } }, [region]);
  return { trigger, region, browser: open(trigger) };
}

// A transmission page: a sealed body of paragraphs that decrypts on arrival.
function transmissionPage() {
  const blocks = LINES.map((line) => tree("p", {}, [line]));
  const region = tree("div", { attrs: { "data-seal": "", "data-decrypt-on-load": "" } }, blocks);
  return { region, blocks, browser: open(region) };
}

// --- on load ---------------------------------------------------------------

// The markup ships as ordinary readable HTML so the site degrades to plain
// prose with JS off. With JS on, the seal has to land before anything is shown —
// the stylesheet hides the region until it carries a state for exactly this
// reason, and this is the other half of that bargain.
test("a region is sealed by the time the script returns", () => {
  const { region } = logPage();
  const sealed = region.text();

  assert.notEqual(sealed, PLAIN);
  assert.equal(sealed.length, PLAIN.length);
  assert.equal(region.dataset.state, "cipher");
});

test("every block of a transmission body is sealed on load", () => {
  const { blocks } = transmissionPage();
  blocks.forEach((block, i) => assert.notEqual(block.text(), LINES[i]));
});

// --- hover and focus -------------------------------------------------------

test("hovering an entry decrypts its preview", () => {
  const { trigger, region, browser } = logPage();
  trigger.fire("mouseenter");
  browser.settle();
  assert.equal(region.text(), PLAIN);
  assert.equal(region.dataset.state, "plain");
});

test("leaving an entry reseals it", () => {
  const { trigger, region, browser } = logPage();
  trigger.fire("mouseenter");
  browser.settle();

  trigger.fire("mouseleave");
  browser.settle();

  assert.notEqual(region.text(), PLAIN);
  assert.equal(region.dataset.state, "cipher");
});

// The regression that shipped: on the log page the region has no block children,
// so cipher.js treats the region as its own single block — `block.el` and the
// region are the same element. A guard in `seal()` that read the block's state
// off that element saw the flag `seal()` had just set on the region, decided
// there was nothing to take back, and returned. Hovering worked; leaving did
// nothing, and the preview stayed readable for good.
//
// Asserting on the frame count is what makes this bite: the broken version left
// the text alone, which is a state a lazy assertion about "not the plaintext"
// could still be talked into accepting.
test("resealing a preview actually runs a sweep", () => {
  const { trigger, region, browser } = logPage();
  trigger.fire("mouseenter");
  browser.settle();

  trigger.fire("mouseleave");
  const frames = browser.settle();

  assert.ok(frames > 5, `expected a sweep, got ${frames} frames`);
  assert.notEqual(region.text(), PLAIN);
});

test("the decrypt/reseal cycle repeats", () => {
  const { trigger, region, browser } = logPage();

  for (let round = 0; round < 3; round++) {
    trigger.fire("mouseenter");
    browser.settle();
    assert.equal(region.text(), PLAIN, `round ${round} failed to decrypt`);

    trigger.fire("mouseleave");
    browser.settle();
    assert.notEqual(region.text(), PLAIN, `round ${round} failed to reseal`);
  }
});

// Keyboard visitors get the same thing through focus and blur, since the entry
// is a link and tabbing to it is how it's reached without a pointer.
test("focus and blur work like hover", () => {
  const { trigger, region, browser } = logPage();

  trigger.fire("focus");
  browser.settle();
  assert.equal(region.text(), PLAIN);

  trigger.fire("blur");
  browser.settle();
  assert.notEqual(region.text(), PLAIN);
});

// --- leaving early ---------------------------------------------------------

test("leaving mid-decrypt never reveals the rest of the line", () => {
  const { trigger, region, browser } = logPage();

  trigger.fire("mouseenter");
  for (let i = 0; i < 6; i++) browser.tick();

  // What the visitor has actually seen so far: the leading characters that
  // already match the plaintext.
  const partial = region.text();
  let revealed = 0;
  while (revealed < PLAIN.length && partial[revealed] === PLAIN[revealed]) revealed++;
  assert.ok(revealed < PLAIN.length, "the decrypt finished before it could be interrupted");

  trigger.fire("mouseleave");
  browser.settleWatching(region, (now) => {
    assert.notEqual(now, PLAIN, "the whole line appeared on the way out");
    assert.notEqual(
      now.slice(revealed),
      PLAIN.slice(revealed),
      "the unread tail appeared on the way out",
    );
  });

  assert.notEqual(region.text(), PLAIN);
});

// cipher.js schedules each block's decrypt on a timer, so a pointer that
// arrives and leaves inside one frame reaches `seal()` before the decrypt has
// begun. The block never left the ciphertext, so there is nothing to take back —
// and running a seal over it anyway would paint the plaintext first, purely to
// have something to scramble.
test("hovering and leaving in the same instant never flashes the plaintext", () => {
  const { trigger, region, browser } = logPage();

  trigger.fire("mouseenter");
  trigger.fire("mouseleave");

  browser.settleWatching(region, (now) => {
    assert.notEqual(now, PLAIN, "plaintext flashed after a glancing hover");
  });
  assert.notEqual(region.text(), PLAIN);
});

// --- a transmission page ---------------------------------------------------

// The body decrypts itself on arrival, held back long enough for the boot flash
// to clear, and each block starts after the one before it.
test("a transmission body decrypts itself, block by block", () => {
  const { blocks, browser } = transmissionPage();

  browser.settle();
  blocks.forEach((block, i) => assert.equal(block.text(), LINES[i]));
});

test("a transmission body decrypts in a cascade, not all at once", () => {
  const { blocks, browser } = transmissionPage();

  // Somewhere in the middle of the run, the first block must be further along
  // than the last — otherwise the whole wall is moving together.
  let staggered = false;
  browser.settleWatching(blocks[0], () => {
    const lead = matching(blocks[0].text(), LINES[0]);
    const trail = matching(blocks[2].text(), LINES[2]);
    if (lead > trail) staggered = true;
  });

  assert.ok(staggered, "every block decrypted on the same clock");
});

// --- touch -----------------------------------------------------------------
//
// A touchscreen has no hover. The tap highlight fires no event of its own, and
// the browser only synthesises mouseenter at the end of a tap, an instant before
// it follows the link — so the decrypt would never be seen. A finger gets a
// two-step instead: the first tap decrypts where it stands, the second opens.

test("the first tap decrypts instead of following the link", () => {
  const { trigger, region, browser } = logPage();

  trigger.fire("pointerdown", { pointerType: "touch" });
  let defaulted = true;
  trigger.fire("click", {
    pointerType: "touch",
    preventDefault: () => (defaulted = false),
  });

  browser.settle();
  assert.equal(defaulted, false, "the first tap followed the link");
  assert.equal(region.text(), PLAIN);
});

test("the second tap follows the link", () => {
  const { trigger, region, browser } = logPage();

  trigger.fire("pointerdown", { pointerType: "touch" });
  trigger.fire("click", { pointerType: "touch", preventDefault() {} });
  browser.settle();
  assert.equal(region.text(), PLAIN);

  trigger.fire("pointerdown", { pointerType: "touch" });
  let defaulted = true;
  trigger.fire("click", {
    pointerType: "touch",
    preventDefault: () => (defaulted = false),
  });

  assert.equal(defaulted, true, "the second tap was swallowed instead of opening");
});

// A mouse click is never swallowed — the two-step is for fingers only, and a
// desktop visitor who clicks an entry expects to arrive at the transmission.
test("a mouse click follows the link", () => {
  const { trigger } = logPage();

  trigger.fire("pointerdown", { pointerType: "mouse" });
  let defaulted = true;
  trigger.fire("click", {
    pointerType: "mouse",
    preventDefault: () => (defaulted = false),
  });

  assert.equal(defaulted, true, "a mouse click was swallowed");
});

// How many leading characters of `now` read as the plaintext — a rough measure
// of how far a decrypt has got. Only meaningful because the plaintext here is
// letters and spaces, which the glyph vocabulary can't produce.
function matching(now, plain) {
  let at = 0;
  while (at < plain.length && now[at] === plain[at]) at++;
  return at;
}
