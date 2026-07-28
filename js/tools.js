// sp3ctr-zone :: cipher toolkit
// three classic ciphers, entirely client-side. these are for learning and
// fun, not real secrecy — see the note on the page itself.

function caesar(text, shift) {
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    const offset = ((char.charCodeAt(0) - base + shift) % 26 + 26) % 26;
    return String.fromCharCode(base + offset);
  });
}

function vigenere(text, key, decrypt) {
  const k = key.toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return text;
  let ki = 0;
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    const shift = k.charCodeAt(ki % k.length) - 65;
    ki++;
    const applied = decrypt ? -shift : shift;
    const offset = ((char.charCodeAt(0) - base + applied) % 26 + 26) % 26;
    return String.fromCharCode(base + offset);
  });
}

function xorEncrypt(text, key) {
  const bytes = new TextEncoder().encode(text);
  const keyBytes = new TextEncoder().encode(key);
  return Array.from(bytes)
    .map((byte, i) => byte ^ keyBytes[i % keyBytes.length])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function xorDecrypt(hex, key) {
  const clean = hex.trim().replace(/\s+/g, "");
  const bytes = clean.match(/.{1,2}/g)?.map((pair) => parseInt(pair, 16)) ?? [];
  const keyBytes = new TextEncoder().encode(key);
  const decoded = bytes.map((byte, i) => byte ^ keyBytes[i % keyBytes.length]);
  return new TextDecoder().decode(new Uint8Array(decoded));
}

const form = document.querySelector("#cipher-form");
const cipherSelect = document.querySelector("#cipher-type");
const keyField = document.querySelector("#cipher-key");
const keyLabel = document.querySelector("#cipher-key-label");
const messageField = document.querySelector("#cipher-message");
const output = document.querySelector("#cipher-output");

const KEY_LABELS = {
  caesar: "shift (number)",
  vigenere: "key (letters)",
  xor: "key (any text)",
};

function updateKeyLabel() {
  keyLabel.textContent = KEY_LABELS[cipherSelect.value];
}
cipherSelect.addEventListener("change", updateKeyLabel);
updateKeyLabel();

function run(decrypt) {
  const message = messageField.value;
  const key = keyField.value;
  try {
    switch (cipherSelect.value) {
      case "caesar": {
        const shift = Number(key) || 0;
        output.value = caesar(message, decrypt ? -shift : shift);
        break;
      }
      case "vigenere":
        output.value = vigenere(message, key, decrypt);
        break;
      case "xor":
        output.value = decrypt ? xorDecrypt(message, key) : xorEncrypt(message, key);
        break;
    }
  } catch (err) {
    output.value = "[ error: could not process input — check your key/ciphertext format ]";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const decrypt = event.submitter?.value === "decrypt";
  run(decrypt);
});

document.querySelector("#cipher-copy").addEventListener("click", async () => {
  if (!output.value) return;
  await navigator.clipboard.writeText(output.value);
  const button = document.querySelector("#cipher-copy");
  const original = button.textContent;
  button.textContent = "copied";
  setTimeout(() => { button.textContent = original; }, 1200);
});
