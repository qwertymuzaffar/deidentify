---
'deidentify': minor
---

Add section-aware detection for clinical notes: `detectSections` finds SOAP-style headers (Subjective / Objective / Assessment / Plan, HPI, PMH, Medications, Allergies, Social History, Family History, signature) with exact offsets, the `sections` option scopes detectors, skips and allow lists per section, and every span then carries `meta.section`.
