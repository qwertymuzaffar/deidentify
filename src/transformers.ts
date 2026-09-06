import type { NerFn, PhiCategory, PhiSpan } from './types';

export interface TransformersNerOptions {
  /** Token-classification checkpoint (default: Xenova/bert-base-NER). */
  model?: string;
  /** Minimum entity score to keep (default 0.6). */
  minScore?: number;
  /** Map NER labels (PER, LOC, ORG, MISC) to PHI categories; unmapped labels are ignored. */
  labelMap?: Partial<Record<string, PhiCategory>>;
  /** Pipeline options forwarded to transformers.js (device, dtype, ...). */
  pipelineOptions?: Record<string, unknown>;
}

interface RawEntity {
  entity: string;
  score: number;
  word: string;
}

const DEFAULT_LABELS: Record<string, PhiCategory> = { PER: 'name', LOC: 'address' };

/**
 * Builds a NerFn backed by a Transformers.js token-classification model
 * that runs on-device (Node or browser) - the text never leaves the
 * process. Requires the optional peer dependency @huggingface/transformers.
 *
 * ```ts
 * import { redactAsync } from 'deid';
 * import { createTransformersNer } from 'deid/transformers';
 * const ner = createTransformersNer();
 * const { text } = await redactAsync(note, ner);
 * ```
 */
export function createTransformersNer(options: TransformersNerOptions = {}): NerFn {
  const model = options.model ?? 'Xenova/bert-base-NER';
  const minScore = options.minScore ?? 0.6;
  const labels: Record<string, PhiCategory> = { ...DEFAULT_LABELS };
  for (const [label, category] of Object.entries(options.labelMap ?? {})) {
    if (category) labels[label] = category;
  }
  let pipe: Promise<(text: string) => Promise<RawEntity[]>> | null = null;

  const load = () => {
    pipe ??= import('@huggingface/transformers').then(async (mod) => {
      const pipeline = mod.pipeline as (task: string, model: string, opts?: object) => Promise<unknown>;
      const p = (await pipeline('token-classification', model, options.pipelineOptions)) as (
        t: string,
        o?: object,
      ) => Promise<RawEntity[]>;
      return (text: string) => p(text, { ignore_labels: [] });
    });
    return pipe;
  };

  return async (text: string): Promise<PhiSpan[]> => {
    const run = await load();
    const entities = await run(text);
    return groupEntities(entities, minScore)
      .map((g) => locate(text, g, labels))
      .filter((s): s is PhiSpan => s !== null);
  };
}

export interface Group {
  label: string;
  pieces: string[];
  score: number;
}

/** Merges B-/I- word pieces into entity groups. Exported for testing. */
export function groupEntities(entities: RawEntity[], minScore: number): Group[] {
  const groups: Group[] = [];
  for (const e of entities) {
    const [prefix, label] = e.entity.includes('-') ? e.entity.split('-', 2) : ['O', e.entity];
    if (label === 'O' || prefix === 'O') continue;
    const last = groups[groups.length - 1];
    // a ## subword always continues the previous piece, whatever tag it carries
    const continues = e.word.startsWith('##') || prefix === 'I';
    if (continues && last && last.label === label) {
      last.pieces.push(e.word);
      last.score = Math.min(last.score, e.score);
    } else {
      groups.push({ label, pieces: [e.word], score: e.score });
    }
  }
  return groups.filter((g) => g.score >= minScore);
}

/** Finds the group's surface text in the source. Exported for testing. */
export function locate(text: string, group: Group, labels: Record<string, PhiCategory>): PhiSpan | null {
  const category = labels[group.label];
  if (!category) return null;
  const surface = group.pieces
    .map((p, i) => (p.startsWith('##') ? p.slice(2) : i === 0 ? p : ' ' + p))
    .join('');
  const candidates = [surface, surface.replace(/ /g, '')];
  for (const candidate of candidates) {
    const start = text.indexOf(candidate);
    if (start !== -1) {
      return { category, start, end: start + candidate.length, text: candidate, confidence: group.score, source: 'ner' };
    }
  }
  return null;
}
