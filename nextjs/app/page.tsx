import Cursor from "@/components/Cursor";
import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Collection from "@/components/Collection";
import Heritage from "@/components/Heritage";
import Service from "@/components/Service";
import Boutiques from "@/components/Boutiques";
import Footer from "@/components/Footer";
import { getCollectionSummaries } from "@/lib/catalog";

// The index reflects whatever the agent last ingested.
export const dynamic = "force-dynamic";

export default async function Home() {
  const families = await getCollectionSummaries();

  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", overflow: "hidden" }}>
      <div className="grain" />
      <Cursor />
      <Nav />
      <Hero />
      <Marquee />
      <Collection families={families} />
      <Heritage />
      <Service />
      <Boutiques />
      <Footer />
    </main>
  );
}
