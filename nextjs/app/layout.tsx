import type { Metadata } from "next";
import { Instrument_Serif, Jost, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import WhatsApp from "@/components/WhatsApp";
import { BagProvider } from "@/components/shop/Cart";

const serif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-serif" });
// 600 is here for the navigation: the bar sits over a moving film, and 500
// disappears into a bright frame.
const sans = Jost({ weight: ["300", "400", "500", "600"], subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Prakash Watch Co. — Time, kept well. Since 1976",
  description:
    "Authorized multi-brand watch boutiques across Delhi NCR since 1976. Tissot, Seiko, Citizen, Casio, Titan and more — sold, set and serviced in house.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // en-IN rather than en: an Indian shop, so date inputs read dd/mm and number
  // formatting follows the reader's expectations rather than America's.
  return (
    <html lang="en-IN" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        {/*
          The saved palette is applied before the first paint. Left to the React
          tree it would paint the default and then correct itself, which on the
          light theme is a full-screen flash of near-black on every page load.

          The shop opens in daylight: Linen is the default, and the attribute is
          only set for anyone who has asked for Copper. Anyone still holding one
          of the retired palettes is moved to the default rather than left on a
          theme whose tokens no longer exist.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('pwc-theme');if(t==='copper'){document.documentElement.dataset.theme='copper'}else if(t&&t!=='linen'){localStorage.setItem('pwc-theme','linen')}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {/* The bag is read from this browser's own storage, so it wraps
            everything rather than living on the shop pages alone — the count in
            the navigation is on every page. */}
        <BagProvider>
          {children}
          <WhatsApp />
        </BagProvider>
      </body>
    </html>
  );
}
