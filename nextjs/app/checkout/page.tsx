import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Checkout from "@/components/shop/Checkout";

export const metadata: Metadata = {
  title: "Checkout — Prakash Watch Co.",
  description: "Your bag, your address, and the payment.",
};

export default function CheckoutPage() {
  return (
    <>
      <Nav />
      <main style={{ padding: "var(--page-top) var(--gutter) 110px", maxWidth: 1080, margin: "0 auto" }}>
        <span className="kicker">The counter</span>
        <h1 className="h2" style={{ fontSize: "clamp(34px, 5vw, 58px)", marginBottom: 10 }}>
          Your <span className="italic-accent">bag</span>
        </h1>
        <Checkout />
      </main>
      <Footer />
    </>
  );
}
