/**
 * HIPAA Safe Harbor identifier categories (45 CFR 164.514(b)(2)), plus
 * `age` for ages over 89 and `id` for other unique identifying codes.
 */
export type PhiCategory =
  | 'name'
  | 'address'
  | 'zip'
  | 'date'
  | 'age'
  | 'phone'
  | 'fax'
  | 'email'
  | 'ssn'
  | 'mrn'
  | 'account'
  | 'license'
  | 'vehicle'
  | 'device'
  | 'url'
  | 'ip'
  | 'id';

export const PHI_CATEGORIES: readonly PhiCategory[] = [
  'name', 'address', 'zip', 'date', 'age', 'phone', 'fax', 'email', 'ssn',
  'mrn', 'account', 'license', 'vehicle', 'device', 'url', 'ip', 'id',
];

/** A detected identifier; offsets index the original text exactly. */
export interface PhiSpan {
  category: PhiCategory;
  /** Inclusive character offset into the source. */
  start: number;
  /** Exclusive character offset into the source. */
  end: number;
  /** Exactly source.slice(start, end). */
  text: string;
  /** 0-1; rule-based detectors report their fixed confidence. */
  confidence: number;
  /** Which detector produced it. */
  source: string;
}

/** A detector scans text and returns candidate spans (may overlap others). */
export interface Detector {
  name: string;
  detect(text: string): PhiSpan[];
}

/** Async entity recognizer, e.g. an on-device NER model - see deid/transformers. */
export type NerFn = (text: string) => Promise<PhiSpan[]>;

export interface DeidOptions {
  /** Restrict detection to these categories (default: all). */
  categories?: readonly PhiCategory[];
  /** Terms that must never be flagged (hospital names, drug names, ...). */
  allow?: readonly (string | RegExp)[];
  /** Extra detectors merged with the built-in rules. */
  detectors?: readonly Detector[];
  /** Drop spans below this confidence (default 0). */
  minConfidence?: number;
}

export interface RedactOptions extends DeidOptions {
  /** Placeholder per category; default `[CATEGORY]` uppercased. */
  placeholder?: (category: PhiCategory, span: PhiSpan) => string;
}

export interface PseudonymizeOptions extends DeidOptions {
  /** Days to shift every date by (default: random 1-365, returned in the result). */
  dateShiftDays?: number;
}

/** A span after replacement, with offsets into the OUTPUT text. */
export interface ReplacedSpan extends PhiSpan {
  replacement: string;
  outStart: number;
  outEnd: number;
}

export interface DeidResult {
  text: string;
  spans: ReplacedSpan[];
}

export interface PseudonymizeResult extends DeidResult {
  /** original value -> surrogate. This is the re-identification key: store it securely. */
  map: Record<string, string>;
  dateShiftDays: number;
}
