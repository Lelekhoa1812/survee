import type { DescriptiveStats } from "./summary";

export function formatPercentage(value: number): string {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

/** Describe how reported number quartiles were calculated without implying rank guarantees. */
export function describeNumericQuantiles(stats: DescriptiveStats): string {
  if (!stats.quantiles.approximate) {
    return "Quartiles are calculated exactly from the observed answers using Hyndman–Fan type 7.";
  }
  if (stats.quantiles.binsCollapsed || stats.quantiles.mappingRangeExceeded) {
    const reasons = [
      ...(stats.quantiles.binsCollapsed ? ["its capped bins collapsed"] : []),
      ...(stats.quantiles.mappingRangeExceeded ? ["some values were outside the sketch's mapped range"] : []),
    ].join(" and ");
    return `Quartiles are estimated with DDSketch; ${reasons}, so no relative-value error bound applies. Minimum, maximum, and mean use all ${stats.n} valid numeric answers.`;
  }
  return `Quartiles are estimated with DDSketch (up to ${stats.quantiles.relativeValueAccuracy! * 100}% relative-value error). Minimum, maximum, and mean use all ${stats.n} valid numeric answers.`;
}

export function numericQuantileMethodLabel(stats: DescriptiveStats): string {
  if (!stats.quantiles.approximate) return "Hyndman–Fan type 7 (exact)";
  if (stats.quantiles.binsCollapsed || stats.quantiles.mappingRangeExceeded) {
    const reasons = [
      ...(stats.quantiles.binsCollapsed ? ["collapsed bins"] : []),
      ...(stats.quantiles.mappingRangeExceeded ? ["mapped range exceeded"] : []),
    ].join("; ");
    return `DDSketch (${reasons}; no error bound)`;
  }
  return `DDSketch (up to ${stats.quantiles.relativeValueAccuracy! * 100}% relative-value error)`;
}
