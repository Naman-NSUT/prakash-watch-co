import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/ui";
import BrandDesk from "@/components/admin/BrandDesk";
import { getBrands } from "@/lib/brands";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = (await getBrands()).find((candidate) => candidate.slug === slug);
  return { title: `${brand?.name ?? "Brand"} — Stock room` };
}

export default async function BrandAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = (await getBrands()).find((candidate) => candidate.slug === slug);
  if (!brand) notFound();

  return (
    <>
      <PageHead
        title={brand.name}
        lead={
          `${brand.count} references listed, ${brand.inStock} in stock${
            brand.reduced > 0 ? `, ${brand.reduced} already reduced` : ""
          }. Price the range from a spreadsheet, or put a photograph across the top of the house's page.`
        }
      />

      <p className="ops-foot-note" style={{ marginTop: -8, marginBottom: 26 }}>
        <Link href="/admin/brands">← All brands</Link>
        {" · "}
        <Link href={`/brands/${brand.slug}`} target="_blank" rel="noreferrer">
          See the public page ↗
        </Link>
      </p>

      <BrandDesk
        slug={brand.slug}
        name={brand.name}
        listed={brand.count}
        banner={brand.banner}
        bannerAlt={brand.bannerAlt}
      />
    </>
  );
}
