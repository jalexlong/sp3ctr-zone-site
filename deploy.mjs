// Pushes the built _site/ folder to Neocities via its upload API.
// https://neocities.org/api#upload
//
// Get an API key at neocities.org/settings -> your site -> API Key, then:
//   NEOCITIES_API_KEY=... npm run deploy
//
// Uploading only ever adds or overwrites, so a page removed from src/ lingers
// on the server forever. Pass --prune to also delete remote files that the
// build no longer produces, or --dry-run to preview those deletions:
//   npm run deploy -- --prune
//   npm run deploy -- --prune --dry-run

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SITE_DIR = "_site";
const apiKey = process.env.NEOCITIES_API_KEY;

const args = process.argv.slice(2);
const prune = args.includes("--prune");
const dryRun = args.includes("--dry-run");

const unknown = args.filter((a) => !["--prune", "--dry-run"].includes(a));
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(", ")}`);
  process.exit(1);
}

if (!apiKey) {
  console.error("Set NEOCITIES_API_KEY before deploying.");
  process.exit(1);
}

// Neocities refuses to delete the root index.html, and a site without one is
// broken anyway — keep it out of the delete set rather than eating an API error.
const NEVER_DELETE = new Set(["index.html"]);

async function api(path, init) {
  const response = await fetch(`https://neocities.org/api/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok || body.result !== "success") {
    console.error(`${path} failed:`, body);
    process.exit(1);
  }
  return body;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SITE_DIR);
const form = new FormData();
const localPaths = new Set();
for (const file of files) {
  const destPath = relative(SITE_DIR, file).split(sep).join("/");
  localPaths.add(destPath);
  form.append(destPath, new Blob([readFileSync(file)]), destPath);
}

if (!dryRun) {
  await api("upload", { method: "POST", body: form });
  console.log(`Deployed ${files.length} files to Neocities.`);
} else {
  console.log(`[dry run] would upload ${files.length} files.`);
}

if (!prune) {
  if (dryRun) console.log("--dry-run only previews --prune; nothing else to show.");
  process.exit(0);
}

// Directories are skipped: Neocities prunes empty ones on its own, and deleting
// a directory would take its contents with it — including files we just wrote.
const { files: remote } = await api("list");
const stale = remote
  .filter((entry) => !entry.is_directory)
  .map((entry) => entry.path)
  .filter((path) => !localPaths.has(path) && !NEVER_DELETE.has(path));

if (!stale.length) {
  console.log("Nothing stale to prune.");
  process.exit(0);
}

console.log(`${dryRun ? "[dry run] would delete" : "Deleting"} ${stale.length} stale file(s):`);
for (const path of stale) console.log(`  ${path}`);

if (dryRun) process.exit(0);

const params = new URLSearchParams();
for (const path of stale) params.append("filenames[]", path);

await api("delete", { method: "POST", body: params });
console.log(`Pruned ${stale.length} file(s).`);
