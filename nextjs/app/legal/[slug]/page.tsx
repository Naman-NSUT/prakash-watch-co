import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { LEGAL, legalBySlug } from "@/content/legal";

export const dynamic = "force-static";

export function generateStaticParams() {
  return LEGAL.map((document) => ({ slug: document.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const document = legalBySlug(slug);
  if (!document) return { title: "Not found — Prakash Watch Co." };
  return {
    title: `${document.title} — Prakash Watch Co.`,
    description: document.lead,
  };
}

/**
 * The shop's written terms.
 *
 * One narrow column, because these are read rather than scanned, and the
 * measure matters more here than anywhere else on the site. Each heading is an
 * anchor so a reply to a customer can point at the exact paragraph.
 */
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = legalBySlug(slug);
  if (!document) notFound();

  return (
    <>
      <Nav />
      <main className="legal">
        <span className="kicker">Prakash Watch Co.</span>
        <h1 className="h2" style={{ fontSize: "clamp(34px, 5vw, 60px)" }}>{document.title}</h1>
        <p className="legal-lead">{document.lead}</p>
        <p className="mono legal-updated">Last reviewed {document.updated}</p>

        {document.sections.map((section) => {
          const anchor = section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          return (
            <section key={section.heading} id={anchor} className="legal-section">
              <h2 className="serif">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)}>{paragraph}</p>
              ))}
              {section.list && (
                <ul>
                  {section.list.map((item) => (
                    <li key={item.slice(0, 40)}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <nav className="legal-more" aria-label="The shop's other terms">
          <span className="kicker">The rest of it</span>
          <div>
            {LEGAL.filter((other) => other.slug !== document.slug).map((other) => (
              <a key={other.slug} href={`/legal/${other.slug}`}>{other.title}</a>
            ))}
          </div>
        </nav>
      </main>
      <Footer />
    </>
  );
}
