// sp3ctr-zone :: a fake browser, just big enough for the cipher
//
// `npm test` — node's own test runner, no dependencies, same as the rest of the
// repo. The suites are test/sweep.test.js and test/cipher.test.js.
//
// WHY THIS EXISTS
//
// js/site.js and js/cipher.js are plain <script> files: no modules, no exports,
// no build step. That's the whole point of the site — view-source and it's all
// there — but it means the usual `require("../js/cipher.js")` doesn't work, and
// there's nothing to import even if it did.
//
// So instead of loading the code, this loads the *page*. It builds a small
// object graph that looks enough like a DOM, drops it into a Node `vm` context
// alongside fake versions of the handful of browser globals the scripts touch,
// and evaluates the real source files there, unmodified. Because a plain script
// declares its top-level functions on the global object, `sweep`, `garble`,
// `decryptText` and the rest all end up as properties of the sandbox, callable
// straight from a test.
//
// Nothing here patches, stubs or reimplements any part of the site. If a test
// passes, it passed against the same characters that ship.
//
// THE PART THAT MAKES IT WORTH DOING
//
// `requestAnimationFrame` and `setTimeout` are queues, not schedulers. Nothing
// runs until a test calls `tick()`, and then exactly one frame's worth runs. An
// animation that would take two seconds of staring in a browser takes 38 calls
// here, and a test can read the text back after any one of them. That's what
// makes it possible to assert things like "on no frame between leaving and
// resting does the rest of the sentence appear" — the interesting bugs in this
// code have all been single-frame flashes, which are exactly what you can't
// catch by looking.
//
// WHAT IT DOESN'T DO
//
// There is no layout, no CSS, no fonts, no line breaking, and no real event
// dispatch (no bubbling, no capture, no default actions). This tests the logic
// of the scramble and nothing about how it looks. Anything to do with wrapping,
// spacing or jitter has to be checked in a real browser.
//
// The fake DOM implements only the methods the site actually calls. Adding a
// new DOM call to js/ means adding it here too, and a test failing with
// "x is not a function" usually means exactly that.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS_DIR = path.join(__dirname, "..", "js");

// --- the DOM ---------------------------------------------------------------

// A text node. `data` is the live character content: the cipher rewrites these
// strings in place, so reading one back after a frame is reading exactly what a
// visitor would see on screen.
function text(data) {
  return { nodeType: 3, data };
}

// Parses the selectors the site actually uses — a comma-separated list whose
// members are either a tag name (`p`, `li`) or a bare attribute (`[data-seal]`).
// Anything fancier would need a real parser, and there isn't anything fancier.
function matcher(selector) {
  const terms = selector.split(",").map((term) => term.trim());
  return (el) =>
    terms.some((term) =>
      term.startsWith("[") ? term.slice(1, -1) in el.attrs : el.tag === term,
    );
}

function descendants(el, out = []) {
  for (const kid of el.kids) {
    if (!kid.tag) continue;
    out.push(kid);
    descendants(kid, out);
  }
  return out;
}

