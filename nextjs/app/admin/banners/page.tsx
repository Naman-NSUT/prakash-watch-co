import type { Metadata } from "next";
import { PageHead } from "@/components/admin/ui";
import BannerDesk from "@/components/admin/BannerDesk";
import { listBanners } from "@/lib/banners";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Banners — Stock room" };

export default async function BannersPage() {
  const banners = await listBanners();

  return (
    <>
      <PageHead
        title="Banners"
        lead="The strip that drifts under the houses on the front page. Whatever the shop wants seen this month — a festival scheme, a new arrival, the workshop. It stops when someone hovers it, so a banner can actually be read."
      />
      <BannerDesk initial={banners} />
      <p className="ops-foot-note">
        These are the shop&apos;s own. A single brand&apos;s banner — the wide photograph across the top of its page —
        is set from that brand&apos;s desk under Brands instead.
      </p>
    </>
  );
}
