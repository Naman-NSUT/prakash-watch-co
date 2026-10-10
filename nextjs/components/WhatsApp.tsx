"use client";

import { usePathname } from "next/navigation";

/**
 * A way to start a conversation.
 *
 * India buys watches by message. A phone number asks someone to leave the page,
 * open the dialler and speak to a stranger; this opens a chat they can send at
 * eleven at night and read the reply to in the morning.
 *
 * It floats above the page rather than sitting in the footer, because the
 * moment someone wants to ask "do you have this in blue" is while they are
 * looking at the watch, not after they have scrolled to the bottom.
 */
const NUMBER = "919899645897";

export default function WhatsApp({ message }: { message?: string }) {
  // The shop's own rooms have a telephone and the customer in front of them.
  const pathname = usePathname();
  if (pathname.startsWith("/admin") || pathname === "/login") return null;

  const text = encodeURIComponent(message ?? "Hello — I saw a watch on your website and wanted to ask about it.");

  return (
    <a
      className="whatsapp"
      href={`https://wa.me/${NUMBER}?text=${text}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Message the shop on WhatsApp"
      title="Message us on WhatsApp"
    >
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden focusable="false">
        <path
          fill="currentColor"
          d="M16.04 3.2c-7.1 0-12.87 5.77-12.87 12.87 0 2.27.6 4.49 1.73 6.44L3.2 28.8l6.46-1.69a12.8 12.8 0 0 0 6.38 1.7h.01c7.1 0 12.87-5.77 12.87-12.87S23.14 3.2 16.04 3.2zm0 23.14h-.01a10.7 10.7 0 0 1-5.45-1.49l-.39-.23-4.04 1.06 1.08-3.94-.26-.4a10.65 10.65 0 0 1-1.63-5.68c0-5.9 4.8-10.7 10.7-10.7 2.86 0 5.54 1.11 7.56 3.14a10.62 10.62 0 0 1 3.13 7.57c0 5.9-4.8 10.67-10.69 10.67zm5.86-7.99c-.32-.16-1.9-.94-2.19-1.04-.3-.11-.51-.16-.73.16-.21.32-.83 1.04-1.02 1.26-.19.21-.38.24-.7.08-.32-.16-1.35-.5-2.58-1.59-.95-.85-1.6-1.9-1.78-2.22-.19-.32-.02-.5.14-.66.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55l-.62-.01c-.21 0-.56.08-.86.4-.29.32-1.12 1.1-1.12 2.68s1.15 3.11 1.31 3.32c.16.21 2.27 3.46 5.5 4.85.77.33 1.37.53 1.83.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37z"
        />
      </svg>
    </a>
  );
}
