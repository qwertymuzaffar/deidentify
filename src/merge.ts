import type { DeidOptions, PhiSpan } from './types';

/**
 * Resolves overlapping candidates: higher confidence wins, then the
 * longer span. Output is sorted, non-overlapping, and filtered by the
 * allow list, category subset, and minimum confidence.
 */
export function resolveSpans(spans: PhiSpan[], options: DeidOptions = {}): PhiSpan[] {
  const categories = options.categories ? new Set(options.categories) : null;
  const allow = options.allow ?? [];
  const minConfidence = options.minConfidence ?? 0;

  const candidates = spans
    .filter((s) => s.end > s.start)
    .filter((s) => !categories || categories.has(s.category))
    .filter((s) => s.confidence >= minConfidence)
    .filter((s) => !isAllowed(s.text, allow))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const kept: PhiSpan[] = [];
  for (const span of candidates) {
    const last = kept[kept.length - 1];
    if (!last || span.start >= last.end) {
      kept.push(span);
      continue;
    }
    const better =
      span.confidence > last.confidence ||
      (span.confidence === last.confidence && span.end - span.start > last.end - last.start);
    if (better) kept[kept.length - 1] = span;
  }
  return mergeTouching(kept);
}

/** Joins spans of the same category that touch (e.g. NER word-piece splits). */
function mergeTouching(spans: PhiSpan[]): PhiSpan[] {
  const out: PhiSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && last.category === span.category && span.start === last.end) {
      out[out.length - 1] = {
        ...last,
        end: span.end,
        text: last.text + span.text,
        confidence: Math.min(last.confidence, span.confidence),
      };
    } else {
      out.push(span);
    }
  }
  return out;
}

function isAllowed(text: string, allow: readonly (string | RegExp)[]): boolean {
  return allow.some((entry) =>
    typeof entry === 'string' ? entry.toLowerCase() === text.toLowerCase() : entry.test(text),
  );
}
