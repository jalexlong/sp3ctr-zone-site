// Pushes the built _site/ folder to Neocities via its upload API.
// https://neocities.org/api#upload
//
// Get an API key at neocities.org/settings -> your site -> API Key, then:
//   NEOCITIES_API_KEY=... npm run deploy

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SITE_DIR = "_site";
const apiKey = process.env.NEOCITIES_API_KEY;

if (!apiKey) {
  console.error("Set NEOCITIES_API_KEY before deploying.");
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SITE_DIR);
const form = new FormData();
for (const file of files) {
  const destPath = relative(SITE_DIR, file).split(sep).join("/");
  form.append(destPath, new Blob([readFileSync(file)]), destPath);
}

const response = await fetch("https://neocities.org/api/upload", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});

const body = await response.json();
if (!response.ok || body.result !== "success") {
  console.error("Deploy failed:", body);
  process.exit(1);
}

console.log(`Deployed ${files.length} files to Neocities.`);
