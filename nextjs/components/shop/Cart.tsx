"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The bag.
 *
 * It holds references and quantities and nothing else — no prices. What a watch
 * costs is settled on the server from the catalogue at checkout, because a cart
 * that carried its own prices would be a way to buy a Tissot for a rupee. The
 * titles and pictures here are only so the bag can be drawn without a round
 * trip; they are never trusted for anything that matters.
 *
 * It lives in localStorage, so it survives a reload and a closed tab on the
 * same browser, and nowhere else. A bag is not an order.
 */
const KEY = "pwc-bag";

export interface BagItem {
  sku: string;
  slug: string;
  title: string;
  brand: string;
  image: string;
  /** For display only. The server prices the order. */
  price: number;
  quantity: number;
}

interface Bag {
  items: BagItem[];
  count: number;
  add: (item: Omit<BagItem, "quantity">, quantity?: number) => void;
  setQuantity: (sku: string, quantity: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
  ready: boolean;
}

const BagContext = createContext<Bag | null>(null);

function read(): BagItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BagItem =>
        item && typeof item.sku === "string" && Number.isFinite(item.quantity) && item.quantity > 0,
    );
  } catch {
    // A private window, or something else's data under our key.
    return [];
  }
}

export function BagProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BagItem[]>([]);
  // Until localStorage has been read the bag is unknown, and a count of 0 drawn
  // before that would flicker to 3 a moment later.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(read());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      // Out of quota or refused; the bag lasts the session.
    }
  }, [items, ready]);

  // Another tab of the same shop is the same bag.
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === KEY) setItems(read());
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const add = useCallback((item: Omit<BagItem, "quantity">, quantity = 1) => {
    setItems((current) => {
      const existing = current.find((line) => line.sku === item.sku);
      if (existing) {
        return current.map((line) =>
          line.sku === item.sku ? { ...line, quantity: Math.min(9, line.quantity + quantity) } : line,
        );
      }
      return [...current, { ...item, quantity }];
    });
  }, []);

  const setQuantity = useCallback((sku: string, quantity: number) => {
    setItems((current) =>
      quantity <= 0
        ? current.filter((line) => line.sku !== sku)
        : current.map((line) => (line.sku === sku ? { ...line, quantity: Math.min(9, quantity) } : line)),
    );
  }, []);

  const remove = useCallback((sku: string) => {
    setItems((current) => current.filter((line) => line.sku !== sku));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<Bag>(
    () => ({
      items,
      count: items.reduce((sum, line) => sum + line.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
      ready,
    }),
    [items, add, setQuantity, remove, clear, ready],
  );

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): Bag {
  const bag = useContext(BagContext);
  if (!bag) throw new Error("useBag outside BagProvider");
  return bag;
}
