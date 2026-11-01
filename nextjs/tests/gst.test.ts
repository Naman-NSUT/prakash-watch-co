import assert from "node:assert/strict";
import test from "node:test";
import { splitInclusiveGst } from "../lib/gst";

test("splits GST out of a customer-facing ticket price", () => {
  assert.deepEqual(splitInclusiveGst(12_000, 18), {
    taxable: 10_169.49,
    gstAmount: 1_830.51,
  });
});

test("keeps zero-rated and empty totals stable", () => {
  assert.deepEqual(splitInclusiveGst(12_000, 0), { taxable: 12_000, gstAmount: 0 });
  assert.deepEqual(splitInclusiveGst(0, 18), { taxable: 0, gstAmount: 0 });
});
