import type { PhiCategory, PhiSpan } from './types';

const SURROGATE_NAMES = [
  'Alex Morgan', 'Jordan Lee', 'Taylor Brooks', 'Casey Rivera', 'Riley Chen', 'Morgan Patel',
  'Avery Kim', 'Quinn Foster', 'Reese Nguyen', 'Drew Carter', 'Sam Walker', 'Jamie Cruz',
  'Robin Hayes', 'Skyler Reed', 'Emerson Ford', 'Parker Lane', 'Dakota Bell', 'Rowan Price',
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_INDEX: Record<string, number> = {};
MONTH_NAMES.forEach((m, i) => {
  MONTH_INDEX[m.toLowerCase()] = i;
  MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i;
});
MONTH_INDEX['sept'] = 8;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

interface DateFormat {
  pattern: RegExp;
  /** Capture group of each part; a format without a day shifts from the 15th. */
  groups: { month: number; day?: number; year: number };
  /** Writes the shifted date in the style of the original match. */
  render(shifted: Date, match: RegExpMatchArray): string;
}

/** A family of formats and how its month capture becomes a 0-based month index. */
interface DateFamily {
  formats: readonly DateFormat[];
  monthIndex(monthText: string): number | undefined;
}

const ORDINAL = '(?:st|nd|rd|th)?';

const NUMERIC_FORMATS: readonly DateFormat[] = [
  {
    // 2024-03-05
    pattern: /^(\d{4})-(\d{2})-(\d{2})$/,
    groups: { year: 1, month: 2, day: 3 },
    render: (shifted) => `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
  },
  {
    // 3/5/2024, 03-05-24: the separator, the zero padding and the year width are kept
    pattern: /^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})$/,
    groups: { month: 1, day: 3, year: 4 },
    render: (shifted, match) => {
      const separator = match[2];
      const keepPad = match[1].length === 2;
      const month = keepPad ? pad(shifted.getUTCMonth() + 1) : String(shifted.getUTCMonth() + 1);
      const day = keepPad ? pad(shifted.getUTCDate()) : String(shifted.getUTCDate());
      const year = match[4].length === 2 ? pad(shifted.getUTCFullYear() % 100) : String(shifted.getUTCFullYear());
      return `${month}${separator}${day}${separator}${year}`;
    },
  },
];

// March 5, 2024 / Mar. 5th 2024
const monthDayYear = (shifted: Date, match: RegExpMatchArray): string =>
  `${monthLike(match[1], shifted.getUTCMonth())} ${shifted.getUTCDate()}, ${shifted.getUTCFullYear()}`;
// 5 March 2024 / 5th Mar. 2024
const dayMonthYear = (shifted: Date, match: RegExpMatchArray): string =>
  `${shifted.getUTCDate()} ${monthLike(match[2], shifted.getUTCMonth())} ${shifted.getUTCFullYear()}`;
// March 2024: a month is a Safe Harbor date element on its own
const monthYear = (shifted: Date, match: RegExpMatchArray): string =>
  `${monthLike(match[1], shifted.getUTCMonth())} ${shifted.getUTCFullYear()}`;

const NAMED_MONTH_FORMATS: readonly DateFormat[] = [
  {
    pattern: new RegExp(`^([A-Za-z]+)\\.?\\s+(\\d{1,2})${ORDINAL},?\\s+(\\d{4})$`),
    groups: { month: 1, day: 2, year: 3 },
    render: monthDayYear,
  },
  {
    pattern: new RegExp(`^(\\d{1,2})${ORDINAL}\\s+([A-Za-z]+)\\.?,?\\s+(\\d{4})$`),
    groups: { day: 1, month: 2, year: 3 },
    render: dayMonthYear,
  },
  {
    pattern: /^([A-Za-z]+)\.?\s+(\d{4})$/,
    groups: { month: 1, year: 2 },
    render: monthYear,
  },
];

/** Families are tried in order, formats within a family in order; the first match decides. */
const DATE_FAMILIES: readonly DateFamily[] = [
  { formats: NUMERIC_FORMATS, monthIndex: (monthText) => +monthText - 1 },
  { formats: NAMED_MONTH_FORMATS, monthIndex: (monthText) => MONTH_INDEX[monthText.toLowerCase()] },
];

/** Shifts a recognized date string by `days`, preserving its written format. */
export function shiftDate(text: string, days: number): string | null {
  for (const family of DATE_FAMILIES) {
    for (const format of family.formats) {
      const match = text.match(format.pattern);
      if (!match) continue;
      const month = family.monthIndex(match[format.groups.month]);
      if (month === undefined) return null;
      const yearText = match[format.groups.year];
      const year = yearText.length === 2 ? 2000 + +yearText : +yearText;
      const day = format.groups.day === undefined ? 15 : +match[format.groups.day];
      return format.render(shifted(year, month, day, days), match);
    }
  }
  return null;
}

function shifted(year: number, month: number, day: number, days: number): Date {
  return new Date(Date.UTC(year, month, day + days));
}

/** Renders a month in the same style as the original (abbreviated or full). */
function monthLike(original: string, month: number): string {
  const full = MONTH_NAMES[month];
  return original.length <= 4 && original.toLowerCase() !== 'may' && original.length < full.length
    ? full.slice(0, 3)
    : full;
}

/** Consistent surrogate generation across one document (or one session). */
export class SurrogateContext {
  private readonly map = new Map<string, string>();
  private readonly counters = new Map<PhiCategory, number>();

  constructor(readonly dateShiftDays: number) {}

  private next(category: PhiCategory): number {
    const n = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, n);
    return n;
  }

  surrogate(span: PhiSpan): string {
    const key = `${span.category}:${span.text.trim().toLowerCase()}`;
    const existing = this.map.get(key);
    if (existing !== undefined) return existing;
    const value = this.generate(span);
    this.map.set(key, value);
    return value;
  }

  entries(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of this.map) out[key.slice(key.indexOf(':') + 1)] = value;
    return out;
  }

  private generate(span: PhiSpan): string {
    const n = this.next(span.category);
    switch (span.category) {
      case 'name': {
        const base = SURROGATE_NAMES[(n - 1) % SURROGATE_NAMES.length];
        return n > SURROGATE_NAMES.length ? `${base} ${Math.ceil(n / SURROGATE_NAMES.length)}` : base;
      }
      case 'date':
        return shiftDate(span.text, this.dateShiftDays) ?? '[DATE]';
      case 'age':
        return '90+';
      case 'phone':
        return `555-01${pad(n % 100)}`;
      case 'fax':
        return `555-02${pad(n % 100)}`;
      case 'email':
        return `person${n}@example.com`;
      case 'ssn':
        return `000-00-${pad(n % 10000, 4)}`;
      case 'address':
        return `${n} Example St`;
      case 'zip':
        return '00000';
      case 'url':
        return `https://example.com/redacted-${n}`;
      case 'ip':
        return `10.0.0.${n % 255}`;
      case 'vehicle':
        return `VEHICLE-${n}`;
      default:
        return `${span.category.toUpperCase()}-${pad(n, 4)}`;
    }
  }
}
