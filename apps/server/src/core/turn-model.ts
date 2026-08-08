/**
 * The `turnModels` map: which model wrote which turn (SPEC.md §6, §11 —
 * CONTRACT-043's decision, rider signed 2026-08-08).
 *
 * A thread document records its turns' models in its **own frontmatter**, keyed
 * by turn timestamp, beside the `anchors` map §6 already keeps there. The turn's
 * own text carries none of it and the turn heading never grows a field for it,
 * so nothing a turn's body can say is able to claim an attribution. The contract
 * (`schemas/turn-model.ts`) carries the reasoning and owns the canonical shape;
 * this module is the file-level half — reading a hand-written spelling of it,
 * joining it onto parsed turns, and computing what the next write should record.
 *
 * Three rules, and each is load-bearing:
 *
 * - **Record, never invent.** Nothing here manufactures a model. A turn with no
 *   entry reads as `null`, which is §11's "nothing rather than a guess": an
 *   unknown that says so is worth more than a plausible attribution nobody can
 *   check. There is no default, no "current model", and no fallback to the
 *   weight a request was dispatched at (CONTRACT-039: a weight is what was asked
 *   for, a model is what ran; conflating them makes §7's "honoured, not weighed
 *   again" unverifiable).
 *
 * - **An entry whose key is not a turn of this thread is dropped.** This is the
 *   sharp one. `nextTurnTs` derives the next stamp from the stamps currently in
 *   the body, so deleting the last turn frees its timestamp for **reuse** — and
 *   a surviving entry would then attribute a model to a *different* turn. A
 *   reader only ever reports a model for a turn it actually parsed, so a stale
 *   entry is invisible rather than wrong; "invisible" stops being true the
 *   moment a stamp is reused, which is why {@link turnModelsPatch} prunes on
 *   every write rather than only when a turn is deleted.
 *
 * - **A stamp spelled another way names no turn.** The key is the turn's
 *   identity (§6), and identity is compared byte for byte against the heading's
 *   stamp. So a file offering `2026-07-19T12:07:12+02:00`, or a YAML 1.1 writer
 *   handing back a `Date`, is normalised to the canonical instant here — *before*
 *   anything compares it to a turn — rather than being left to miss every turn
 *   it was meant to name.
 *
 * **Only the server writes this map** (§6). `turnModels` is a reserved
 * frontmatter key, so §5's `extra` merge patch can never name it and no
 * client-supplied patch can reach it. That is what makes the read side entitled
 * to rebuild the map from what it could understand: unlike `anchors` — which
 * reconciliation shares with the hand edits `anchor-entries.ts` deliberately
 * preserves — an entry here that no rule can read is not somebody's data being
 * discarded, it is noise in a store with exactly one writer. `doc check` reports
 * it first (`frontmatter.ts` validates the shape); the next write repairs it.
 *
 * Pure functions over plain values: no I/O, no parser, no filesystem.
 */

import {
  CANONICAL_INSTANT,
  TURN_MODELS_FRONTMATTER_KEY,
  TurnModelSchema,
  TurnModelsSchema,
  type Turn,
  type TurnModels,
} from "@corpus/contract";
import { z } from "zod";
import { formatInstant, normalizeInstant } from "./time.js";

export { TURN_MODELS_FRONTMATTER_KEY };

/**
 * What `Date.prototype.toString` produces, and nothing else.
 *
 * A `Date` really does reach this map — the `yaml` package parses on the 1.2
 * core schema, where an unquoted ISO instant is a string, but an explicitly
 * tagged (`!!timestamp`) or 1.1-flavoured document yields a real `Date` — and a
 * JavaScript object has no `Date` keys, so `toJS` stringifies it on the way out.
 * Measured, that leaves `Sun Jul 19 2026 03:08:12 GMT-0700 (Pacific Daylight
 * Time)` where a turn stamp was meant: a key that names no turn and never will.
 *
 * ECMA-262 requires `Date.parse` to read back what `toString` wrote, so
 * recognising exactly that shape is a round trip rather than a guess. The
 * recogniser is narrow **on purpose**: a bare `Date.parse` of any key would
 * accept `"2026"`, `"March"` and a great deal else, turning a typo into a
 * plausible turn stamp — the misattribution class this map exists to avoid.
 */
const DATE_TO_STRING =
  /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}(?: \(.+\))?$/;

/**
 * A map key as the canonical instant a turn heading writes, or `null` when it
 * spells no instant at all.
 */
const canonicalTurnKey = (key: unknown): string | null => {
  // Never a `Date` object: a JavaScript object has only string keys, which is
  // the whole reason the stringified form above has to be recognised.
  if (typeof key !== "string") return null;
  if (DATE_TO_STRING.test(key)) {
    const parsed = Date.parse(key);
    return Number.isNaN(parsed) ? null : formatInstant(parsed);
  }
  const normalized = normalizeInstant(key);
  return normalized !== null && CANONICAL_INSTANT.test(normalized) ? normalized : null;
};

