/**
 * Dosha Trend Analyzer
 * @module Ayurveda
 * @description Utility for analyzing dosha trend data from timeline events
 */

import { DoshaType } from '@services/ayurveda/dto';

/**
 * Severity levels for dosha imbalances mapped to numeric scores.
 */
const SEVERITY_SCORE_MAP: Record<string, number> = {
  mild: 1,
  moderate: 2,
  severe: 3,
};

/**
 * Default trend direction for unknown results.
 */
const DEFAULT_TREND_DIRECTION = 'stable' as const;

/**
 * Threshold for considering a change significant (20% of baseline).
 */
const TREND_THRESHOLD_RATIO = 0.2;

/**
 * Converts a severity string to a numeric score for trend analysis.
 *
 * @param severity - Severity level string (mild, moderate, severe)
 * @returns Numeric score (1, 2, or 3)
 */
export function severityToScore(severity: string): number {
  return SEVERITY_SCORE_MAP[severity.toLowerCase()] ?? 1;
}

/**
 * Computes the direction of a trend (increasing, decreasing, or stable).
 *
 * Uses a threshold of 20% of the baseline score to determine significance.
 *
 * @param points - Array of data points with dates and scores
 * @returns Trend direction classification
 */
export function computeTrendDirection(
  points: Array<{ date: string; score: number }>
): 'increasing' | 'decreasing' | 'stable' {
  if (points.length < 2) {
    return DEFAULT_TREND_DIRECTION;
  }

  const first = points[0]!.score;
  const last = points[points.length - 1]!.score;
  const change = last - first;
  const threshold = first * TREND_THRESHOLD_RATIO;

  if (change > threshold) return 'increasing';
  if (change < -threshold) return 'decreasing';
  return 'stable';
}

/**
 * Sorts an array of dosha trend points chronologically (oldest first).
 *
 * @param points - Array of dosha data points
 * @returns Points sorted by date ascending
 */
export function sortPointsChronologically(
  points: Array<{ date: string; score: number }>
): Array<{ date: string; score: number }> {
  return [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Computes dosha trend analysis from timeline events.
 *
 * @param events - Timeline events from various Ayurvedic sources
 * @returns Trend analysis per dosha type with points and direction
 */
type TimelineEvent = {
  type: string;
  assessedAt?: string | undefined;
  diagnosedAt?: string | undefined;
  createdAt?: string | undefined;
  severity?: string | undefined;
  doshaType?: string | undefined;
  vataScore?: number | undefined;
  pittaScore?: number | undefined;
  kaphaScore?: number | undefined;
};

export function computeDoshaTrend(events: TimelineEvent[]): Record<string, unknown> {
  const trend: Record<DoshaType, Array<{ date: string; score: number }>> = {
    [DoshaType.VATA]: [],
    [DoshaType.PITTA]: [],
    [DoshaType.KAPHA]: [],
  };

  for (const event of events) {
    if (event.type === 'prakriti') {
      trend[DoshaType.VATA].push({
        date: event.assessedAt ?? '',
        score: event.vataScore ?? 0,
      });
      trend[DoshaType.PITTA].push({
        date: event.assessedAt ?? '',
        score: event.pittaScore ?? 0,
      });
      trend[DoshaType.KAPHA].push({
        date: event.assessedAt ?? '',
        score: event.kaphaScore ?? 0,
      });
    }

    if (event.type === 'dosha_imbalance') {
      const doshaType = event.doshaType as DoshaType;
      const severityScore = severityToScore(event.severity ?? 'mild');
      trend[doshaType].push({
        date: event.assessedAt ?? '',
        score: severityScore,
      });
    }
  }

  const trendAnalysis: Record<string, unknown> = {};
  for (const [dosha, points] of Object.entries(trend)) {
    const sortedPoints = sortPointsChronologically(points);
    trendAnalysis[dosha] = {
      points: sortedPoints,
      direction: computeTrendDirection(sortedPoints),
    };
  }

  return trendAnalysis;
}
