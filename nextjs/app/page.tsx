import NavBar from "@/components/NavBar";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import BannerStrip from "@/components/BannerStrip";
import Collection from "@/components/Collection";
import BrandRail from "@/components/BrandRail";
import Heritage from "@/components/Heritage";
import Service from "@/components/Service";
import Boutiques from "@/components/Boutiques";
import Footer from "@/components/Footer";
import { getCollectionSummaries } from "@/lib/catalog";
import { getBrands } from "@/lib/brands";

// The index reflects agent changes within five minutes, while repeat visits are
// served from the edge instead of rebuilding the entire home page from Render.
export const dynamic = "force-static";
export const revalidate = 300;

export default async function Home() {
  const [families, brands] = await Promise.all([getCollectionSummaries(), getBrands()]);

  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", overflow: "hidden" }}>
      <div className="grain" />
      <NavBar />
      <Hero />
      <Marquee />
      <BannerStrip />
      <Collection families={families} />
      <BrandRail brands={brands} />
      <Heritage />
      <Service />
      <Boutiques />
      <Footer />
    </main>
  );
}
