import type { Metadata } from "next";
import { PageHead } from "@/components/admin/ui";
import ContentDesk from "@/components/admin/ContentDesk";
import { getSiteCopy } from "@/lib/site-copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Front page words — Stock room" };

export default async function ContentPage() {
  const copy = await getSiteCopy();
  return (
    <>
      <PageHead
        title="Front page words"
        lead="The sentences and figures on the shop's own front page. Change them here and the website changes within five minutes — no developer, no deploy."
      />
      <ContentDesk initial={copy} />
    </>
  );
}
