import { detectPhi, detectPhiAsync, detectSections, pseudonymize, redact } from './index';
import type { NoteSection, PhiSpan } from './index';

const SOAP = `Patient: John Smith   MRN: 4482913   DOB: 03/14/1951
Subjective:
Reports chest pain since 2024-02-03. Lives at 42 Maple Avenue, Fairfax, VA 22030.
Objective:
BP 132/84, HR 78. Daughter: Emily Smith present.
Assessment and Plan:
Likely GERD. Follow up March 8, 2024 with Dr. Maria Lopez. Contact: Emily Smith.
Signed by: Robert Chen, MD on 2024-02-05
Fax: 703-555-0199`;

const HEADERLESS = 'Patient: John Smith was seen on 2024-02-05 and given lisinopril 10 mg.';

const names = (spans: PhiSpan[]) => spans.filter((span) => span.category === 'name').map((span) => span.text);
const sectionOf = (spans: PhiSpan[], text: string) => spans.find((span) => span.text === text)?.meta?.section;

describe('detectSections', () => {
  const sections = detectSections(SOAP);

  it('finds SOAP headers in order, with the header text as written', () => {
    expect(sections.map((section) => section.name)).toEqual(['other', 'subjective', 'objective', 'assessment', 'signature']);
    expect(sections.map((section) => section.header)).toEqual([null, 'Subjective', 'Objective', 'Assessment and Plan', 'Signed by']);
  });

  it('tiles the whole note with exact offsets', () => {
    expect(sections[0].start).toBe(0);
    expect(sections[sections.length - 1].end).toBe(SOAP.length);
    for (let index = 1; index < sections.length; index++) expect(sections[index].start).toBe(sections[index - 1].end);
    for (const section of sections.slice(1)) {
      expect(SOAP.slice(section.start, section.end).trimStart().startsWith(section.header as string)).toBe(true);
    }
  });

  it('returns one other section for a note without headers, and for empty text', () => {
    expect(detectSections(HEADERLESS)).toEqual([{ name: 'other', header: null, start: 0, end: HEADERLESS.length }]);
    expect(detectSections('')).toEqual([{ name: 'other', header: null, start: 0, end: 0 }]);
  });

  it('recognizes short forms with a colon, line-form headers, and the other section names', () => {
    const note = ['S: pain', 'O: afebrile', 'A: viral', 'P: rest', 'HPI', 'two days', 'PMH: none', 'Meds: none', 'Allergies - NKDA', 'Social History:', 'Family Hx:', 'Electronically signed by Dr. Lee'].join('\n');
    expect(detectSections(note).map((section) => section.name)).toEqual([
      'subjective', 'objective', 'assessment', 'plan', 'hpi', 'pmh', 'medications', 'allergies', 'social-history', 'family-history', 'signature',
    ]);
  });

  it('does not treat header words used mid-sentence or without a delimiter as headers', () => {
    const note = 'Plan to follow up next week.\nMedications reviewed with the patient.\nS is for subjective.';
    expect(detectSections(note)).toHaveLength(1);
  });

  it('keeps a name on the line before a header out of the header', () => {
    const note = 'Patient: John Smith\nSubjective:\nfine';
    const spans = detectPhi(note, { sections: true });
    expect(spans.map((span) => [span.text, span.meta?.section])).toEqual([['John Smith', 'other']]);
    expect(detectSections(note).map((section) => section.name)).toEqual(['other', 'subjective']);
  });

  it('folds a whitespace-only preamble into the first section', () => {
    const note = '\n\nSubjective:\nfine';
    expect(detectSections(note)).toEqual([{ name: 'subjective', header: 'Subjective', start: 0, end: note.length }]);
  });
});

describe('sections option', () => {
  it('annotates meta.section on every span with sections: true', () => {
    const spans = detectPhi(SOAP, { sections: true });
    expect(spans.length).toBeGreaterThan(5);
    for (const span of spans) expect(span.meta?.section).toBeDefined();
    expect(sectionOf(spans, 'John Smith')).toBe('other');
    expect(sectionOf(spans, '2024-02-03')).toBe('subjective');
    expect(sectionOf(spans, 'Maria Lopez')).toBe('assessment');
    expect(sectionOf(spans, 'Robert Chen')).toBe('signature');
    expect(sectionOf(spans, '703-555-0199')).toBe('signature');
  });

  it('leaves the default output untouched when sections are off', () => {
    for (const span of detectPhi(SOAP)) expect(span.meta).toBeUndefined();
  });

  it('skips a category or detector in one section only', () => {
    const spans = detectPhi(SOAP, { sections: { rules: { signature: { skip: ['name'] } } } });
    expect(names(spans)).toEqual(['John Smith', 'Emily Smith', 'Maria Lopez', 'Emily Smith']);
    expect(sectionOf(spans, '2024-02-05')).toBe('signature');
    expect(sectionOf(spans, '703-555-0199')).toBe('signature');
  });

  it('runs only the listed detectors in a section and honors the wildcard', () => {
    const spans = detectPhi(SOAP, { sections: { rules: { '*': { enabled: false }, subjective: { detectors: ['dates'] } } } });
    expect(spans.map((span) => [span.category, span.text, span.meta?.section])).toEqual([['date', '2024-02-03', 'subjective']]);
  });

  it('applies a section-local allow list', () => {
    const spans = detectPhi(SOAP, { sections: { rules: { objective: { allow: ['Emily Smith'] } } } });
    const emily = spans.filter((span) => span.text === 'Emily Smith');
    expect(emily.map((span) => span.meta?.section)).toEqual(['assessment']);
  });

  it('treats a headerless note as one other section', () => {
    const spans = detectPhi(HEADERLESS, { sections: { rules: { other: { skip: ['names'] } } } });
    expect(spans.map((span) => [span.category, span.meta?.section])).toEqual([['date', 'other']]);
  });

  it('accepts custom section boundaries', () => {
    const detect = (text: string): NoteSection[] => [
      { name: 'other', header: null, start: 0, end: 10 },
      { name: 'signature', header: null, start: 10, end: text.length },
    ];
    const spans = detectPhi(HEADERLESS, { sections: { detect, rules: { signature: { enabled: false } } } });
    expect(spans.map((span) => [span.text, span.meta?.section])).toEqual([['John Smith', 'other']]);
  });

  it('flows through redact and pseudonymize', () => {
    const rules = { signature: { skip: ['name'] } };
    expect(redact(SOAP, { sections: { rules } }).text).toContain('Signed by: Robert Chen, MD on [DATE]');
    const { text, map } = pseudonymize(SOAP, { sections: { rules }, dateShiftDays: 3 });
    expect(text).toContain('Robert Chen');
    expect(map['robert chen']).toBeUndefined();
    expect(map['john smith']).toBeDefined();
  });

  it('scopes NER spans by section too', async () => {
    const fakeNer = async (text: string): Promise<PhiSpan[]> =>
      [...text.matchAll(/Robert Chen|John Smith/g)].map((match) => ({
        category: 'name',
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        confidence: 0.99,
        source: 'ner',
      }));
    const spans = await detectPhiAsync(SOAP, fakeNer, { sections: { rules: { signature: { skip: ['ner', 'names'] } } } });
    expect(names(spans)).not.toContain('Robert Chen');
    expect(sectionOf(spans, 'John Smith')).toBe('other');
  });
});
