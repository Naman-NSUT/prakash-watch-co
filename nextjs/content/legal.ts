/**
 * The shop's own terms, written for an Indian multi-brand watch retailer.
 *
 * Drafted to be read, not to be impressive: short sentences, the shop's own
 * voice, and a plain statement wherever the law gives the customer a right. Two
 * things run through all of it — every price includes GST, and the warranty is
 * the manufacturer's rather than the shop's, because that is how authorised
 * retail actually works and pretending otherwise causes arguments later.
 *
 * These are a draft for the shop and its advisor to approve. Nothing here was
 * copied from another retailer: their terms are their own contract, and putting
 * this shop's name on them would be both wrong and useless.
 */
export interface LegalSection {
  heading: string;
  body: string[];
  list?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  lead: string;
  updated: string;
  sections: LegalSection[];
}

const CONTACT = "prakashwatchco@gmail.com or +91 98996 45897";

export const LEGAL: LegalDocument[] = [
  {
    slug: "terms",
    title: "Terms of sale",
    lead: "What you can expect from us, and what we ask of you, when you buy a watch from this website or over the counter.",
    updated: "October 2026",
    sections: [
      {
        heading: "Who you are buying from",
        body: [
          "Prakash Watch Co. is a multi-brand watch retailer in Delhi NCR, trading since 1976. We are an authorised dealer for the houses listed on our Brands page, and every watch we sell is new, sealed where the brand seals it, and carries the manufacturer's own warranty.",
          "These terms apply to anything bought through this website. Buying over the counter is the same agreement, with the bill as its record.",
        ],
      },
      {
        heading: "Prices include GST",
        body: [
          "Every price shown on this website is the price you pay. GST at 18% is already inside it, and your invoice shows the taxable value and the tax separately because that is what a tax invoice must do. We do not add tax at the checkout.",
          "We try to keep prices right. If a watch is listed at a price that is obviously wrong — a decimal place out, or a figure no watch of that kind sells for — we will tell you before we take the order further, and you may cancel for a full refund.",
        ],
      },
      {
        heading: "When an order becomes an order",
        body: [
          "Putting a watch in your bag does not reserve it. The order is made when your payment is confirmed and we send you its number. We may decline an order and refund it in full if the watch has gone from the case, if we cannot confirm the delivery address, or if the price was wrong as described above.",
          "Where a house is not set up for online sale, its watches say so on the page and can only be bought at the counter. That is the brand's arrangement with us, not a preference of ours.",
        ],
      },
      {
        heading: "Paying",
        body: [
          "Payments are taken by Razorpay, which handles card, UPI and net banking. Your card details go to them and never to us — we see that a payment succeeded, its method and its reference, and nothing else.",
        ],
      },
      {
        heading: "The watch itself",
        body: [
          "Photographs are of the reference you are buying, but a dial reads differently under different light, and a bracelet is sized to the wrist it is going on. If the watch is not what you expected when it arrives, the returns policy below is yours to use.",
          "Specifications on a listing come from the brand or from authorised dealers and are given in good faith. Where the brand revises a reference, the watch in the box is the current one.",
        ],
      },
      {
        heading: "If something goes wrong",
        body: [
          "Nothing in these terms takes away any right you have under the Consumer Protection Act, 2019, or any other law that applies to you. Where these terms and that law disagree, the law wins.",
          "These terms are governed by Indian law, and the courts at Delhi have jurisdiction.",
        ],
      },
      {
        heading: "Talking to us",
        body: [`The fastest way to reach a person is ${CONTACT}. We answer during shop hours, seven days a week.`],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy",
    lead: "What we collect, why we collect it, and what we will never do with it.",
    updated: "October 2026",
    sections: [
      {
        heading: "What we collect",
        body: ["Only what a sale or a repair actually needs:"],
        list: [
          "Your name, phone number and email, so we can reach you about your order or your watch.",
          "A delivery address, when something has to be sent to you.",
          "What you bought, or what you brought in for repair, and what we did about it.",
          "Photographs you send us of a watch needing work, which stay attached to that job card.",
        ],
      },
      {
        heading: "What we never hold",
        body: [
          "We do not store card numbers, CVVs, UPI PINs or bank credentials. Payments run through Razorpay and those details go to them directly. What reaches us is confirmation that a payment succeeded, its method, and its reference number.",
        ],
      },
      {
        heading: "Why we hold it",
        body: [
          "To send you the watch, to service it, to honour the warranty, and to keep the books and tax records the law requires us to keep. We do not sell your details to anybody, and we do not pass them to advertisers.",
          "We will contact you about your own order or repair. We will not add you to a marketing list because you bought something.",
        ],
      },
      {
        heading: "How long",
        body: [
          "Order and invoice records are kept for eight years, because tax law requires it. Repair records are kept while the warranty on that work could still be claimed, and usually longer, because a watch that came to us once tends to come back. Photographs attached to a repair are removed with the job card.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Under the Digital Personal Data Protection Act, 2023, you may ask us what we hold about you, ask us to correct it, and ask us to erase it where we are not required to keep it. Write to us and we will answer within a month.",
        ],
      },
      { heading: "Asking", body: [`${CONTACT}.`] },
    ],
  },
  {
    slug: "returns",
    title: "Returns and refunds",
    lead: "Seven days to change your mind, and what has to be true for us to take a watch back.",
    updated: "October 2026",
    sections: [
      {
        heading: "Seven days",
        body: [
          "If a watch bought on this website is not right for you, tell us within seven days of it reaching you and we will take it back. Tell us first — by phone or email — before sending anything, so we can arrange the pickup and know what is coming.",
        ],
      },
      {
        heading: "What has to be true",
        body: ["For us to accept a return, the watch must come back:"],
        list: [
          "Unworn, beyond trying it on, and unmarked. A scratched case or a stretched bracelet is a watch we cannot sell as new.",
          "With everything it came with — box, papers, warranty card, tags and any links removed during sizing.",
          "With the invoice, or its number.",
        ],
      },
      {
        heading: "What we cannot take back",
        body: [
          "A watch engraved, adjusted or specially ordered for you, because it cannot go to anybody else. A watch bought at the counter, where you had the piece in your hand before you decided — though we will always look at a genuine problem.",
          "None of this applies to a watch that arrived faulty or was not what was ordered. That is not a return; it is our mistake, and we fix it at our cost.",
        ],
      },
      {
        heading: "Getting your money back",
        body: [
          "Once the watch is back with us and checked, the refund goes to the account that paid, in full, including the GST. Razorpay usually takes five to seven working days to show it. We will tell you the day we send it.",
        ],
      },
      {
        heading: "If it arrives damaged",
        body: [
          "Photograph the parcel before you open it fully, and tell us the same day. A courier claim has a short window and we cannot make one for you after it closes.",
        ],
      },
    ],
  },
  {
    slug: "shipping",
    title: "Shipping and delivery",
    lead: "How a watch gets from the counter to you.",
    updated: "October 2026",
    sections: [
      {
        heading: "What it costs",
        body: ["Nothing. Delivery is free anywhere in India, insured for the full value of the watch."],
      },
      {
        heading: "When it leaves",
        body: [
          "We do not ship the same hour you order. Each watch is checked, set to the second, and sized if you have told us your wrist, which takes a working day. After that it goes by insured courier and usually reaches a metro in two to four working days, and elsewhere in four to seven.",
          "We will call to confirm the address before it leaves the counter. If we cannot reach you we will hold the watch rather than send it to an address we are unsure of.",
        ],
      },
      {
        heading: "Signing for it",
        body: [
          "Somebody must be there to receive it — a watch is not left at a door. The courier will try twice. If both fail the parcel comes back to us and we will arrange it again with you.",
        ],
      },
      {
        heading: "Outside India",
        body: [
          "We do not ship abroad from this website. If you are overseas and want a reference we carry, write to us and we will tell you honestly whether it can be done.",
        ],
      },
    ],
  },
  {
    slug: "warranty",
    title: "Warranty and service",
    lead: "Whose warranty it is, what it covers, and what our workshop does.",
    updated: "October 2026",
    sections: [
      {
        heading: "The warranty is the brand's",
        body: [
          "Every watch we sell carries its manufacturer's international warranty, usually two years and longer on some houses. It runs from the date on your invoice, and the card in the box is what you claim against. We are an authorised dealer, so that card is valid — which is the whole reason to buy from one.",
        ],
      },
      {
        heading: "What a warranty covers",
        body: [
          "Manufacturing defects: a movement that will not keep time within the brand's own tolerance, a crown that fails, a crystal that separates. It does not cover accidental damage, water entry where the gasket was disturbed, a scratched case, a worn strap, or a battery after the first one.",
          "Opening a watch anywhere other than an authorised workshop ends the warranty. If something is wrong, bring it to us before anybody else touches it.",
        ],
      },
      {
        heading: "Our own workshop",
        body: [
          "We have an in-house service centre and have run one since long before it was expected of a retailer. Battery changes, gasket and seal work, bracelet sizing and adjustment, crystal replacement and full servicing are all done here; movement work under a brand's warranty goes to that brand's own centre, which is where it must go.",
          "Book through the Repair & Services page. You will get a job card with a reference, and we will quote before any chargeable work starts — we do not begin and bill afterwards.",
        ],
      },
      {
        heading: "What service costs",
        body: [
          "A quote, always, before the work. Charges depend on the movement and what it needs, and the estimate we give you is what you pay unless we find something further and tell you first.",
        ],
      },
    ],
  },
];

export const legalBySlug = (slug: string) => LEGAL.find((document) => document.slug === slug);
