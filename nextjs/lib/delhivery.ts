import "server-only";

/**
 * Delhivery, the courier.
 *
 * Their documentation is behind a Delhivery One login, so every endpoint here
 * was found by calling it with the shop's own token and reading what came
 * back. What is verified is marked as such; what is written from their public
 * field names and not yet exercised says so, because an untested courier call
 * fails at the moment a customer's watch is waiting to ship.
 *
 * Nothing in this file is called automatically. The current integration checks
 * serviceability, reserves a waybill and reads tracking scans. Shipment
 * manifestation and pickup still happen in Delhivery One; reserving a waybill
 * alone does not create a shipment.
 */
const BASE = "https://track.delhivery.com";
const TIMEOUT_MS = 20_000;

export interface Courier {
  token: string;
  /** The pickup location, exactly as registered in Delhivery One. */
  pickupName: string;
}

export async function courier(): Promise<Courier | null> {
  const { getCourierSettings } = await import("@/lib/courier");
  const settings = await getCourierSettings();
  if (!settings.token) return null;
  return { token: settings.token, pickupName: settings.pickupName };
}

async function call<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T | null> {
  const { token, ...rest } = init;
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // The courier being unreachable must never take an order down with it.
    return null;
  }
}

export interface Serviceability {
  deliverable: boolean;
  prepaid: boolean;
  cod: boolean;
  district: string;
  state: string;
}

/**
 * Whether Delhivery delivers to a PIN code. Verified against the live account:
 * 110005 answers with cod "Y", pre_paid "Y", pickup "Y".
 */
export async function serviceable(pincode: string): Promise<Serviceability | null> {
  const config = await courier();
  if (!config || !/^\d{6}$/.test(pincode)) return null;

  const payload = await call<{
    delivery_codes?: { postal_code?: Record<string, string | number> }[];
  }>(`/c/api/pin-codes/json/?filter_codes=${pincode}`, { token: config.token });

  // Null means the account is not configured, authentication failed, or the
  // courier could not be reached. An empty successful response is different: it
  // is Delhivery's definite answer that the PIN is not serviceable.
  if (payload === null) return null;
  const code = payload.delivery_codes?.[0]?.postal_code;
  if (!code) {
    return { deliverable: false, prepaid: false, cod: false, district: "", state: "" };
  }
  return {
    deliverable: true,
    prepaid: String(code.pre_paid ?? "").toUpperCase() === "Y",
    cod: String(code.cod ?? "").toUpperCase() === "Y",
    district: String(code.district ?? ""),
    state: String(code.state_code ?? ""),
  };
}

/**
 * A waybill number from the account's own pool. Verified: returns a bare
 * quoted string such as "71255210000011".
 *
 * Each call consumes a number whether or not a shipment follows, so this is
 * only ever called at the moment one is being manifested.
 */
export async function takeWaybill(): Promise<string | null> {
  const config = await courier();
  if (!config) return null;
  const payload = await call<string | string[]>(`/waybill/api/bulk/json/?count=1`, {
    token: config.token,
  });
  if (typeof payload === "string") return payload.trim() || null;
  if (Array.isArray(payload) && typeof payload[0] === "string") return payload[0];
  return null;
}

export interface Scan {
  at: string;
  status: string;
  location: string;
  instructions: string;
}

export interface Tracked {
  waybill: string;
  status: string;
  statusType: string;
  promisedFor: string;
  delivered: boolean;
  scans: Scan[];
}

/**
 * Where a parcel has got to. Verified: an unknown waybill answers
 * {"Success": false, "Error": "Data does not exists for provided Waybill(s)"},
 * so a null here means "no such parcel" as much as it means "could not ask".
 */
export async function track(waybill: string): Promise<Tracked | null> {
  const config = await courier();
  if (!config || !/^[A-Za-z0-9]{6,}$/.test(waybill)) return null;

  const payload = await call<{
    ShipmentData?: { Shipment?: Record<string, unknown> }[];
    Success?: boolean;
  }>(`/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`, { token: config.token });

  const shipment = payload?.ShipmentData?.[0]?.Shipment as Record<string, unknown> | undefined;
  if (!shipment) return null;

  const status = (shipment.Status ?? {}) as Record<string, string>;
  const scans = Array.isArray(shipment.Scans) ? shipment.Scans : [];

  return {
    waybill: String(shipment.AWB ?? waybill),
    status: String(status.Status ?? ""),
    statusType: String(status.StatusType ?? ""),
    promisedFor: String(shipment.PromisedDeliveryDate ?? ""),
    delivered: String(status.Status ?? "").toLowerCase() === "delivered",
    scans: scans.map((entry) => {
      const detail = ((entry as Record<string, unknown>).ScanDetail ?? {}) as Record<string, string>;
      return {
        at: String(detail.ScanDateTime ?? ""),
        status: String(detail.Scan ?? ""),
        location: String(detail.ScannedLocation ?? ""),
        instructions: String(detail.Instructions ?? ""),
      };
    }),
  };
}

/** Where a customer can follow their own parcel. */
export const trackingUrl = (waybill: string) =>
  `https://www.delhivery.com/track/package/${encodeURIComponent(waybill)}`;
