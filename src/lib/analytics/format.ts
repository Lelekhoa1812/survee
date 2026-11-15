export function formatPercentage(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}
