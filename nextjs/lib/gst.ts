/** Money rounded to the precision stored on invoices and in the books. */
export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Split a customer-facing, GST-inclusive price into its taxable value and tax.
 * A ₹12,000 ticket remains ₹12,000 at the till; GST is contained in that price.
 */
export function splitInclusiveGst(total: number, rate: number) {
  const taxable = rate > 0 ? roundMoney(total / (1 + rate / 100)) : roundMoney(total);
  return { taxable, gstAmount: roundMoney(total - taxable) };
}
