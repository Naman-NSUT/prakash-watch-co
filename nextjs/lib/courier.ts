import "server-only";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadConfig } from "@/agent/config";

/**
 * The courier's particulars, kept where the shop can change them.
 *
 * These were environment variables, which meant the shop could not set up its
 * own courier — the pickup location has to match what is registered in
 * Delhivery One exactly, and getting it wrong is a manifest that is refused.
 * That is a thing to try, correct and try again, which is not what a deploy is
 * for.
 *
 * The token is held here too. It is no more exposed than it was: this file
 * sits on the back end's own disk beside the bills and the repair dockets,
 * never in the repository, and never sent to the shop front. The environment
 * still wins where it is set, so an existing deployment keeps working.
 */
const config = loadConfig();
const PATH = join(config.dataDir, "..", "courier.json");

export const CourierSettingsSchema = z.object({
  /** Delhivery B2C API token. */
  token: z.string().default(""),
  /** The pickup location, spelled exactly as Delhivery One has it. */
  pickupName: z.string().default(""),
  /** Where the parcels go out from, for the manifest. */
  pickupPhone: z.string().default(""),
  pickupAddress: z.string().default(""),
  pickupCity: z.string().default(""),
  pickupState: z.string().default(""),
  pickupPincode: z.string().default(""),
});
export type CourierSettings = z.infer<typeof CourierSettingsSchema>;

export async function getCourierSettings(): Promise<CourierSettings> {
  let stored: CourierSettings = CourierSettingsSchema.parse({});
  try {
    stored = CourierSettingsSchema.parse(JSON.parse(await fs.readFile(PATH, "utf8")));
  } catch {
    // Nothing saved yet; the environment may still carry it.
  }
  return {
    ...stored,
    token: process.env.DELHIVERY_TOKEN || stored.token,
    pickupName: process.env.DELHIVERY_PICKUP_NAME || stored.pickupName,
  };
}

export async function saveCourierSettings(next: CourierSettings): Promise<CourierSettings> {
  const parsed = CourierSettingsSchema.parse(next);
  const temp = `${PATH}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  await fs.rename(temp, PATH);
  return parsed;
}

/** What the stock room may see: everything but the token itself. */
export function withoutToken(settings: CourierSettings) {
  const { token, ...rest } = settings;
  return { ...rest, tokenSet: token.length > 0, tokenTail: token ? token.slice(-4) : "" };
}
