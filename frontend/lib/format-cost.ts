/** Format an approximate USD cost for display.
 *
 * Sub-cent sessions are common (a merged-call turn is fractions of a cent), so
 * plain "$0.00" would be misleading. We show enough precision to be non-zero.
 */
export function formatCost(usd: number | null | undefined): string {
  const value = Number(usd) || 0;
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
