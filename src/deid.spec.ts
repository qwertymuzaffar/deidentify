import { detectPhi, detectPhiAsync, pseudonymize, redact, redactAsync, applyReplacements, shiftDate, PHI_CATEGORIES } from './index';
import type { PhiSpan } from './index';

const NOTE = `Patient: John Smith   MRN: 4482913
DOB: 03/14/1951   Seen by: Dr. Maria Lopez on 2024-02-05
Phone: (703) 555-0142   Fax: 703-555-0199   Email: jsmith@example.org
Address: 42 Maple Avenue, Apt 3B, Fairfax, VA 22030
SSN: 123-45-6789   Insurance ID: BCBS77812   Device serial: PM-88213
A 92-year-old male presents with chest pain. Discharge planned for March 8, 2024.
Portal: https://portal.example.org/visit/9931   Client IP: 192.168.4.20
Signed by: Robert Chen, MD`;

const byCat = (spans: PhiSpan[], c: string) => spans.filter((s) => s.category === c).map((s) => s.text);

describe('detectPhi - rules', () => {
  const spans = detectPhi(NOTE);

  it('every span is an exact source slice, sorted and non-overlapping', () => {
    for (const s of spans) expect(s.text).toBe(NOTE.slice(s.start, s.end));
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
  });

  it('finds names via labels, honorifics, and credentials', () => {
    expect(byCat(spans, 'name')).toEqual(expect.arrayContaining(['John Smith', 'Maria Lopez', 'Robert Chen']));
    expect(NOTE).toContain('Dr. Maria Lopez'); // honorific itself is not flagged
    expect(byCat(spans, 'name')).not.toContain('Dr. Maria Lopez');
  });

  it('finds every date format and the month-year element', () => {
    expect(byCat(spans, 'date')).toEqual(expect.arrayContaining(['03/14/1951', '2024-02-05', 'March 8, 2024']));
    expect(byCat(detectPhi('Admitted in March 2021 and again in 2022.'), 'date')).toEqual(['March 2021']);
  });

  it('flags ages over 89 only', () => {
    expect(byCat(spans, 'age')).toEqual(['92']);
    expect(byCat(detectPhi('A 45-year-old woman, age 67.'), 'age')).toEqual([]);
    expect(byCat(detectPhi('Age: 101'), 'age')).toEqual(['101']);
  });

  it('distinguishes fax from phone by context', () => {
    expect(byCat(spans, 'phone')).toEqual(['(703) 555-0142']);
    expect(byCat(spans, 'fax')).toEqual(['703-555-0199']);
  });

  it('finds email, ssn, url, ip, zip, address', () => {
    expect(byCat(spans, 'email')).toEqual(['jsmith@example.org']);
    expect(byCat(spans, 'ssn')).toEqual(['123-45-6789']);
    expect(byCat(spans, 'url')).toEqual(['https://portal.example.org/visit/9931']);
    expect(byCat(spans, 'ip')).toEqual(['192.168.4.20']);
    expect(byCat(spans, 'zip')).toEqual(['22030']);
    expect(byCat(spans, 'address')).toEqual(['42 Maple Avenue, Apt 3B']);
  });

  it('finds labeled identifiers: mrn, account, device', () => {
    expect(byCat(spans, 'mrn')).toEqual(['4482913']);
    expect(byCat(spans, 'account')).toEqual(['BCBS77812']);
    expect(byCat(spans, 'device')).toEqual(['PM-88213']);
  });

  it('finds VINs, license numbers, and plates', () => {
    const s = detectPhi('VIN 1HGCM82633A004352 registered; DL: V123-4567-8901; plate # ABC-1234');
    expect(byCat(s, 'vehicle')).toEqual(expect.arrayContaining(['1HGCM82633A004352', 'ABC-1234']));
    expect(byCat(s, 'license')).toEqual(['V123-4567-8901']);
  });

  it('flags every ###-##-#### (ITINs start with 9) and ignores bare years', () => {
    expect(byCat(detectPhi('IDs 000-12-3456 and 912-12-3456'), 'ssn')).toEqual(['000-12-3456', '912-12-3456']);
    expect(detectPhi('The year 2019 was uneventful.')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(detectPhi('')).toEqual([]);
  });
});

describe('options', () => {
  it('restricts categories', () => {
    const spans = detectPhi(NOTE, { categories: ['ssn', 'email'] });
    expect(new Set(spans.map((s) => s.category))).toEqual(new Set(['ssn', 'email']));
  });

  it('honors the allow list (string and RegExp)', () => {
    const text = 'Seen at Mercy General; contact Dr. Mercy General. Provider: Sample Name';
    const spans = detectPhi(text, { allow: ['Mercy General', /^Sample/] });
    expect(spans).toEqual([]);
  });

  it('accepts custom detectors and resolves overlaps by confidence', () => {
    const custom = {
      name: 'custom',
      detect: (text: string): PhiSpan[] =>
        [...text.matchAll(/CASE-777/g)].map((m) => ({
          category: 'id' as const,
          start: m.index,
          end: m.index + 8,
          text: 'CASE-777',
          confidence: 0.99,
          source: 'custom',
        })),
    };
    const spans = detectPhi('Ref CASE-777 for MRN: CASE-777', { detectors: [custom] });
    expect(spans.map((s) => [s.category, s.text])).toEqual([
      ['id', 'CASE-777'],
      ['id', 'CASE-777'],
    ]);
  });

  it('applies minConfidence', () => {
    expect(detectPhi('Admitted in March 2021.', { minConfidence: 0.8 })).toEqual([]);
  });
});

describe('redact', () => {
  it('replaces spans with category placeholders and tracks output offsets', () => {
    const { text, spans } = redact('Patient: Jane Roe, SSN 987-65-4321, seen 2024-01-02.');
    expect(text).toBe('Patient: [NAME], SSN [SSN], seen [DATE].');
    for (const s of spans) expect(text.slice(s.outStart, s.outEnd)).toBe(s.replacement);
  });

  it('supports custom placeholders', () => {
    const { text } = redact('Email me at a@b.co', { placeholder: (c) => `<${c}>` });
    expect(text).toBe('Email me at <email>');
  });

  it('leaves clean text untouched', () => {
    const src = 'Vitals stable. Continue lisinopril 10 mg daily.';
    expect(redact(src).text).toBe(src);
  });
});

describe('pseudonymize', () => {
  it('maps the same value to the same surrogate and returns the key', () => {
    const src = 'Patient: Ann Lee. Contact: Ann Lee. Spouse: Bob Lee.';
    const { text, map } = pseudonymize(src, { dateShiftDays: 10 });
    const annSurrogate = map['ann lee'];
    expect(annSurrogate).toBeDefined();
    expect(text.split(annSurrogate)).toHaveLength(3);
    expect(map['bob lee']).not.toBe(annSurrogate);
  });

  it('shifts all dates by one offset, preserving format and intervals', () => {
    const { text, dateShiftDays } = pseudonymize('Admit 2024-01-10, discharge 01/15/2024, follow-up March 1, 2024.', {
      dateShiftDays: 7,
    });
    expect(dateShiftDays).toBe(7);
    expect(text).toBe('Admit 2024-01-17, discharge 01/22/2024, follow-up March 8, 2024.');
  });

  it('picks a random shift when none is given', () => {
    const r = pseudonymize('Seen 2024-05-05.');
    expect(r.dateShiftDays).toBeGreaterThanOrEqual(1);
    expect(r.dateShiftDays).toBeLessThanOrEqual(365);
    expect(r.text).not.toContain('2024-05-05');
  });

  it('generates fictional surrogates for contact identifiers', () => {
    const { text } = pseudonymize('Call (703) 555-0142 or mail x@y.org; SSN 321-54-9876; a 95 y/o.');
    expect(text).toMatch(/555-01\d\d/);
    expect(text).toContain('person1@example.com');
    expect(text).toContain('000-00-0001');
    expect(text).toContain('90+');
  });
});

describe('shiftDate', () => {
  it('handles formats and month styles', () => {
    expect(shiftDate('2024-12-31', 1)).toBe('2025-01-01');
    expect(shiftDate('1/5/24', 30)).toBe('2/4/24');
    expect(shiftDate('Mar 5, 2024', 3)).toBe('Mar 8, 2024');
    expect(shiftDate('5 March 2024', 3)).toBe('8 March 2024');
    expect(shiftDate('March 2024', 40)).toBe('April 2024');
    expect(shiftDate('not a date', 5)).toBeNull();
  });
});

describe('async NER merge', () => {
  const fakeNer = async (text: string): Promise<PhiSpan[]> => {
    const i = text.indexOf('Priya Natarajan');
    return i === -1 ? [] : [{ category: 'name', start: i, end: i + 15, text: 'Priya Natarajan', confidence: 0.97, source: 'ner' }];
  };

  it('adds NER spans the rules missed', async () => {
    const src = 'Priya Natarajan was seen on 2024-02-02.';
    const spans = await detectPhiAsync(src, fakeNer);
    expect(spans.map((s) => s.category)).toEqual(['name', 'date']);
    const { text } = await redactAsync(src, fakeNer);
    expect(text).toBe('[NAME] was seen on [DATE].');
  });
});

describe('transformers helper internals', () => {
  it('groups B-/I- word pieces into entities and filters by score', async () => {
    const { groupEntities } = await import('./transformers');
    const groups = groupEntities(
      [
        { entity: 'B-PER', score: 0.99, word: 'Priya' },
        { entity: 'I-PER', score: 0.97, word: 'Nat' },
        { entity: 'I-PER', score: 0.95, word: '##arajan' },
        { entity: 'O', score: 0.99, word: 'was' },
        { entity: 'B-LOC', score: 0.4, word: 'Fairfax' },
        { entity: 'B-ORG', score: 0.9, word: 'Hospital' },
      ],
      0.6,
    );
    expect(groups).toEqual([
      { label: 'PER', pieces: ['Priya', 'Nat', '##arajan'], score: 0.95 },
      { label: 'ORG', pieces: ['Hospital'], score: 0.9 },
    ]);
    // a ## subword tagged B- still continues the entity
    expect(groupEntities([{ entity: 'B-PER', score: 1, word: 'P' }, { entity: 'B-PER', score: 1, word: '##riya' }], 0.5)).toEqual([
      { label: 'PER', pieces: ['P', '##riya'], score: 1 },
    ]);
  });

  it('locates grouped entities in the source and maps labels to categories', async () => {
    const { locate } = await import('./transformers');
    const text = 'Spoke with Priya Natarajan today.';
    const span = locate(text, { label: 'PER', pieces: ['Priya', 'Nat', '##arajan'], score: 0.95 }, { PER: 'name' });
    expect(span).toEqual({ category: 'name', start: 11, end: 26, text: 'Priya Natarajan', confidence: 0.95, source: 'ner' });
    expect(locate(text, { label: 'ORG', pieces: ['Acme'], score: 0.9 }, { PER: 'name' })).toBeNull();
    expect(locate(text, { label: 'PER', pieces: ['Nobody'], score: 0.9 }, { PER: 'name' })).toBeNull();
  });
});

describe('misc', () => {
  it('merges touching spans of the same category', async () => {
    const { resolveSpans } = await import('./merge');
    const merged = resolveSpans([
      { category: 'name', start: 0, end: 1, text: 'P', confidence: 1, source: 'ner' },
      { category: 'name', start: 1, end: 5, text: 'riya', confidence: 0.9, source: 'ner' },
      { category: 'date', start: 5, end: 9, text: '2024', confidence: 1, source: 'x' },
    ]);
    expect(merged.map((s) => [s.category, s.text, s.confidence])).toEqual([
      ['name', 'Priya', 0.9],
      ['date', '2024', 1],
    ]);
  });

  it('applyReplacements handles adjacent spans', () => {
    const src = 'ab';
    const spans: PhiSpan[] = [
      { category: 'id', start: 0, end: 1, text: 'a', confidence: 1, source: 't' },
      { category: 'id', start: 1, end: 2, text: 'b', confidence: 1, source: 't' },
    ];
    expect(applyReplacements(src, spans, () => 'X').text).toBe('XX');
  });

  it('exports the category list', () => {
    expect(PHI_CATEGORIES).toContain('mrn');
    expect(PHI_CATEGORIES).toHaveLength(17);
  });
});