/** A mapping's entries with every key it can canonicalise rewritten in place. */
const withCanonicalKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // An un-canonicalisable key is left exactly as written, so the schema's
    // failure names the key the file actually carries.
    normalized[canonicalTurnKey(key) ?? key] = entry;
  }
  return normalized;
};

/**
 * The **file-level** shape, in `frontmatter.ts`'s sense: the contract's
 * canonical {@link TurnModelsSchema} behind the one normalisation a file is
 * allowed to need. It is composed rather than restated — two definitions of one
 * shape is the drift Architecture Decision 3 exists to prevent.
 */
export const FileTurnModelsSchema = z.preprocess(withCanonicalKeys, TurnModelsSchema);

/**
 * The map a thread's frontmatter carries, canonical and readable — every key an
 * instant a heading could carry, every value a model name.
 *
 * Lenient in the way every *read* in this server is lenient (`threads/read.ts`
 * states the rule): a hand-edited entry nobody can interpret is skipped rather
 * than thrown over, because the conversation is still a conversation and §14 is
 * what reports the drift. Two spellings of one instant collapse to one entry,
 * last one winning — they named the same turn, and a turn has one model.
 */
export const readTurnModels = (value: unknown): TurnModels => {
  const models: Record<string, string> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return models;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const ts = canonicalTurnKey(key);
    if (ts === null) continue;
    const model = TurnModelSchema.safeParse(entry);
    if (model.success) models[ts] = model.data;
  }
  return models;
};

/** The `turnModels` map of a parsed frontmatter mapping. */
export const turnModelsOf = (data: Readonly<Record<string, unknown>>): TurnModels =>
  readTurnModels(data[TURN_MODELS_FRONTMATTER_KEY]);

/**
 * Turns with their models joined on — the locality the file gives up, paid back
 * at every reader that goes through the server ({@link Turn.model}).
 *
 * A turn with no entry keeps the `null` the parser gave it. That is the whole of
 * the "record, never invent" rule at the read end: there is no branch here that
 * can produce a model the map did not hold.
 */
export const withTurnModels = (turns: readonly Turn[], models: TurnModels): Turn[] =>
  turns.map((turn) => ({ ...turn, model: models[turn.ts] ?? null }));

/** What a write wants recorded about one turn; `undefined` records nothing. */
export interface TurnModelRecord {
  readonly ts: string;
  readonly model: string | undefined;
}

/**
 * The `turnModels` patch a write should carry, as a fragment for
 * {@link import("./document.js").setFrontmatterFields}.
 *
 * Two rules, and between them they leave no entry unaccounted for:
 *
 * - `keep` is the timestamps of the turns that will still be in the body. Every
 *   entry naming anything else is dropped — the turn it described is gone, and a
 *   stamp is free for reuse the moment its turn is.
 * - `record` is the turn being **written**, applied after the prune, and it is
 *   the *only* thing that decides that turn's entry: stated, and it is written;
 *   unstated, and any entry at that stamp is removed. So a caller never has to
 *   reason about whether the stamp it is writing was somebody else's a moment
 *   ago — what the writer said about this turn always wins over what the file
 *   happened to hold, in both directions. Callers pass the pre-write timestamps
 *   for `keep`, which is simply "every turn other than this one".
 *
 * The result is deliberately either a whole map or `undefined`: an empty map is
 * removal of the key, not `turnModels: {}` in the file, and
 * `setFrontmatterFields` leaves a key alone when the patch does not change it —
 * so a thread nobody ever recorded a model for never grows the key at all, and a
 * reply to one is byte-for-byte the write it was before this shipped.
 *
 * Entries come out sorted by timestamp, which for an ISO instant is chronological
 * order. The server is the only writer, so its own output is already sorted and
 * the sort costs nothing; what it buys is that the file does not depend on the
 * order a `Object.entries` walk happened to produce.
 */
export const turnModelsPatch = (
  data: Readonly<Record<string, unknown>>,
  keep: Iterable<string>,
  record?: TurnModelRecord,
): { readonly [TURN_MODELS_FRONTMATTER_KEY]: TurnModels | undefined } => {
  const kept = new Set(keep);
  const next: Record<string, string> = {};
  for (const [ts, model] of Object.entries(turnModelsOf(data))) {
    if (kept.has(ts)) next[ts] = model;
  }
  if (record !== undefined) {
    if (record.model === undefined) delete next[record.ts];
    else next[record.ts] = record.model;
  }
  const sorted = Object.keys(next).sort();
  return {
    [TURN_MODELS_FRONTMATTER_KEY]:
      sorted.length === 0
        ? undefined
        : Object.fromEntries(sorted.map((ts) => [ts, next[ts] as string])),
  };
};