// An element. `attrs` are plain attributes, `dataset` is the data-* view the
// site uses to carry state; the two are kept separate here because the site
// only ever reads attributes it set in the markup and only ever writes dataset,
// so nothing needs them to stay in sync.
function element(tag, { attrs = {}, dataset = {}, kids = [] } = {}) {
  const el = {
    tag,
    attrs,
    dataset,
    kids,
    parent: null,
    listeners: {},

    querySelectorAll(selector) {
      return descendants(this).filter(matcher(selector));
    },
    closest(selector) {
      const matches = matcher(selector);
      for (let el = this; el; el = el.parent) if (matches(el)) return el;
      return null;
    },
    contains(other) {
      for (let el = other; el; el = el.parent) if (el === this) return true;
      return false;
    },
    hasAttribute(name) {
      return name in this.attrs;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    toggleAttribute(name, force) {
      const on = force ?? !(name in this.attrs);
      if (on) this.attrs[name] = "";
      else delete this.attrs[name];
      return on;
    },

    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    // Calls the listeners registered for `type` on this element only. Real
    // events bubble and can be defaulted or prevented; nothing in the cipher
    // depends on either, so neither is modelled. `event` fills in whatever
    // properties the handler under test reads — `pointerType`, say.
    fire(type, event = {}) {
      const dispatched = { type, target: this, preventDefault() {}, ...event };
      (this.listeners[type] ?? []).forEach((fn) => fn(dispatched));
      return dispatched;
    },

    // Everything a visitor would read off this element, in order.
    text() {
      return this.kids.map((kid) => (kid.tag ? kid.text() : kid.data)).join("");
    },
  };

  for (const kid of kids) if (kid.tag) kid.parent = el;
  return el;
}

// Builds a subtree from a nested description, wiring up parents:
//   tree("a", { attrs: { "data-cipher-trigger": "" } }, [
//     tree("span", { attrs: { "data-seal": "" } }, ["some plaintext"]),
//   ])
// Strings become text nodes.
function tree(tag, options = {}, children = []) {
  const kids = children.map((kid) => (typeof kid === "string" ? text(kid) : kid));
  return element(tag, { ...options, kids });
}

// --- the browser -----------------------------------------------------------

// Loads the site against `root` and hands back the sandbox plus the controls
// for driving time. `root` stands in for the document body: the fake
// `document.querySelectorAll` searches it, so whatever the test built is what
// the scripts find on load. `scripts` names the files under js/ to evaluate, in
// order; `reducedMotion` flips the media query the site checks, which makes
// every sweep jump straight to its end state instead of animating.
function open(root, { scripts = ["site.js", "cipher.js"], reducedMotion = false } = {}) {
  let frame = []; // requestAnimationFrame callbacks awaiting the next tick
  const timers = []; // setTimeout entries, fired once their delay has elapsed
  let now = 0;

  const noop = () => {};
  const documentElement = element("html");

  // `root` is given a body to sit in so that a document-wide search can match
  // the root itself — a transmission page's [data-seal] region *is* the root of
  // what the test built, and an element's own querySelectorAll only ever looks
  // at its descendants.
  const body = element("body", { kids: [root] });

  const window = {
    document: {
      documentElement,
      hidden: false,
      body,
      querySelectorAll: (selector) => body.querySelectorAll(selector),
      querySelector: (selector) => body.querySelectorAll(selector)[0] ?? null,
      addEventListener: noop,
      // The site walks an element's text nodes to rewrite them without
      // flattening the markup around them; this returns them in document order,
      // which is all `textTarget` asks of it.
      createTreeWalker(el) {
        const nodes = [];
        (function visit(node) {
          for (const kid of node.kids) kid.tag ? visit(kid) : nodes.push(kid);
        })(el);
        let at = 0;
        return { nextNode: () => nodes[at++] ?? null };
      },
    },
    NodeFilter: { SHOW_TEXT: 4 },

    // The site asks exactly one question of this — whether reduced motion is
    // preferred — and reads the answer once, at load.
    matchMedia: () => ({ matches: reducedMotion, addEventListener: noop, addListener: noop }),

    // The two queues. Neither runs anything on its own; `tick()` drains them.
    requestAnimationFrame: (fn) => frame.push(fn),
    setTimeout: (fn, delay = 0) => timers.push({ fn, due: now + delay }) - 1,
    clearTimeout: (id) => {
      if (timers[id]) timers[id].cancelled = true;
    },
    setInterval: noop, // only the status-line clock, which no test builds

    addEventListener: noop, // window-level focus/blur, for the idle class
    localStorage: { getItem: () => null, setItem: noop },
    console,
    Intl,
    Date,
    Math,
  };

  vm.createContext(window);
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, script), "utf8"), window, {
      filename: `js/${script}`, // so a stack trace points at the real file
    });
  }

  return {
    window,
    root,

    // One frame. Timers whose delay has elapsed fire first — that's the order a
    // browser uses, and it matters: cipher.js schedules each block's decrypt on
    // a timeout, so a frame that ran first would see a block that hasn't
    // started yet. The clock advances by a nominal 16ms per tick, and the
    // timestamp handed to the frame callbacks is pushed far enough ahead that
    // every run is due — pacing is the browser's business, not a test's.
    tick(ms = 16) {
      now += ms;
      for (const timer of timers) {
        if (timer.cancelled || timer.fired || timer.due > now) continue;
        timer.fired = true;
        timer.fn();
      }
      const due = frame;
      frame = [];
      for (const fn of due) fn(now * 100);
    },

    // True once nothing is left to run: no frame pending, no timer waiting. A
    // sweep removes itself from the loop when its front runs off the end, so
    // this is how a test knows an animation has finished rather than guessing a
    // frame count.
    idle: () => frame.length === 0 && timers.every((t) => t.cancelled || t.fired),

    // Runs until idle, or gives up. The cap is a guard against a bug that keeps
    // the loop alive forever — without it a regression would hang the suite
    // instead of failing it.
    settle(limit = 500) {
      let ticks = 0;
      while (!this.idle() && ticks < limit) {
        this.tick();
        ticks++;
      }
      if (!this.idle()) throw new Error(`animation never settled (${limit} frames)`);
      return ticks;
    },

    // Runs until idle, calling `watch(text)` after every single frame. This is
    // the one that catches flashes: a frame-perfect assertion about what was on
    // screen the whole way through a transition, not just where it ended up.
    settleWatching(el, watch, limit = 500) {
      let ticks = 0;
      while (!this.idle() && ticks < limit) {
        this.tick();
        watch(el.text(), ticks);
        ticks++;
      }
      return ticks;
    },
  };
}

module.exports = { text, element, tree, open };
