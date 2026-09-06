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

/** Shifts a recognized date string by `days`, preserving its written format. */
export function shiftDate(text: string, days: number): string | null {
  let m: RegExpMatchArray | null;

  if ((m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const d = shifted(+m[1], +m[2] - 1, +m[3], days);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  if ((m = text.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})$/))) {
    const year = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    const d = shifted(year, +m[1] - 1, +m[3], days);
    const yy = m[4].length === 2 ? pad(d.getUTCFullYear() % 100) : String(d.getUTCFullYear());
    const keepPad = m[1].length === 2;
    const mm = keepPad ? pad(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1);
    const dd = keepPad ? pad(d.getUTCDate()) : String(d.getUTCDate());
    return `${mm}${m[2]}${dd}${m[2]}${yy}`;
  }

  if ((m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    const month = MONTH_INDEX[m[1].toLowerCase()];
    if (month === undefined) return null;
    const d = shifted(+m[3], month, +m[2], days);
    return `${monthLike(m[1], d.getUTCMonth())} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  if ((m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/))) {
    const month = MONTH_INDEX[m[2].toLowerCase()];
    if (month === undefined) return null;
    const d = shifted(+m[3], month, +m[1], days);
    return `${d.getUTCDate()} ${monthLike(m[2], d.getUTCMonth())} ${d.getUTCFullYear()}`;
  }

  if ((m = text.match(/^([A-Za-z]+)\.?\s+(\d{4})$/))) {
    const month = MONTH_INDEX[m[1].toLowerCase()];
    if (month === undefined) return null;
    const d = shifted(+m[2], month, 15, days);
    return `${monthLike(m[1], d.getUTCMonth())} ${d.getUTCFullYear()}`;
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
