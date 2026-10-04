import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { PageHead } from "@/components/admin/ui";
import { getBrands } from "@/lib/brands";
import { formatInr } from "@/agent/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Brands — Stock room" };

export default async function BrandsAdminPage() {
  const brands = await getBrands();
  const withBanner = brands.filter((brand) => brand.banner).length;
  const reduced = brands.reduce((total, brand) => total + brand.reduced, 0);

  return (
    <>
      <PageHead
        title="Brands"
        lead={
          `${brands.length} houses on the shelf. Open one to price a whole range from a spreadsheet, or to put a ` +
          `photograph across the top of its page. ${withBanner} of them have a banner; ${reduced} watches are ` +
          `currently reduced.`
        }
      />

      <div className="ops-brands">
        {brands.map((brand) => (
          <Link key={brand.slug} href={`/admin/brands/${brand.slug}`} className="ops-brand">
            <span className="ops-brand-mark">
              {brand.logo ? (
                <Image src={brand.logo} alt="" width={96} height={40} style={{ objectFit: "contain" }} />
              ) : (
                <span className="serif">{brand.name.slice(0, 2)}</span>
              )}
            </span>

            <span className="ops-brand-body">
              <span className="ops-brand-name serif">{brand.name}</span>
              <span className="ops-brand-counts mono">
                {brand.count} LISTED · {brand.inStock} IN STOCK
                {brand.reduced > 0 ? ` · ${brand.reduced} REDUCED` : ""}
                {brand.priceFrom ? ` · FROM ${formatInr(brand.priceFrom)}` : ""}
              </span>
            </span>

            <span className={`ops-brand-banner mono${brand.banner ? " is-set" : ""}`}>
              {brand.banner ? "BANNER" : "NO BANNER"}
            </span>
          </Link>
        ))}
      </div>

      <p className="ops-foot-note">
        The list comes from the catalogue itself — a house appears here the moment its first reference is published and
        leaves when the last one is delisted. Nothing to add by hand.
      </p>
    </>
  );
}
