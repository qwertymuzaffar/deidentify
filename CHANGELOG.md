# deidentify

## 0.2.0

### Minor Changes

- 3853f81: Add section-aware detection for clinical notes: `detectSections` finds SOAP-style headers (Subjective / Objective / Assessment / Plan, HPI, PMH, Medications, Allergies, Social History, Family History, signature) with exact offsets, the `sections` option scopes detectors, skips and allow lists per section, and every span then carries `meta.section`.
- 0851756: Add expert-determination helpers: `summarize` returns per-document counts and distinct values per category, the direct identifiers, the quasi-identifier groups present (dates, geography, ages) and whether they co-occur, and a coarse `low` / `medium` / `high` risk band with the rules behind it; `renderSummary` renders it as Markdown; `summarizeAsync` includes NER spans.

## 0.1.1

### Patch Changes

- f7f4bce: Releases are now automated with Changesets and published from GitHub Actions with provenance.
