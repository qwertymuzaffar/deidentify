# deidentify

[![npm version](https://img.shields.io/npm/v/deidentify)](https://www.npmjs.com/package/deidentify)
[![CI](https://github.com/qwertymuzaffar/deidentify/actions/workflows/ci.yml/badge.svg)](https://github.com/qwertymuzaffar/deidentify/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

PHI de-identification for TypeScript: **detect, redact, and pseudonymize** the HIPAA Safe Harbor identifiers in clinical text - with exact source offsets, zero dependencies, and an optional **on-device NER layer** so protected text never has to leave your process to be cleaned.

The gateway problem of every healthcare-AI feature is the same: you cannot send a note to an LLM API, an embedding model, or a search index until the identifiers are gone. `deidentify` is that step, for Node, browsers, and edge runtimes.

## Install

```bash
npm i deidentify
```

## Quick start

```ts
import { redact } from 'deidentify';

const { text } = redact(`Patient: John Smith  MRN: 4482913  DOB: 03/14/1951
Seen by Dr. Maria Lopez on 2024-02-05. Phone (703) 555-0142.`);

// Patient: [NAME]  MRN: [MRN]  DOB: [DATE]
// Seen by Dr. [NAME] on [DATE]. Phone [PHONE].
```

Or keep the note readable and re-identifiable with consistent surrogates:

```ts
import { pseudonymize } from 'deidentify';

const { text, map, dateShiftDays } = pseudonymize(note);
// "Patient: Alex Morgan  MRN: MRN-0001  DOB: 05/02/1951 ..."
// the same name maps to the same surrogate everywhere; all dates shift by
// one offset so intervals between events are preserved.
// `map` is the re-identification key - store it like PHI.
```

Or just find the spans:

```ts
import { detectPhi } from 'deidentify';

for (const span of detectPhi(note)) {
  console.log(span.category, span.text, span.start, span.end, span.confidence);
}
// every span satisfies note.slice(span.start, span.end) === span.text
```

## What it detects

The 18 Safe Harbor identifier classes (45 CFR 164.514(b)(2)), mapped to categories:

| Category | Rule coverage |
|---|---|
| `name` | Labeled (`Patient:`, `Attending:`, ...), honorifics (`Dr. Jane Smith` - honorific kept), credentials (`John Smith, MD`) |
| `date` | ISO, US numeric, textual (`March 5, 2024`), and month-year elements; bare years are allowed per Safe Harbor |
| `age` | Ages over 89 (`92-year-old`, `age 94`) |
| `phone` / `fax` | US formats; `fax` by context |
| `email`, `url`, `ip` | Standard patterns |
| `ssn` | Every `###-##-####` - recall-first (ITINs start with 9) |
| `address`, `zip` | Street addresses with units; ZIPs by state or label context |
| `mrn`, `account`, `license`, `device`, `vehicle` | Labeled identifiers (`MRN:`, `Member ID`, `DEA`, `Serial`, `VIN`, plates) and 17-character VINs |

Unlabeled names in running prose ("Spoke with Maria Garcia about...") are the known limit of rules - that is what the NER layer is for.

## On-device NER

```bash
npm i @huggingface/transformers   # optional peer dependency
```

```ts
import { redactAsync } from 'deidentify';
import { createTransformersNer } from 'deidentify/transformers';

const ner = createTransformersNer(); // Xenova/bert-base-NER, ~110 MB once, then cached
const { text } = await redactAsync(note, ner);
```

The model runs locally through Transformers.js (WASM/WebGPU in the browser, ONNX Runtime in Node). Nothing is uploaded anywhere. `PER` maps to `name` and `LOC` to `address`; override with `labelMap`. Any async `(text) => PhiSpan[]` works as the `ner` argument, so a hosted model or a different library plugs in the same way.

## Benchmark

`npm run bench` - 500 synthetic clinical-style notes with known identifier insertions (no real patient data), including unlabeled name mentions in prose:

| Mode | name recall | overall PHI recall | overall precision | speed |
|---|---|---|---|---|
| rules only | 0.665 | 0.909 | 1.000 | 0.1 ms/note |
| rules + on-device NER | **0.995** | **0.999** | 0.902 | 77 ms/note |

Two honest notes. First, structured identifiers (dates, phones, SSNs, MRNs, ...) score 1.000 in both modes *because the corpus uses formats the rules were written for* - treat those rows as a regression suite, not a real-world guarantee. Second, the NER "precision" cost is mostly the model flagging cities and facility names (`Springfield, IL`, `Fairfax Hospital`) that the synthetic ground truth does not label - geographic subdivisions are Safe Harbor identifiers, so those are often correct catches. Run the bench on your own de-identified samples for numbers that matter to you.

## API

| Export | Description |
|---|---|
| `detectPhi(text, options?)` | Spans from the built-in rules (sync) |
| `redact(text, options?)` | Placeholder replacement, default `[CATEGORY]` |
| `pseudonymize(text, options?)` | Consistent surrogates + date shifting; returns the key map |
| `detectPhiAsync / redactAsync / pseudonymizeAsync(text, ner, options?)` | Same, merging spans from an async recognizer |
| `applyReplacements(text, spans, fn)` | Rewrite text from spans with output offsets |
| `shiftDate(text, days)` | Format-preserving date shift helper |

### Options

| Option | Description |
|---|---|
| `categories` | Restrict detection to a subset |
| `allow` | Strings or RegExps that must never be flagged (hospital names, drug names) |
| `detectors` | Custom `{ name, detect(text) }` detectors merged with the rules |
| `minConfidence` | Drop spans below a confidence |
| `placeholder(category, span)` | Custom redaction text (`redact`) |
| `dateShiftDays` | Fixed date offset (`pseudonymize`; default random 1-365, returned) |

Overlapping candidates resolve by confidence, then length; touching spans of one category merge. Every span's offsets index the original text exactly.

## What this is not

`deidentify` is engineering infrastructure for administrative and documentation workflows - preparing text for search, summarization, or LLM features. It is **not** a compliance certification, not clinical decision support, and no automated de-identifier reaches 100% recall on real-world text. Use it as one layer of a HIPAA program with human review where the risk warrants it, exactly as you would with Presidio or philter.

## Roadmap

- Clinical-note structure awareness (SOAP sections) for section-scoped rules
- Expert-determination helpers: per-document identifier counts and risk summaries
- Browser demo with the NER layer running on WebGPU

## License

MIT (c) Muzaffar Qosimov
