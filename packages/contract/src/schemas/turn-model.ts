import { z } from "@hono/zod-openapi";
import { CANONICAL_INSTANT } from "../turns.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * The model that wrote an agent turn (SPEC.md §11, rider signed 2026-08-07), and
 * **where it is recorded** — which is the whole of CONTRACT-043's decision.
 *
 * ---
 *
 * ## The decision: the thread document's frontmatter, keyed by turn timestamp
 *
 * A thread file records its turns' models in a `turnModels` mapping in its own
 * frontmatter — the same region, and the same shape of idea, as the `anchors`
 * map §6 already keeps there:
 *
 * ```yaml
 * ---
 * id: th_x9y8
 * type: thread
 * agent: engaged
 * turnModels:
 *   2026-07-19T10:07:12Z: claude-opus-4-1
 * ---
 * ## user · 2026-07-19T10:05:00Z
 * @agent is 6.1% still the right assumption?
 *
 * ## agent · 2026-07-19T10:07:12Z
 * Checked current averages; 6.4% is more representative.
 * ```
 *
 * The key is the turn's timestamp, which §6 already makes the turn's identity
 * and guarantees unique within a thread — the same key `DELETE
 * /api/threads/{id}/turns/{ts}` addresses a turn by. On the wire none of this is
 * visible: a turn carries its own {@link Turn.model}, so the API reads with the
 * locality the file gives up. See "the cost" below.
 *
 * ## Why not the turn heading (option A)
 *
 * `## <author> · <ISO instant>` is how a thread file is cut into turns, and
 * extending it to `## <author> · <ts> · <model>` was the natural move. Three
 * shipped defects say what that costs:
 *
 *   - **AGENT-016** — a closing fence on a content line swallowed every later
 *     turn.
 *   - **SERVER-075** — an unterminated fence in a reply swallowed every later
 *     turn; four turns on disk parsed as one, through three separate write
 *     doors.
 *   - **SERVER-076** — a body containing a literal `## user · <ts>` line split a
 *     person's message in two.
 *
 * Every character added to a delimiter grammar is a new way for content to
 * imitate a delimiter, and two things make option A worse than that general
 * warning:
 *
 *   1. **It changes the meaning of bytes already on disk.** Widening the grammar
 *      is retroactive: a line that is prose in a thread file today becomes a turn
 *      delimiter the moment the server is upgraded, in every file, with no write
 *      to notice it on. SERVER-076's guard (`assertNoTurnHeadings`) refuses a
 *      fabricated heading *at write time* and so cannot help — the fabrication
 *      happened before the grammar existed. There is no version of A that is not
 *      a silent re-reading of the whole corpus.
 *   2. **A model name is a display string**, not an enum (§7 keeps model names in
 *      the skill). A grammar whose last field matches arbitrary text is a
 *      delimiter with an unbounded tail — precisely the shape content imitates
 *      most easily. Restricting the charset to make it safe would make it an
 *      enum by the back door.
 *
 * And the fatal one for what the rider is *for*: if the attribution rides the
 * delimiter, then whatever can write a delimiter can write an attribution. "Which
 * model wrote this?" would be answered by a claim rather than by a record.
 *
 * ## Why not a line inside the turn (option B)
 *
 * It leaves the delimiter alone, and inherits nothing for it: SERVER-076's guard
 * refuses *turn headings* in a body, not this marker, so every write door would
 * need a second guard — and that guard would have to refuse prose a person
 * legitimately wrote. Worse, the marker would have to be stripped on read and
 * re-added on write, so `Turn.body` would stop being what its author typed, and a
 * person who quotes one would have their own words eaten. §6's trace line (`↳ `)
 * is not a counter-example: it is content the agent *writes to be read*, and §6
 * resolves its ambiguity by declaring that a `↳ ` line elsewhere is ordinary
 * markdown. That resolution is unavailable here. An attribution a reader cannot
 * distinguish from something a person typed is not an attribution.
 *
 * ## Why not `extra` (option E — the cheap answer inside this option's family)
 *
 * `extra` is frontmatter too, so it looks like it would do. It is **client
 * writable**: §5's extra object is an RFC 7386 merge patch on `PUT /api/docs/{id}`
 * (`./extra.ts`), so an attribution stored there could be rewritten by an
 * ordinary API call by anyone holding the token. `turnModels` is therefore a
 * **reserved** core key ({@link RESERVED_FRONTMATTER_KEYS}), which is exactly what
 * makes `extra` unable to name it.
 *
 * ## Why not the projection (option D)
 *
 * SQLite is derived and rebuilt from files (§9.1). A derived store cannot hold
 * the only copy of a fact, and this fact's whole purpose is to outlive runtime
 * state — it exists because the job log is reaped with its event (§7).
 *
 * ## The cost, stated plainly
 *
 * **Locality.** The record lives away from the turn it describes. Reading raw
 * markdown in `git log`, you match a timestamp against a map at the top of the
 * file instead of reading the attribution in place. §6 made this exact trade for
 * anchors — "stored in the frontmatter of the commented document… the body stays
 * clean, no inline markers" — and the API pays it back: {@link Turn.model} puts
 * the model on the turn for every reader that goes through the server.
 *
 * **A turn that moves loses it.** There is no move: §6 makes a timestamp a turn's
 * identity, turns are appended and deleted, and a revision keeps the same stamp.
 * What is left is a real obligation on the sole writer, below.
 *
 * ## The obligation this shape creates
 *
 * **Deleting a turn must delete its entry.** `nextTurnTs` derives the next stamp
 * from the stamps *currently in the body*, so deleting the last turn frees its
 * timestamp for reuse — and a stale entry would then attribute a model to a
 * different turn, which is worse than recording nothing. An entry whose key is
 * not a turn of this thread is therefore dropped, the same housekeeping §6
 * already requires of an anchor entry when its thread is deleted. A reader only
 * ever reports a model for a turn it actually parsed, so a stale entry is invisible
 * rather than wrong — but it is dropped anyway, because "invisible" stops being
 * true the moment a stamp is reused.
 *
 * ## What this is not
 *
 * **Not a weight, and never to be merged with one.** CONTRACT-039 deliberately
 * kept a request's chosen *weight* off the turn: a weight is an instruction about
 * how work *should* be done, stated before it is, and §7 requires a stated weight
 * to be "honoured, not weighed again" — a claim that is only checkable while the
 * two are separate. The model recorded here is a fact about what *did* happen.
 * Storing them in one field would make the instruction and the outcome
 * indistinguishable and §7's guarantee unverifiable. They stay apart.
 */

