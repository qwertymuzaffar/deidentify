/**
 * Synthetic-corpus benchmark: generates clinical-style notes with known
 * PHI insertions, runs the rule-based detectors, and reports precision /
 * recall per category. No real patient data is involved.
 */
import { detectPhi, detectPhiAsync } from '../dist/index.js';

// `node scripts/bench.mjs --ner` adds the on-device NER layer (downloads the model once)
const useNer = process.argv.includes('--ner');
const ner = useNer ? (await import('../dist/transformers.js')).createTransformersNer() : null;
const detect = async (text) => (ner ? detectPhiAsync(text, ner) : detectPhi(text));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(2026);
const pick = (arr) => arr[Math.floor(random() * arr.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(random() * 10)).join('');

const FIRST = ['James', 'Maria', 'Wei', 'Aisha', 'Carlos', 'Elena', 'Noah', 'Fatima', 'Liam', 'Priya', 'Omar', 'Hannah'];
const LAST = ['Smith', 'Garcia', 'Chen', 'Patel', 'Okafor', 'Kowalski', 'Nguyen', 'Rossi', 'Haddad', 'Johnson', 'Silva', 'Novak'];
const STREETS = ['Maple Avenue', 'Oak Street', 'Cedar Lane', 'Elm Road', 'Pine Court', 'Lake Drive'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const gen = {
  name: () => `${pick(FIRST)} ${pick(LAST)}`,
  date: () => {
    const y = 1940 + Math.floor(random() * 85);
    const m = 1 + Math.floor(random() * 12);
    const d = 1 + Math.floor(random() * 28);
    return pick([
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      `${m}/${d}/${y}`,
      `${MONTHS[m - 1]} ${d}, ${y}`,
    ]);
  },
  age: () => String(90 + Math.floor(random() * 15)),
  phone: () => pick([`(${digits(3)}) ${digits(3)}-${digits(4)}`, `${digits(3)}-${digits(3)}-${digits(4)}`]),
  email: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}@example.${pick(['com', 'org', 'net'])}`,
  ssn: () => `${100 + Math.floor(random() * 700)}-${10 + Math.floor(random() * 89)}-${1000 + Math.floor(random() * 8999)}`,
  mrn: () => digits(7),
  address: () => `${1 + Math.floor(random() * 9999)} ${pick(STREETS)}`,
  zip: () => digits(5),
  url: () => `https://portal.example.org/visit/${digits(5)}`,
  ip: () => `10.${Math.floor(random() * 255)}.${Math.floor(random() * 255)}.${1 + Math.floor(random() * 250)}`,
  account: () => `${pick(['BCBS', 'AET', 'UHC'])}${digits(6)}`,
};

// Each template: text with {category} slots; the slot value is the ground-truth span.
const TEMPLATES = [
  'Patient: {name}   MRN: {mrn}   DOB: {date}',
  'Seen by: Dr. {name} on {date} for follow-up. Phone: {phone}',
  'A {age}-year-old patient presents with fatigue. Email on file: {email}.',
  'Address: {address}, Springfield, IL {zip}. SSN: {ssn}',
  'Insurance ID: {account}. Portal: {url} (client IP {ip}).',
  'Discharge summary dictated by: {name}, MD on {date}. Next visit {date}.',
  'Spouse: {name}, reachable at {phone}. Age: {age}.',
  // unlabeled mentions - rules cannot see these; this is what the NER layer is for
  'Spoke with {name} regarding the care plan and goals.',
  '{name} tolerated the procedure well and was discharged home.',
  'Labs reviewed. Continue metformin 500 mg twice daily. Vitals stable, afebrile.',
  'Assessment: hypertension, well controlled. Plan: recheck in 3 months.',
  'History: appendectomy at age 12; no known drug allergies; nonsmoker.',
];

function generateNote() {
  const lines = [];
  const truth = [];
  let text = '';
  for (let i = 0; i < 6; i++) {
    const template = pick(TEMPLATES);
    let line = '';
    let last = 0;
    for (const m of template.matchAll(/\{(\w+)\}/g)) {
      line += template.slice(last, m.index);
      const value = gen[m[1]]();
      truth.push({ category: m[1], start: text.length + line.length, end: text.length + line.length + value.length });
      line += value;
      last = m.index + m[0].length;
    }
    line += template.slice(last);
    lines.push(line);
    text += line + '\n';
  }
  return { text, truth };
}

const NOTES = 500;
const stats = {};
const bump = (cat, key) => {
  stats[cat] ??= { tp: 0, fp: 0, fn: 0 };
  stats[cat][key]++;
};

let anyTp = 0, anyFp = 0, anyFn = 0;
const t0 = performance.now();
for (let i = 0; i < NOTES; i++) {
  const { text, truth } = generateNote();
  const found = await detect(text);
  // category-level: a truth span counts as found if a detected span of that category overlaps it
  for (const t of truth) {
    const hit = found.some((f) => f.category === t.category && f.start < t.end && f.end > t.start);
    bump(t.category, hit ? 'tp' : 'fn');
    const anyHit = found.some((f) => f.start < t.end && f.end > t.start);
    anyHit ? anyTp++ : anyFn++;
  }
  for (const f of found) {
    const matches = truth.some((t) => t.category === f.category && f.start < t.end && f.end > t.start);
    if (!matches) bump(f.category, 'fp');
    const anyMatch = truth.some((t) => f.start < t.end && f.end > t.start);
    if (!anyMatch) anyFp++;
  }
}

const pr = (s) => ({
  precision: s.tp / Math.max(1, s.tp + s.fp),
  recall: s.tp / Math.max(1, s.tp + s.fn),
});

const elapsed = performance.now() - t0;
console.log(`deid bench - ${NOTES} synthetic notes, ${useNer ? 'rules + on-device NER' : 'rule-based detectors only'} (${(elapsed / NOTES).toFixed(1)} ms/note)\n`);
console.log('category   precision  recall   n');
for (const cat of Object.keys(stats).sort()) {
  const s = stats[cat];
  const { precision, recall } = pr(s);
  console.log(`${cat.padEnd(10)} ${precision.toFixed(3).padStart(9)}  ${recall.toFixed(3).padStart(6)}  ${String(s.tp + s.fn).padStart(4)}`);
}
const overall = pr({ tp: anyTp, fp: anyFp, fn: anyFn });
console.log(`\nany-category (is this span PHI?): precision ${overall.precision.toFixed(3)}, recall ${overall.recall.toFixed(3)}`);
