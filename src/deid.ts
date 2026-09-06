import { BUILTIN_DETECTORS } from './detectors';
import { resolveSpans } from './merge';
import { SurrogateContext } from './surrogates';
import type {
  DeidOptions,
  DeidResult,
  NerFn,
  PhiSpan,
  PseudonymizeOptions,
  PseudonymizeResult,
  RedactOptions,
  ReplacedSpan,
} from './types';

function runDetectors(text: string, options: DeidOptions): PhiSpan[] {
  const detectors = [...BUILTIN_DETECTORS, ...(options.detectors ?? [])];
  return detectors.flatMap((d) => d.detect(text));
}

/** Finds PHI with the built-in rules (plus any custom detectors). Sync. */
export function detectPhi(text: string, options: DeidOptions = {}): PhiSpan[] {
  return resolveSpans(runDetectors(text, options), options);
}

/** Like detectPhi, additionally merging spans from an async recognizer (NER). */
export async function detectPhiAsync(text: string, ner: NerFn, options: DeidOptions = {}): Promise<PhiSpan[]> {
  const [ruleSpans, nerSpans] = await Promise.all([runDetectors(text, options), ner(text)]);
  return resolveSpans([...ruleSpans, ...nerSpans], options);
}

/** Rewrites text by replacing each span, tracking offsets into the output. */
export function applyReplacements(
  text: string,
  spans: PhiSpan[],
  replacement: (span: PhiSpan) => string,
): DeidResult {
  let out = '';
  let cursor = 0;
  const replaced: ReplacedSpan[] = [];
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    const value = replacement(span);
    replaced.push({ ...span, replacement: value, outStart: out.length, outEnd: out.length + value.length });
    out += value;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return { text: out, spans: replaced };
}

const defaultPlaceholder = (span: PhiSpan) => `[${span.category.toUpperCase()}]`;

/** Replaces PHI with placeholders like `[NAME]` and `[DATE]`. */
export function redact(text: string, options: RedactOptions = {}): DeidResult {
  const spans = detectPhi(text, options);
  return applyReplacements(text, spans, (s) => (options.placeholder ? options.placeholder(s.category, s) : defaultPlaceholder(s)));
}

export async function redactAsync(text: string, ner: NerFn, options: RedactOptions = {}): Promise<DeidResult> {
  const spans = await detectPhiAsync(text, ner, options);
  return applyReplacements(text, spans, (s) => (options.placeholder ? options.placeholder(s.category, s) : defaultPlaceholder(s)));
}

function pseudonymizeSpans(text: string, spans: PhiSpan[], options: PseudonymizeOptions): PseudonymizeResult {
  const dateShiftDays = options.dateShiftDays ?? 1 + Math.floor(Math.random() * 365);
  const ctx = new SurrogateContext(dateShiftDays);
  const result = applyReplacements(text, spans, (s) => ctx.surrogate(s));
  return { ...result, map: ctx.entries(), dateShiftDays };
}

/**
 * Replaces PHI with consistent, realistic-looking surrogates: the same
 * name maps to the same surrogate throughout, and all dates shift by
 * one offset so intervals are preserved. The returned map is the
 * re-identification key - handle it as PHI.
 */
export function pseudonymize(text: string, options: PseudonymizeOptions = {}): PseudonymizeResult {
  return pseudonymizeSpans(text, detectPhi(text, options), options);
}

export async function pseudonymizeAsync(
  text: string,
  ner: NerFn,
  options: PseudonymizeOptions = {},
): Promise<PseudonymizeResult> {
  return pseudonymizeSpans(text, await detectPhiAsync(text, ner, options), options);
}