/**
 * The longest model name recorded. Generous for a display string — the longest
 * real one is a third of it — and a bound rather than a guess: this value is
 * written into a document's frontmatter, where an unbounded string is a way to
 * make a thread file arbitrarily large through an endpoint that looks like it
 * only appends prose.
 */
export const TURN_MODEL_MAX_LENGTH = 200;

const TURN_MODEL_DESCRIPTION =
  "Display name of the model that wrote this turn (SPEC.md §11) — a **display string, not an " +
  "enum**: §7 keeps model names in the orchestrator skill, so this contract never enumerates " +
  "them and a workspace that changes its tiers changes nothing here. " +
  "**One model, never a list.** Where a request ran in stages at different weights (§7), this " +
  "names the model of the **deciding** stage — the one that drew the conclusion or wrote the " +
  "words. It does not accumulate the stages, and a reader must not treat it as the whole account " +
  "of what ran: the per-stage record is the job's log, for as long as that log lasts. " +
  "**It is not a weight.** A weight is an instruction stated before the work (§7, honoured and " +
  "not weighed again); this is a fact about what happened. The two are deliberately separate " +
  "fields of separate things (CONTRACT-039) and merging them would make §7's guarantee " +
  `unverifiable. At most ${TURN_MODEL_MAX_LENGTH} characters, non-blank, and on one line: it is ` +
  "persisted as a plain YAML scalar in the thread document's frontmatter.";

/**
 * A model name as written. Non-blank and single-line for the same mechanical
 * reason `./form.ts` demands it of a question: the value becomes a plain YAML
 * scalar in a document's frontmatter, and a newline in one is either a quoting
 * failure or a way to write a second frontmatter key from inside a value.
 */
