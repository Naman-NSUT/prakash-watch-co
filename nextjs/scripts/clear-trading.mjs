/**
 * Clear every trading record, before the shop opens for real.
 *
 * The stock room was filled with invented sales so the books, the analytics and
 * the charts had something to draw. That was right while it was being built and
 * wrong the day it goes live: a shop that has sold nothing should say it has
 * sold nothing, and the first real bill should be the first bill.
 *
 * What goes: bills, the journal the books are built from, repair dockets, the
 * price-watch history, stock movements.
 *
 * What stays: the watches themselves — every listing, every photograph — and
 * the brands, banners, backdrops and the firm's own details. The catalogue is
 * the thing that took work; none of it is a trading record.
 *
 *   node scripts/clear-trading.mjs          # say what would go
 *   node scripts/clear-trading.mjs --yes    # actually clear it
 */
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PWC_DATA_ROOT || join(here, "..", "data");
const commit = process.argv.includes("--yes");

/** Folders emptied of their .json records. */
const FOLDERS = ["bills", "repairs"];
/** Files removed outright. */
const FILES = ["journal.json", "movements.jsonl", "price-history.jsonl", "price-watch.json"];
/** Photographs attached to repair dockets go with the dockets. */
const MEDIA = ["media/repairs"];

async function countIn(folder) {
  try {
    return (await fs.readdir(join(DATA, folder))).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function main() {
  console.log(`data root: ${DATA}`);
  console.log(commit ? "clearing\n" : "dry run — nothing will be removed\n");

  for (const folder of FOLDERS) {
    const n = await countIn(folder);
    console.log(`  ${folder.padEnd(18)} ${n} record(s)`);
    if (!commit || n === 0) continue;
    for (const name of await fs.readdir(join(DATA, folder))) {
      if (name.endsWith(".json")) await fs.rm(join(DATA, folder, name), { force: true });
    }
  }

  for (const file of FILES) {
    let size = 0;
    try {
      size = (await fs.stat(join(DATA, file))).size;
    } catch {
      continue;
    }
    console.log(`  ${file.padEnd(18)} ${(size / 1024).toFixed(0)} KB`);
    if (commit) await fs.rm(join(DATA, file), { force: true });
  }

  for (const folder of MEDIA) {
    let n = 0;
    try {
      n = (await fs.readdir(join(DATA, folder))).length;
    } catch {
      continue;
    }
    console.log(`  ${folder.padEnd(18)} ${n} folder(s) of photographs`);
    if (commit) await fs.rm(join(DATA, folder), { recursive: true, force: true });
  }

  // What is deliberately untouched, said out loud so nobody has to guess.
  const listings = await countIn("catalog");
  console.log(`\n  kept: ${listings - 1} listings, their photographs, brands, banners, backdrops, firm details`);
  if (!commit) console.log("\n  run again with --yes to clear");
}

main();
