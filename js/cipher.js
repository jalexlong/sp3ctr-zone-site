// sp3ctr-zone :: sealed text
// Every [data-seal] region ships to the browser as ordinary readable HTML and
// gets sealed the instant this script runs, so a visitor without JS still gets
// the transmission. On the log page a sealed preview decrypts while its entry is
// hovered or focused and re-seals when you leave; on a transmission's own page
// the body decrypts itself on arrival and stays open.
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
    return { el, target, plain, cipher };
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
        decryptText(block.target, block.plain, { step: paceFor(block.plain.length, 70) });
      }, delay + index * stagger);
    });
  };

  const seal = () => {
    if (region.dataset.state === "cipher") return;
    region.dataset.state = "cipher";

    blocks.forEach((block) => {
      block.el.dataset.state = "cipher";
      clearTimeout(block.pending);
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
});