export const TurnModelSchema = z
  .string()
  .min(1)
  .max(TURN_MODEL_MAX_LENGTH)
  .refine((value) => value.trim() !== "", { message: "must not be blank" })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "must be a single line: it is written as a plain YAML scalar in frontmatter",
  });

/**
 * Response side. **Nullable, not optional** — the convention `threadRowShape`
 * documents in `./query.ts`, and §11 is unusually explicit about why it matters
 * here: "a turn a person wrote names no model, and a turn written before this was
 * recorded shows **nothing** rather than a guess".
 *
 * `null` is that nothing, and it is always present. Optionality would make an
 * absent key ambiguous between "there is no model to name" and "this server
 * never filled it in", and — the reason that is not merely tidy — it would let
 * every existing construction site of a `Turn` keep compiling while silently
 * never carrying a model. Required-and-nullable makes the type system name the
 * places that have to answer.
 */
export const turnModelResponseField = TurnModelSchema.nullable().describe(
  `${TURN_MODEL_DESCRIPTION} **\`null\` when no model is named** — a turn a person wrote, or a ` +
    "turn appended before the server recorded this. Null is the honest answer and never a " +
    "default: an unknown that says so is worth more than a plausible attribution nobody can " +
    'check. Clients render nothing for it, never a placeholder such as "unknown".',
);

/**
 * Request side, on every route that appends a turn. Optional, because most turns
 * have no model to declare: a person's does not, and neither does a client that
 * does not know what ran.
 *
 * **This is a report, not an instruction** — it is the one thing in a turn body
 * request that describes the past rather than asking for something. It travels
 * with the turn because the caller who ran the model is the only party that knows
 * which one it was; the server records it verbatim and interprets nothing.
 */
export const turnModelRequestField = TurnModelSchema.optional().describe(
  `${TURN_MODEL_DESCRIPTION} Omit it when no model wrote the turn. Supplying it on a turn ` +
    "authored by anyone but `agent` (`x-corpus-author`) is a `400`: §11 says a person's turn " +
    "names no model, and a server that accepted one would be publishing an attribution nobody " +
    "made. The server records the value verbatim and interprets nothing about it.",
);

/**
 * The frontmatter key a thread document records its turns' models under.
 * Reserved ({@link RESERVED_FRONTMATTER_KEYS}), so `extra` can never name it and
 * a client-supplied merge patch can never reach it.
 */
export const TURN_MODELS_FRONTMATTER_KEY = "turnModels";

/**
 * The persisted map: turn timestamp → model name.
 *
 * The **canonical** post-parse shape, in the contract for the same reason
 * `TextQuoteSelectorSchema` is — the server's file-level schema
 * (`core/frontmatter.ts`) is the pre-defaults, tolerant-of-hand-editing form, and
 * it is built by importing this rather than by restating it. Two definitions of
 * one shape is the drift Architecture Decision 3 exists to prevent.
 *
 * Deliberately **not** an `.openapi()`-registered component and deliberately
 * absent from every route: this is the file's shape, not the wire's. The wire
 * carries {@link turnModelResponseField} on the turn itself — the same split §6's
 * thread-only frontmatter keys already take, where `parent`/`anchor`/`agent` are
 * reserved file keys that reach clients flattened onto `Thread` rather than as a
 * frontmatter object.
 *
 * Keys are canonical instants, checked against `CANONICAL_INSTANT` — the very
 * constant the turn-heading grammar is built from (`../turns.ts`). That import is
 * the point rather than a convenience: a key is a turn's identity, so a stamp
 * written any other way names no turn at all, and the map's key form and the
 * heading's stamp must not be able to disagree. Sharing the constant is what makes
 * disagreement impossible instead of merely unlikely. A file that hands back a
 * `Date` or an offset instant is the server's normalisation to do on read, before
 * this schema sees it.
 */
export const TurnModelsSchema = z.record(
  IsoDateTimeSchema.refine((value) => CANONICAL_INSTANT.test(value), {
    message: "must be a canonical UTC instant at second precision, as a turn heading writes it",
  }),
  TurnModelSchema,
);

export type TurnModel = z.infer<typeof TurnModelSchema>;
export type TurnModels = z.infer<typeof TurnModelsSchema>;
