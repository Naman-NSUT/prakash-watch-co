import Nav from "./Nav";
import { getBrands } from "@/lib/brands";

/**
 * The navigation, with the houses it carries.
 *
 * The bar itself has to be a client component — it opens panels, listens for
 * Escape, watches the route. The list of brands is server data. This is the
 * seam: every page renders this, it reads the catalogue once, and hands the bar
 * the few fields the menu needs rather than whole brand summaries.
 */
export default async function NavBar() {
  const brands = await getBrands();

  return (
    <Nav
      brands={brands.map((brand) => ({
        slug: brand.slug,
        name: brand.name,
        count: brand.count,
      }))}
    />
  );
}
