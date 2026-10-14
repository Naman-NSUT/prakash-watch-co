"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBag, type BagItem } from "./Cart";

/**
 * Putting a watch in the bag, for the houses the shop sells online.
 *
 * Two ways through, because people shop both ways: add it and carry on looking,
 * or buy this one and be done. The second is the first plus a redirect, so
 * there is only one path to maintain.
 */
export default function AddToBag({ item }: { item: Omit<BagItem, "quantity"> }) {
  const bag = useBag();
  const router = useRouter();
  const [added, setAdded] = useState(false);

  const inBag = bag.items.find((line) => line.sku === item.sku)?.quantity ?? 0;

  function add() {
    bag.add(item);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 2200);
  }

  return (
    <>
      <button type="button" className="btn btn-solid" onClick={add}>
        {added ? "In the bag ✓" : inBag > 0 ? `Add another (${inBag} in the bag)` : "Add to bag"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          if (inBag === 0) bag.add(item);
          router.push("/checkout");
        }}
      >
        Buy it now
      </button>
    </>
  );
}
