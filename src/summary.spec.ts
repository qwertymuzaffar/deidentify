import { detectPhi, renderSummary, summarize, summarizeAsync, PHI_CATEGORIES } from './index';
import type { PhiSpan } from './index';

const NOTE = `Patient: Ann Lee. SSN: 123-45-6789
Contact: Ann Lee. Spouse: Bob Lee.
Seen 2024-02-05 in Fairfax, VA 22030. A 92-year-old.`;

describe('summarize', () => {
  const summary = summarize(NOTE);

  it('counts spans and distinct values per category, listing every category', () => {
    expect(Object.keys(summary.counts)).toEqual([...PHI_CATEGORIES]);
    expect(summary.counts.name).toBe(3);
    expect(summary.distinct.name).toBe(2);
    expect(summary.counts.ssn).toBe(1);
    expect(summary.counts.phone).toBe(0);
    expect(summary.total).toBe(7);
    expect(summary.present).toEqual(['name', 'zip', 'date', 'age', 'ssn']);
  });

  it('separates direct identifiers from quasi-identifier groups', () => {
    expect(summary.direct).toEqual(['name', 'ssn']);
    expect(summary.quasi).toEqual(['date', 'geography', 'age']);
    expect(summary.cooccurring).toBe(true);
  });

  it('accepts spans as well as text, and forwards options when given text', () => {
    expect(summarize(detectPhi(NOTE))).toEqual(summary);
    const dates = summarize(NOTE, { categories: ['date'] });
    expect(dates.present).toEqual(['date']);
    expect(dates.direct).toEqual([]);
  });

  it('bands risk: nothing or one quasi group is low', () => {
    const empty = summarize('Vitals stable. Continue lisinopril 10 mg daily.');
    expect(empty.risk).toBe('low');
    expect(empty.reasons).toEqual(['no identifiers found']);
    const dateOnly = summarize('Seen 2024-02-05.');
    expect(dateOnly.risk).toBe('low');
    expect(dateOnly.reasons).toEqual(['only dates present among the quasi-identifiers']);
  });

  it('bands risk: two quasi groups co-occurring is medium', () => {
    const dateAndPlace = summarize('Seen 2024-02-05 in Fairfax, VA 22030.');
    expect(dateAndPlace.risk).toBe('medium');
    expect(dateAndPlace.direct).toEqual([]);
    expect(dateAndPlace.reasons).toEqual(['quasi-identifiers co-occur: dates, geography']);
  });

  it('bands risk: all three quasi groups, or any direct identifier, is high', () => {
    const allQuasi = summarize('Seen 2024-02-05 in Fairfax, VA 22030; a 92-year-old.');
    expect(allQuasi.direct).toEqual([]);
    expect(allQuasi.risk).toBe('high');
    expect(allQuasi.reasons).toEqual(['dates, geography and ages co-occur']);
    const ssnOnly = summarize('SSN 123-45-6789.');
    expect(ssnOnly.risk).toBe('high');
    expect(ssnOnly.reasons).toEqual(['direct identifiers present: ssn (1)']);
    expect(summary.reasons).toEqual(['direct identifiers present: name (3), ssn (1)', 'dates, geography and ages co-occur']);
  });

  it('summarizes rules plus NER spans', async () => {
    const fakeNer = async (text: string): Promise<PhiSpan[]> => {
      const start = text.indexOf('Priya Natarajan');
      return start === -1 ? [] : [{ category: 'name', start, end: start + 15, text: 'Priya Natarajan', confidence: 0.97, source: 'ner' }];
    };
    const withNer = await summarizeAsync('Priya Natarajan was seen on 2024-02-02.', fakeNer);
    expect(withNer.counts.name).toBe(1);
    expect(withNer.risk).toBe('high');
  });
});

describe('renderSummary', () => {
  it('renders the risk heading, the category table, the quasi-identifier line and the reasons', () => {
    const markdown = renderSummary(summarize(NOTE));
    expect(markdown).toContain('## PHI summary: high risk');
    expect(markdown).toContain('7 identifier spans across 5 categories.');
    expect(markdown).toContain('| name | 3 | 2 |');
    expect(markdown).toContain('| ssn | 1 | 1 |');
    expect(markdown).toContain('Quasi-identifiers: dates, geography, ages (co-occurring).');
    expect(markdown).toContain('- direct identifiers present: name (3), ssn (1)');
    expect(markdown).toContain('not a compliance determination');
  });

  it('renders a clean document and a custom title', () => {
    const markdown = renderSummary(summarize('Vitals stable.'), { title: 'Note 42' });
    expect(markdown).toContain('## Note 42: low risk');
    expect(markdown).toContain('No identifiers found.');
    expect(markdown).not.toContain('| Category |');
  });
});
