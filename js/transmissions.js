// sp3ctr-zone :: transmissions page
// each .cipher element decrypts to its data-plain text on hover/focus,
// and re-seals back to garbled placeholder text on mouseleave/blur.
// depends on scramble() from site.js, loaded first.

document.querySelectorAll(".cipher").forEach((el) => {
  const plainText = el.dataset.plain;

  // Build a garbled placeholder that preserves word shapes (spaces stay put)
  // so the ciphertext reads like a redacted document rather than noise.
  const garbled = plainText
    .split("")
    .map((char) => (char === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
    .join("");
  el.textContent = garbled;
  el.dataset.state = "cipher";

  const decrypt = () => {
    if (el.dataset.state === "plain") return;
    el.dataset.state = "plain";
    scramble(el, plainText);
  };

  const encrypt = () => {
    if (el.dataset.state === "cipher") return;
    el.dataset.state = "cipher";
    scramble(el, garbled);
  };

  el.addEventListener("mouseenter", decrypt);
  el.addEventListener("mouseleave", encrypt);
  el.addEventListener("focus", decrypt);
  el.addEventListener("blur", encrypt);
});
