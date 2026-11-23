/**
 * Minimum-cell disclosure guard for aggregate analytics payloads.
 *
 * The guard intentionally suppresses the whole payload when any positive count below the
 * configured minimum appears anywhere inside it. That coarse rule avoids exposing a small
 * cell through its percentage, denominator, complementary cells, status breakdown, or summary
 * statistic. Zero cells are retained: they contain no respondents, though repeated/differencing
 * queries and outside knowledge can still disclose information. This is a disclosure reduction,
 * not a claim of anonymity or differential privacy.
 *
 * Apply this immediately before every aggregate response/export/cache read. In particular,
 * previously persisted analytics runs must be checked against the current workspace setting.
 * Person-level answer records are outside this aggregate-only helper and require authorization.
 */
export const DEFAULT_ANALYTICS_MIN_CELL_SIZE = 5;
export const MIN_ANALYTICS_MIN_CELL_SIZE = 2;
export const MAX_ANALYTICS_MIN_CELL_SIZE = 100;

export type MinimumCellSuppression<T> =
  | { suppressed: false; minimumCellSize: number; value: T }
  | { suppressed: true; minimumCellSize: number; reason: "minimum_cell_size" };

/** Workspace setting validation shared by settings and analytics integrations. */
export function isValidAnalyticsMinCellSize(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= MIN_ANALYTICS_MIN_CELL_SIZE
    && value <= MAX_ANALYTICS_MIN_CELL_SIZE;
}

/**
 * Suppress an aggregate analytics payload if it contains any positive count below `minimumCellSize`.
 *
 * Recognizes the summary/segment/crosstab schemas by their count and denominator field names,
 * and explicitly treats every value in `statusCounts` as a count. The output is a discriminated
 * union: when suppressed, no part of the original payload is returned, preventing callers from
 * accidentally leaking an exact count or a derived percentage alongside a suppression marker.
 */
export function suppressSmallCohortAnalytics<T>(
  value: T,
  minimumCellSize: number = DEFAULT_ANALYTICS_MIN_CELL_SIZE,
): MinimumCellSuppression<T> {
  if (!isValidAnalyticsMinCellSize(minimumCellSize)) {
    throw new RangeError(`minimumCellSize must be an integer from ${MIN_ANALYTICS_MIN_CELL_SIZE} to ${MAX_ANALYTICS_MIN_CELL_SIZE}.`);
  }

  if (containsSmallCount(value, minimumCellSize)) {
    return { suppressed: true, minimumCellSize, reason: "minimum_cell_size" };
  }

  return { suppressed: false, minimumCellSize, value };
}

const COUNT_KEY = /^(?:count|participantCount|respondentCount|submittedCount|cohortCount|eligibleCount|inactiveCount|answeredCount|noAnswerCount|missingCount|noteOnlyCount|unmappedResponseCount|distributionDenominator|distributionUnmappedResponseCount|numericUnmappedResponseCount|numericCount|validResponseCount|validResponses|responseCount|rowDenominator|n)$/i;

function containsSmallCount(value: unknown, minimum: number, parentKey = "", seen = new Set<object>()): boolean {
  if (typeof value === "number") {
    const isCount = COUNT_KEY.test(parentKey) || parentKey === "statusCounts";
    return isCount && value > 0 && value < minimum;
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    if (/^singleton/i.test(parentKey) && value.length > 0) return true;
    return value.some((entry) => containsSmallCount(entry, minimum, parentKey, seen));
  }

  for (const [key, child] of Object.entries(value)) {
    if (/^singleton/i.test(key) && (child === true || (Array.isArray(child) && child.length > 0))) return true;
    const childKey = parentKey === "statusCounts" || key === "statusCounts" ? "statusCounts" : key;
    if (containsSmallCount(child, minimum, childKey, seen)) return true;
  }
  return false;
}
