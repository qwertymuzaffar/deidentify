import type { Detector, PhiCategory, PhiSpan } from './types';

type IndexedMatch = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

/** Every match of `regex` (needs the g and d flags) becomes a span of `group`. */
function scan(
  text: string,
  regex: RegExp,
  category: PhiCategory,
  confidence: number,
  source: string,
  group = 0,
): PhiSpan[] {
  const out: PhiSpan[] = [];
  for (const m of text.matchAll(regex) as IterableIterator<IndexedMatch>) {
    const range = m.indices?.[group];
    if (!range) continue;
    const [start, end] = range;
    if (end > start) out.push({ category, start, end, text: text.slice(start, end), confidence, source });
  }
  return out;
}

const make = (name: string, fn: (text: string) => PhiSpan[]): Detector => ({ name, detect: fn });

const MONTHS =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

export const dates = make('dates', (text) => [
  // 2024-03-05
  ...scan(text, /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/gd, 'date', 0.95, 'rule:date-iso'),
  // 3/5/2024, 03-05-24
  ...scan(text, /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:\d{4}|\d{2})\b/gd, 'date', 0.9, 'rule:date-us'),
  // March 5, 2024 / Mar. 5 2024 / 5 March 2024
  ...scan(text, new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gid'), 'date', 0.95, 'rule:date-text'),
  ...scan(text, new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}\\b`, 'gid'), 'date', 0.95, 'rule:date-text'),
  // March 2024 - month is a date element under Safe Harbor
  ...scan(text, new RegExp(`\\b${MONTHS}\\.?\\s+(?:19|20)\\d{2}\\b`, 'gid'), 'date', 0.7, 'rule:date-month-year'),
]);

export const ages = make('ages', (text) => [
  // 92 years old, 92-year-old, 92 y/o, 92yo
  ...scan(text, /\b(9\d|1[0-2]\d)(?:\s*-?\s*(?:years?|yrs?|y)[\s-]*(?:old|o\b|\/o))/gid, 'age', 0.9, 'rule:age', 1),
  // age 92 / aged 92 / Age: 92
  ...scan(text, /\b(?:aged?)\s*[:\-]?\s*(9\d|1[0-2]\d)\b/gid, 'age', 0.9, 'rule:age', 1),
]);

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/gd;

export const phones = make('phones', (text) =>
  scan(text, PHONE, 'phone', 0.85, 'rule:phone').map((span) => {
    const before = text.slice(Math.max(0, span.start - 12), span.start);
    return /fax/i.test(before) ? { ...span, category: 'fax' as const, source: 'rule:fax' } : span;
  }),
);

export const emails = make('emails', (text) =>
  scan(text, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gd, 'email', 0.98, 'rule:email'),
);

// Recall-first: any ###-##-#### is flagged. ITINs start with 9, so no
// area-number validation that would let real identifiers through.
export const ssns = make('ssns', (text) => scan(text, /\b\d{3}-\d{2}-\d{4}\b/gd, 'ssn', 0.95, 'rule:ssn'));

export const urls = make('urls', (text) =>
  scan(text, /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gid, 'url', 0.95, 'rule:url'),
);

export const ips = make('ips', (text) =>
  scan(text, /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gd, 'ip', 0.9, 'rule:ip'),
);

export const zips = make('zips', (text) => [
  // ", VA 22030" / "VA 22030-1234"
  ...scan(text, /\b[A-Z]{2}\s{1,2}(\d{5}(?:-\d{4})?)\b/gd, 'zip', 0.85, 'rule:zip-state', 1),
  ...scan(text, /\bzip(?:\s*code)?\s*[:#]?\s*(\d{5}(?:-\d{4})?)\b/gid, 'zip', 0.95, 'rule:zip-label', 1),
]);

const STREET =
  '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Trail|Trl)';

export const addresses = make('addresses', (text) =>
  scan(
    text,
    new RegExp(
      `\\b\\d{1,6}\\s+(?:[A-Z][A-Za-z']*\\s+){1,3}${STREET}\\b\\.?(?:,?\\s*(?:Apt|Apartment|Suite|Ste|Unit|#)\\s*[A-Za-z0-9-]+)?`,
      'gd',
    ),
    'address',
    0.85,
    'rule:address',
  ),
);

/** Label followed by a value: `MRN: 123456` flags only the value. */
function labeled(
  name: string,
  category: PhiCategory,
  labels: string,
  // identifiers always contain a digit - keeps plain words like "serial" from matching
  value = '(?=[A-Z0-9-]*\\d)[A-Z0-9][A-Z0-9-]{3,20}',
  confidence = 0.92,
): Detector {
  const re = new RegExp(`\\b(?:${labels})\\s*(?:Number|No\\.?|Num\\.?|#)?\\s*[:#]?\\s*(${value})\\b`, 'gid');
  return make(name, (text) => scan(text, re, category, confidence, `rule:${name}`, 1));
}

export const mrns = labeled('mrn', 'mrn', 'MRN|MR\\s?#|Medical\\s+Record|Record|Patient\\s+ID|Chart|Encounter|Visit\\s+ID');
export const accounts = labeled(
  'account',
  'account',
  'Account|Acct|Policy|Member\\s+ID|Member|Insurance\\s+ID|Subscriber|Beneficiary|Group|Claim|Health\\s+Plan|Plan\\s+ID',
);
export const licenses = labeled('license', 'license', "License|Lic\\.?|Driver'?s?\\s+License|DL|DEA|NPI|Certificate|Cert\\.?");
export const devices = labeled('device', 'device', 'Serial|S\\/N|Device\\s+(?:ID|Serial|Number)|Pacemaker|Implant|Lot');

export const vehicles = make('vehicles', (text) => [
  // 17-char VIN (no I, O, Q), must mix letters and digits
  ...scan(text, /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/gd, 'vehicle', 0.85, 'rule:vin'),
  ...scan(text, /\b(?:license\s+plate|plate|VIN|tag)\s*(?:Number|No\.?|#)?\s*[:#]?\s*([A-Z0-9-]{2,17})\b/gid, 'vehicle', 0.9, 'rule:plate', 1),
]);

// A name token needs a lowercase letter somewhere (McDonald, O'Neil) - this
// keeps ALL-CAPS labels like MRN or SSN from being swallowed into a name.
const TOKEN = "[A-Z](?=[A-Za-z'\\-]*[a-z])[A-Za-z'\\-]+";
const INITIAL = '[A-Z]\\.';
const PART = `(?:${INITIAL}|${TOKEN})`;
const HONORIFIC = '(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\\.?\\s+';
// John Smith / John A. Smith / Smith, John
const PERSON = `${TOKEN}(?:,\\s+${TOKEN})?(?:\\s+${PART}){0,2}`;

export const names = make('names', (text) => [
  // Dr. Jane Smith -> flags "Jane Smith", keeps the honorific
  ...scan(text, new RegExp(`\\b${HONORIFIC}(${PERSON})`, 'gd'), 'name', 0.9, 'rule:honorific', 1),
  // Patient: John Smith / Name - Smith, John / Attending: Dr. A. Jones
  ...scan(
    text,
    new RegExp(
      `\\b(?:Patient(?:\\s+Name)?|Name|Pt|Client|Provider|Physician|Attending|Referring(?:\\s+Physician)?|Guarantor|Spouse|Mother|Father|Son|Daughter|Emergency\\s+Contact|Contact|Nurse|Seen\\s+by|Signed(?:\\s+by)?|Dictated\\s+by|Surgeon|PCP)\\s*[:\\-]\\s*(?:${HONORIFIC})?(${PERSON})`,
      'gd',
    ),
    'name',
    0.92,
    'rule:name-label',
    1,
  ),
  // John Smith, MD / Jane Doe RN
  ...scan(text, new RegExp(`\\b(${TOKEN}(?:\\s+${PART}){1,2}),?\\s+(?:MD|DO|RN|NP|PA|PhD|DDS|LPN|CNA)\\b`, 'gd'), 'name', 0.9, 'rule:name-credential', 1),
]);

export const BUILTIN_DETECTORS: readonly Detector[] = [
  names, addresses, zips, dates, ages, phones, emails, ssns, mrns, accounts, licenses, vehicles, devices, urls, ips,
];
