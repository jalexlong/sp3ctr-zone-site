// sp3ctr-zone :: the sweep engine
//
// js/site.js drives every scramble on the site through one function, `sweep`. A
// run walks a wavefront from the first character to the last; `behind` says
// where a character's value comes from once the front has passed it, `ahead`
// where it comes from while the front is still approaching, and `settle` is
// what the whole thing snaps to when the front runs off the end.
//
// These tests call it through the two wrappers the site uses — `decryptText`
// and `sealText` — with no DOM involved at all: `target` is just an object with
// a `paint` method, which is the entire contract a sweep has with the page.
//
// The property that matters, and the one that has been broken twice, is what
// happens *between* frames rather than at the end of them. Both wrappers get
// their end state right trivially. It's the frames in the middle that leak.

const test = require("node:test");
const assert = require("node:assert");
const { element, open } = require("./harness");

// Deliberately all letters and spaces: the glyph vocabulary the cipher scrambles
// with is punctuation and digits, so a character matching the plaintext at some
// position can only mean the plaintext is actually showing there, never a lucky
// random roll. Tests below rely on that.
const PLAIN = "the signal came through at dusk and nobody wanted to say what it meant";

// The engine alone — no cipher.js, since nothing here needs a page.
function engine() {
  const browser = open(element("body"), { scripts: ["site.js"] });
  let painted = "";
  const target = { paint: (next) => (painted = next) };
  return { browser, target, seen: () => painted };
}

test("a decrypt ends on the plaintext", () => {
  const { browser, target, seen } = engine();
  browser.window.decryptText(target, PLAIN, { step: 2 });
  browser.settle();
  assert.equal(seen(), PLAIN);
});

test("a decrypt never shows the plaintext early", () => {
  const { browser, target, seen } = engine();
  browser.window.decryptText(target, PLAIN, { step: 2 });

  // Every frame but the last must differ from the plaintext somewhere: the
  // point of the effect is that the line assembles, rather than appearing.
  let frames = 0;
  let earlyFull = 0;
  while (!browser.idle()) {
    browser.tick();
    frames++;
    if (seen() === PLAIN && !browser.idle()) earlyFull++;
  }

  assert.ok(frames > 5, `expected a gradual run, got ${frames} frames`);
  assert.equal(earlyFull, 0, "plaintext appeared before the run finished");
});

test("a seal ends on the ciphertext, not the plaintext", () => {
  const { browser, target, seen } = engine();
  const cipher = browser.window.garble(PLAIN);

  browser.window.decryptText(target, PLAIN, { step: 2 });
  browser.settle();
  browser.window.sealText(target, PLAIN, cipher, { step: 2 });
  browser.settle();

  assert.equal(seen(), cipher);
});

// The regression this file exists for.
//
// `sealText`'s `ahead` side is the plaintext — that's what makes the scramble
// spread outwards from the front instead of running backwards — and `sweep`
// writes the whole `ahead` side on frame zero. So a seal that interrupted a
// half-finished decrypt used to paint the entire line in plaintext for one
// frame before starting to bury it: walk away from a transmission early and it
// would hand you the ending on the way out.
test("sealing a half-finished decrypt never reveals the rest", () => {
  for (const frames of [0, 1, 3, 8, 20]) {
    const { browser, target, seen } = engine();
    const cipher = browser.window.garble(PLAIN);

    browser.window.decryptText(target, PLAIN, { step: 2 });
    for (let i = 0; i < frames; i++) browser.tick();

    // How far the decrypt got. Everything past this is text the visitor has
    // not seen and must not see.
    const reach = target.run.reach;
    browser.window.sealText(target, PLAIN, cipher, { step: 2 });

    while (!browser.idle()) {
      browser.tick();
      const now = seen();
      if (now === cipher) break; // settled

      assert.notEqual(now, PLAIN, `whole line revealed after ${frames} frames of decrypt`);
      const tail = PLAIN.slice(reach);
      assert.notEqual(
        now.slice(reach),
        tail,
        `unread tail revealed after ${frames} frames of decrypt`,
      );
    }

    assert.equal(seen(), cipher, `never settled after ${frames} frames of decrypt`);
  }
});

// Taking back only what was revealed also means taking back only as much time.
// Graze an entry and it snaps shut; read half of it and burying it takes half
// the sweep. Same `step`, so the frame count is a direct read of the distance
// the front travelled.
test("a seal is as long as the decrypt it interrupts", () => {
  const lengths = [4, 12, 30].map((frames) => {
    const { browser, target } = engine();
    const cipher = browser.window.garble(PLAIN);

    browser.window.decryptText(target, PLAIN, { step: 2 });
    for (let i = 0; i < frames; i++) browser.tick();

    browser.window.sealText(target, PLAIN, cipher, { step: 2 });
    return browser.settle();
  });

  assert.ok(
    lengths[0] < lengths[1] && lengths[1] < lengths[2],
    `expected seals to lengthen with the decrypt, got ${lengths.join(", ")}`,
  );
});

// A seal that follows a *finished* decrypt has a whole line to take back and
// must still sweep all of it — the shortening above is a response to being
// interrupted, not a change to the effect itself.
test("a seal after a finished decrypt still sweeps the whole line", () => {
  const { browser, target } = engine();
  const cipher = browser.window.garble(PLAIN);

  browser.window.decryptText(target, PLAIN, { step: 2 });
  const decryptFrames = browser.settle();

  browser.window.sealText(target, PLAIN, cipher, { step: 2 });
  const sealFrames = browser.settle();

  assert.equal(sealFrames, decryptFrames);
});

// Whitespace is never scrambled — it's what keeps the ciphertext's word shapes,
// so a sealed paragraph reads as redacted rather than as noise — and it's also
// what the wrapping fix in the stylesheet leans on: if spaces stay put, and
// they're the only place a line may break, the layout can't move under a run.
test("a scramble leaves every space exactly where it was", () => {
  const { browser, target, seen } = engine();
  const cipher = browser.window.garble(PLAIN);
  const spaces = [...PLAIN].map((c, i) => (c === " " ? i : -1)).filter((i) => i >= 0);

  assert.deepEqual(
    [...cipher].map((c, i) => (c === " " ? i : -1)).filter((i) => i >= 0),
    spaces,
  );

  browser.window.decryptText(target, PLAIN, { step: 2 });
  while (!browser.idle()) {
    browser.tick();
    const now = seen();
    assert.equal(now.length, PLAIN.length, "a frame changed the character count");
    for (const at of spaces) assert.equal(now[at], " ", `a frame moved the space at ${at}`);
  }
});

// With reduced motion preferred there is no wavefront at all: a run paints its
// end state and is done, so the page never animates.
test("reduced motion settles immediately", () => {
  const browser = open(element("body"), { scripts: ["site.js"], reducedMotion: true });
  let painted = "";
  const target = { paint: (next) => (painted = next) };

  browser.window.decryptText(target, PLAIN, { step: 2 });
  assert.equal(painted, PLAIN);
  assert.ok(browser.idle(), "reduced motion still queued frames");
});
