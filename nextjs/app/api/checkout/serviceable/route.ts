import { serviceable } from "@/lib/delhivery";

export const runtime = "nodejs";

/**
 * Whether the courier reaches a PIN code.
 *
 * Asked while the customer is still typing the address, because finding out
 * after the money has gone is the worst moment to learn it. A silent null —
 * no token, courier unreachable — is answered as "unknown" rather than "no":
 * the shop would rather take an order and sort the delivery out by telephone
 * than refuse one because a third party was down.
 */
export async function GET(request: Request): Promise<Response> {
  const pincode = new URL(request.url).searchParams.get("pincode") ?? "";
  if (!/^\d{6}$/.test(pincode)) {
    return Response.json({ known: false }, { status: 200 });
  }

  const answer = await serviceable(pincode);
  // Missing credentials and a temporary Delhivery failure are unknown, not a
  // refusal. The checkout deliberately stays quiet and lets the order proceed.
  if (!answer) return Response.json({ known: false, pincode });
  return Response.json({
    known: true,
    deliverable: answer.deliverable && answer.prepaid,
    district: answer.district,
    state: answer.state,
    pincode,
  });
}
