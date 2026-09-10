# deidentify

## 0.2.0

### Minor Changes

- 4c5d2dd: Add section-aware detection for clinical notes: `detectSections` finds SOAP-style headers (Subjective / Objective / Assessment / Plan, HPI, PMH, Medications, Allergies, Social History, Family History, signature) with exact offsets, the `sections` option scopes detectors, skips and allow lists per section, and every span then carries `meta.section`.

## 0.1.1

### Patch Changes

- f7f4bce: Releases are now automated with Changesets and published from GitHub Actions with provenance.
