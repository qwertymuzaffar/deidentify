import { detectPhi, detectPhiAsync } from './deid';
import { PHI_CATEGORIES } from './types';
import type { DeidOptions, NerFn, PhiCategory, PhiSpan } from './types';

export type RiskLevel = 'low' | 'medium' | 'high';

/** Identifier groups that re-identify in combination rather than alone. */
export type QuasiIdentifier = 'date' | 'geography' | 'age';

const QUASI_GROUPS: ReadonlyArray<{ group: QuasiIdentifier; categories: readonly PhiCategory[] }> = [
  { group: 'date', categories: ['date'] },
  { group: 'geography', categories: ['address', 'zip'] },
  { group: 'age', categories: ['age'] },
];

const QUASI_CATEGORIES = new Set<PhiCategory>(QUASI_GROUPS.flatMap((entry) => entry.categories));

export interface PhiSummary {
  /** Spans per category; every category is listed, zero when absent. */
  counts: Record<PhiCategory, number>;
  /** Distinct values per category (trimmed, case-insensitive). */
  distinct: Record<PhiCategory, number>;
  /** Categories with at least one span, in `PHI_CATEGORIES` order. */
  present: PhiCategory[];
  /** Spans in total. */
  total: number;
  /** Direct identifiers found: every present category except dates, geography and ages. */
  direct: PhiCategory[];
  /** Quasi-identifier groups found: dates, geography (address, zip), ages. */
  quasi: QuasiIdentifier[];
  /** Two or more quasi-identifier groups appear in the same document. */
  cooccurring: boolean;
  /** Coarse re-identification risk of the document as detected. */
  risk: RiskLevel;
  /** The rules behind `risk`, in the order they were evaluated. */
  reasons: string[];
}

function emptyCounts(): Record<PhiCategory, number> {
  const counts = {} as Record<PhiCategory, number>;
  for (const category of PHI_CATEGORIES) counts[category] = 0;
  return counts;
}

const describe = (categories: readonly PhiCategory[], counts: Record<PhiCategory, number>) =>
  categories.map((category) => `${category} (${counts[category]})`).join(', ');

const GROUP_LABELS: Record<QuasiIdentifier, string> = { date: 'dates', geography: 'geography', age: 'ages' };

/**
 * Per-document identifier counts and a coarse re-identification risk, for
 * expert-determination review queues. Pass the spans you already have (from
 * `detectPhi` or `detectPhiAsync`) or the note itself to run the rules.
 *
 * Risk bands: `high` when any direct identifier is present or dates,
 * geography and ages all co-occur; `medium` when two quasi-identifier groups
 * co-occur; `low` otherwise. This is documentation infrastructure, not a
 * compliance determination - see the README.
 */
export function summarize(input: string | readonly PhiSpan[], options: DeidOptions = {}): PhiSummary {
  const spans = typeof input === 'string' ? detectPhi(input, options) : input;
  const counts = emptyCounts();
  const values = new Map<PhiCategory, Set<string>>();
  for (const span of spans) {
    counts[span.category] += 1;
    const seen = values.get(span.category) ?? new Set<string>();
    seen.add(span.text.trim().toLowerCase());
    values.set(span.category, seen);
  }
  const distinct = emptyCounts();
  for (const [category, seen] of values) distinct[category] = seen.size;

  const present = PHI_CATEGORIES.filter((category) => counts[category] > 0);
  const direct = present.filter((category) => !QUASI_CATEGORIES.has(category));
  const quasi = QUASI_GROUPS.filter((entry) => entry.categories.some((category) => counts[category] > 0)).map((entry) => entry.group);
  const cooccurring = quasi.length >= 2;

  const reasons: string[] = [];
  let risk: RiskLevel = 'low';
  if (direct.length > 0) {
    risk = 'high';
    reasons.push(`direct identifiers present: ${describe(direct, counts)}`);
  }
  if (quasi.length === QUASI_GROUPS.length) {
    risk = 'high';
    reasons.push('dates, geography and ages co-occur');
  } else if (cooccurring) {
    if (risk === 'low') risk = 'medium';
    reasons.push(`quasi-identifiers co-occur: ${quasi.map((group) => GROUP_LABELS[group]).join(', ')}`);
  } else if (quasi.length === 1) {
    reasons.push(`only ${GROUP_LABELS[quasi[0]]} present among the quasi-identifiers`);
  }
  if (spans.length === 0) reasons.push('no identifiers found');

  return { counts, distinct, present, total: spans.length, direct, quasi, cooccurring, risk, reasons };
}

/** `summarize` over the rules plus an async recognizer (NER). */
export async function summarizeAsync(text: string, ner: NerFn, options: DeidOptions = {}): Promise<PhiSummary> {
  return summarize(await detectPhiAsync(text, ner, options), options);
}

export interface RenderSummaryOptions {
  /** Heading text (default "PHI summary"). */
  title?: string;
}

/** Renders a summary as Markdown for a review queue or a report. */
export function renderSummary(summary: PhiSummary, options: RenderSummaryOptions = {}): string {
  const lines: string[] = [`## ${options.title ?? 'PHI summary'}: ${summary.risk} risk`, ''];
  if (summary.present.length === 0) {
    lines.push('No identifiers found.', '');
  } else {
    lines.push(`${summary.total} identifier span${summary.total === 1 ? '' : 's'} across ${summary.present.length} categor${summary.present.length === 1 ? 'y' : 'ies'}.`, '');
    lines.push('| Category | Spans | Distinct |', '| --- | --- | --- |');
    for (const category of summary.present) lines.push(`| ${category} | ${summary.counts[category]} | ${summary.distinct[category]} |`);
    lines.push('');
    const groups = summary.quasi.map((group) => GROUP_LABELS[group]).join(', ');
    lines.push(`Quasi-identifiers: ${summary.quasi.length > 0 ? groups : 'none'}${summary.cooccurring ? ' (co-occurring)' : ''}.`, '');
  }
  lines.push('### Why', '');
  for (const reason of summary.reasons) lines.push(`- ${reason}`);
  lines.push('', 'Documentation infrastructure, not a compliance determination.');
  return lines.join('\n');
}
