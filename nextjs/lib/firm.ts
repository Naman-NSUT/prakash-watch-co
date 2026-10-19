/**
 * The firm's own particulars, as they appear on anything printed.
 *
 * Kept in data/firm.json so the shop can correct its own letterhead without a
 * deploy. GSTIN and PAN start empty on purpose: a statutory document that prints
 * a made-up registration number is worse than one that prints none, so the
 * reports show a visible gap until the real numbers are filled in.
 */
import "server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@/agent/config";
import { isRemote, remoteJson } from "@/lib/remote";

const FirmSchema = z.object({
  name: z.string().default("Prakash Watch Co."),
  tagline: z.string().default(""),
  address: z.string().default(""),
  phone: z.string().default(""),
  email: z.string().default(""),
  gstin: z.string().default(""),
  pan: z.string().default(""),
  state: z.string().default(""),
  stateCode: z.string().default(""),
  financialYearStartMonth: z.number().min(1).max(12).default(4),
  signatory: z.string().default("Proprietor"),
  /**
   * The shop's Instagram. The handle is what the front page links to; the
   * follower figure is only a fallback, used until Meta's API is connected and
   * whenever it cannot be reached. See lib/social.ts.
   */
  instagram: z
    .object({
      handle: z.string().default("prakashwatchco"),
      // The shop's own stated figure, and the floor the tile falls back to. It
      // defaults to a real number rather than zero because zero renders as a
      // dash on the front page, and a dash where a following should be reads
      // as a shop with none.
      followers: z.number().nonnegative().default(42000),
    })
    .default({ handle: "prakashwatchco", followers: 42000 }),
});
export type Firm = z.infer<typeof FirmSchema>;

export async function getFirm(): Promise<Firm> {
  // On the shop front there is no disk to read, so the few public particulars
  // come from the back end. Everything else on this record — the GSTIN, the
  // PAN, the signatory — belongs to printed documents, which are only ever
  // produced where the disk is, so nothing is lost by the front end getting a
  // partial answer and the schema's defaults for the rest.
  if (isRemote()) {
    try {
      const remote = await remoteJson<unknown>("/api/public/firm");
      return FirmSchema.parse(remote ?? {});
    } catch {
      return FirmSchema.parse({});
    }
  }
  try {
    const path = join(loadConfig().dataDir, "..", "firm.json");
    return FirmSchema.parse(JSON.parse(await fs.readFile(path, "utf8")));
  } catch {
    return FirmSchema.parse({});
  }
}

/** The Indian financial year containing a date, e.g. "2026-27". */
export function financialYear(date: Date, startMonth = 4): { label: string; from: string; to: string } {
  const month = date.getMonth() + 1;
  const startYear = month >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
  const from = new Date(startYear, startMonth - 1, 1);
  const to = new Date(startYear + 1, startMonth - 1, 0);
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
