import "server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "@/agent/config";

export interface StorageEntry {
  name: string;
  bytes: number;
}

export interface StorageSnapshot {
  capacityBytes: number;
  freeBytes: number;
  usedBytes: number;
  entries: StorageEntry[];
}

async function sizeOf(path: string): Promise<number> {
  let stat;
  try {
    stat = await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;

  const children = await fs.readdir(path);
  let total = 0;
  // The research cache can contain thousands of files. Walk it sequentially so
  // a storage report cannot exhaust the process' file-descriptor limit.
  for (const child of children) total += await sizeOf(join(path, child));
  return total;
}

export async function readStorage(): Promise<StorageSnapshot> {
  const root = dataRoot();
  const [disk, children] = await Promise.all([
    fs.statfs(root),
    fs.readdir(root, { withFileTypes: true }),
  ]);

  const entries: StorageEntry[] = [];
  for (const entry of children) {
    entries.push({
      name: entry.name,
      bytes: await sizeOf(join(root, entry.name)),
    });
  }
  entries.sort((left, right) => right.bytes - left.bytes);

  const capacityBytes = disk.blocks * disk.bsize;
  const freeBytes = disk.bavail * disk.bsize;
  return {
    capacityBytes,
    freeBytes,
    usedBytes: capacityBytes - freeBytes,
    entries,
  };
}

/**
 * The research cache contains downloaded source pages, model replies and image
 * bytes. Every item can be recreated from its source, so removing it is safe and
 * does not touch the catalogue, photographs, bills, orders or stock ledger.
 */
export async function pruneAgentCache(): Promise<{ removedBytes: number }> {
  const cache = join(dataRoot(), ".cache");
  const removedBytes = await sizeOf(cache);
  await fs.rm(cache, { recursive: true, force: true });
  await fs.mkdir(cache, { recursive: true });
  return { removedBytes };
}
