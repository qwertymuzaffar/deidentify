---
'deidentify': minor
---

Add expert-determination helpers: `summarize` returns per-document counts and distinct values per category, the direct identifiers, the quasi-identifier groups present (dates, geography, ages) and whether they co-occur, and a coarse `low` / `medium` / `high` risk band with the rules behind it; `renderSummary` renders it as Markdown; `summarizeAsync` includes NER spans.
