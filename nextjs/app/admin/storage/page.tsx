import type { Metadata } from "next";
import StorageMaintenance from "@/components/admin/StorageMaintenance";
import { PageHead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Storage — Stock room" };

export default function StoragePage() {
  return (
    <>
      <PageHead
        title="Storage"
        lead="See what occupies the shop’s persistent disk and recover space from reproducible research files."
      />
      <StorageMaintenance />
    </>
  );
}
