import { isAllowed } from './merge';
import type { NoteSection, PhiSpan, SectionName, SectionRule, SectionsOption } from './types';

type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

interface HeaderPattern {
  name: SectionName;
  /** Header words matched at the start of a line, case-insensitively, followed by a colon, a dash, or the end of the line. */
  words: string;
  /** Short forms that count as headers only when a colon follows (S:, O:, A:, P:, ...). */
  short?: string;
  /** Phrases that run straight into their content ("Signed by Dr. Lee"): a word boundary is enough. */
  loose?: string;
}

const HEADER_PATTERNS: readonly HeaderPattern[] = [
  { name: 'subjective', words: 'Subjective|Chief\\s+Complaint', short: 'S|CC' },
  { name: 'hpi', words: 'History\\s+of\\s+(?:the\\s+)?Present\\s+Illness|HPI' },
  { name: 'pmh', words: 'Past\\s+Medical\\s+History|Medical\\s+History|PMHx?' },
  { name: 'medications', words: 'Current\\s+Medications|Medication\\s+List|Medications?|Meds' },
  { name: 'allergies', words: 'Allergies|Allergy' },
  { name: 'social-history', words: 'Social\\s+History|Social\\s+Hx', short: 'SH' },
  { name: 'family-history', words: 'Family\\s+History|Family\\s+Hx', short: 'FH' },
  { name: 'objective', words: 'Objective|Physical\\s+Exam(?:ination)?', short: 'O' },
  { name: 'assessment', words: 'Assessment(?:\\s*(?:and|&|/)\\s*Plan)?|Impression|A/P', short: 'A' },
  { name: 'plan', words: 'Plan(?:\\s+of\\s+Care)?|Treatment\\s+Plan|Recommendations', short: 'P' },
  { name: 'signature', words: 'Signature|Electronically\\s+signed|Signed|Attestation', loose: 'Electronically\\s+signed\\s+by|Signed\\s+by|Dictated\\s+by' },
];

type Delimiter = 'colon' | 'line' | 'boundary';

const DELIMITERS: Record<Delimiter, string> = {
  colon: '(?=[ \\t]*:)',
  line: '(?=[ \\t]*(?::|-|$))',
  boundary: '(?![A-Za-z])',
};

function headerRegex(alternatives: string, delimiter: Delimiter): RegExp {
  return new RegExp(`^[ \\t]*(${alternatives})${DELIMITERS[delimiter]}`, 'gmid');
}

const HEADER_MATCHERS: ReadonlyArray<{ name: SectionName; regex: RegExp }> = HEADER_PATTERNS.flatMap((pattern) => {
  const matchers = [{ name: pattern.name, regex: headerRegex(pattern.words, 'line') }];
  if (pattern.short) matchers.push({ name: pattern.name, regex: headerRegex(pattern.short, 'colon') });
  if (pattern.loose) matchers.push({ name: pattern.name, regex: headerRegex(pattern.loose, 'boundary') });
  return matchers;
});

interface HeaderMatch {
  name: SectionName;
  text: string;
  /** Offset of the header line's first character. */
  start: number;
}

function findHeaders(text: string): HeaderMatch[] {
  const byLineStart = new Map<number, HeaderMatch>();
  for (const matcher of HEADER_MATCHERS) {
    for (const match of text.matchAll(matcher.regex) as IterableIterator<IndexedMatch>) {
      const range = match.indices?.[1];
      if (!range || match.index === undefined) continue;
      const candidate: HeaderMatch = { name: matcher.name, text: text.slice(range[0], range[1]), start: match.index };
      const existing = byLineStart.get(candidate.start);
      // the longest header wins a line: "Assessment and Plan" over "Assessment"
      if (!existing || candidate.text.length > existing.text.length) byLineStart.set(candidate.start, candidate);
    }
  }
  return [...byLineStart.values()].sort((left, right) => left.start - right.start);
}

/**
 * Splits a clinical note into sections by its headers: Subjective / Objective /
 * Assessment / Plan (also S:, O:, A:, P:), HPI, PMH, Medications, Allergies,
 * Social History, Family History, and the signature block. Headers are matched
 * at the start of a line, case-insensitively, in colon or line form.
 *
 * Sections tile the whole note in order: the first starts at 0, each ends where
 * the next begins, and the last ends at the text's end. Text before the first
 * header, or a note without headers, is one `other` section.
 */
export function detectSections(text: string): NoteSection[] {
  const headers = findHeaders(text);
  if (headers.length === 0) return [{ name: 'other', header: null, start: 0, end: text.length }];

  const sections: NoteSection[] = [];
  const preamble = text.slice(0, headers[0].start);
  if (preamble.trim().length > 0) sections.push({ name: 'other', header: null, start: 0, end: headers[0].start });

  headers.forEach((header, index) => {
    // a whitespace-only preamble folds into the first header's section so the sections still start at 0
    const start = index === 0 && sections.length === 0 ? 0 : header.start;
    const end = index + 1 < headers.length ? headers[index + 1].start : text.length;
    sections.push({ name: header.name, header: header.text, start, end });
  });
  return sections;
}

/** The section containing `offset`: the last one starting at or before it. */
export function sectionAt(sections: readonly NoteSection[], offset: number): NoteSection | undefined {
  let found: NoteSection | undefined;
  for (const section of sections) {
    if (section.start <= offset) found = section;
    else break;
  }
  return found ?? sections[0];
}

/** A detector's raw span, tagged with the detector that produced it. */
export interface Candidate {
  span: PhiSpan;
  detector: string;
}

function ruleFor(rules: NonNullable<SectionsOption['rules']>, section: NoteSection): SectionRule | undefined {
  return rules[section.name] ?? rules['*'];
}

/** `detectors` and `skip` entries name either a detector or a category. */
function names(entry: string, candidate: Candidate): boolean {
  return entry === candidate.detector || entry === candidate.span.category;
}

function passes(rule: SectionRule, candidate: Candidate): boolean {
  if (rule.enabled === false) return false;
  if (rule.detectors && !rule.detectors.some((entry) => names(entry, candidate))) return false;
  if (rule.skip?.some((entry) => names(entry, candidate))) return false;
  if (rule.allow && isAllowed(candidate.span.text, rule.allow)) return false;
  return true;
}

/**
 * Assigns every candidate to the section it starts in, drops the ones that
 * section's rule excludes, and records the section on `meta.section`.
 */
export function applySections(text: string, candidates: readonly Candidate[], option: SectionsOption | true): PhiSpan[] {
  const config: SectionsOption = option === true ? {} : option;
  const detected = (config.detect ?? detectSections)(text);
  const sections = detected.length > 0 ? detected : detectSections('');
  const rules = config.rules ?? {};
  const kept: PhiSpan[] = [];
  for (const candidate of candidates) {
    const section = sectionAt(sections, candidate.span.start) ?? sections[0];
    const rule = ruleFor(rules, section);
    if (rule && !passes(rule, candidate)) continue;
    kept.push({ ...candidate.span, meta: { ...candidate.span.meta, section: section.name } });
  }
  return kept;
}
