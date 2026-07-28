// sp3ctr-zone :: sealed text
// Every [data-seal] region ships to the browser as ordinary readable HTML and
// gets sealed the instant this script runs, so a visitor without JS still gets
// the transmission. On the log page a sealed preview decrypts while its entry is
// hovered, focused, or tapped and re-seals when you leave; on a transmission's
// own page the body decrypts itself on arrival and stays open.
// depends on site.js, loaded first.

document.querySelectorAll("[data-seal]").forEach((region) => {
  // A region is either a single line of text — the preview on the log page — or
  // a whole body of block elements, each of which then scrambles on its own
  // clock so the page decrypts in a cascade instead of one wall at a time.
  const found = region.querySelectorAll("p, li, h2, h3, blockquote");
  const blocks = (found.length ? [...found] : [region]).map((el) => {
    const target = textTarget(el);
    const plain = target.text;
    const cipher = garble(plain);

    target.paint(cipher);
    el.dataset.state = "cipher";
    // `open` is the block's own business and can't be read off `el`: a region
    // with no block children is its own single block, and the two would share
    // one element's state.
    return { el, target, plain, cipher, open: false };
  });

  // The stylesheet keeps the region invisible until it carries a state, so the
  // plaintext never flashes up on screen in the gap before this line lands.
  region.dataset.state = "cipher";

  const decrypt = ({ delay = 0, stagger = 0 } = {}) => {
    if (region.dataset.state === "plain") return;
    region.dataset.state = "plain";

    blocks.forEach((block, index) => {
      clearTimeout(block.pending);
      // the state flips as the block's own run starts, not when the region's
      // does — a block still waiting its turn in the cascade is still sealed.
      block.pending = setTimeout(() => {
        block.el.dataset.state = "plain";
        block.open = true;
        decryptText(block.target, block.plain, { step: paceFor(block.plain.length, 70) });
      }, delay + index * stagger);
    });
  };

  const seal = () => {
    if (region.dataset.state === "cipher") return;
    region.dataset.state = "cipher";

    blocks.forEach((block) => {
      clearTimeout(block.pending);
      // A block whose turn in the cascade hadn't come round yet never left the
      // ciphertext, so there is nothing here to take back — and running a seal
      // over it would paint the plaintext first to have something to scramble.
      if (!block.open) return;

      block.open = false;
      block.el.dataset.state = "cipher";
      sealText(block.target, block.plain, block.cipher, {
        step: paceFor(block.plain.length, 50),
      });
    });
  };

  if (region.hasAttribute("data-decrypt-on-load")) {
    // held back until the boot flash has cleared, or the first half-second of
    // the decrypt would play out behind a white screen.
    decrypt({ delay: 700, stagger: 220 });
    return;
  }

  // The whole entry on the log page is a link, and it — not the preview text
  // inside it — is what the visitor hovers and tabs to.
  const trigger = region.closest("[data-cipher-trigger]") ?? region;
  trigger.addEventListener("mouseenter", () => decrypt());
  trigger.addEventListener("mouseleave", seal);
  trigger.addEventListener("focus", () => decrypt());
  trigger.addEventListener("blur", seal);

  // A touchscreen has no hover to enter or leave. What looks like a press —
  // the tap highlight — fires no event of its own, and the browser only
  // synthesizes mouseenter at the *end* of the tap, an instant before it
  // follows the link, so the decrypt would never be seen. A finger gets the
  // two-step instead: the first tap decrypts the preview where it stands, the
  // second one opens the transmission.
  let byTouch = false;
  let wasSealed = false;

  trigger.addEventListener("pointerdown", (event) => {
    byTouch = event.pointerType !== "mouse";
    // Whether the preview was already open has to be read as the finger lands:
    // by the time the click arrives the tap's own synthetic hover may have
    // decrypted it, which would make every first tap look like a second one.
    wasSealed = region.dataset.state === "cipher";
  });

  trigger.addEventListener("click", (event) => {
    if (!byTouch || !wasSealed) return;
    event.preventDefault();
    decrypt();
  });

  // Nothing tells a touchscreen you've stepped away, so the reseal has to come
  // from the next tap landing somewhere else on the page.
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" && !trigger.contains(event.target)) seal();
  });
});
