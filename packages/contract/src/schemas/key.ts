import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * The **key** a document read hands out and a body-replacing write presents back
 * (SPEC.md §7 "A key, not a lock", rider SHARED-041 signed 2026-08-11), and the
 * advisory **someone is editing this** signal that travels beside it.
 *
 * ---
 *
 * ## Why a key at all, when there was a lock
 *
 * §7 states the reason plainly and it is worth repeating at the definition,
 * because everything below follows from it: **a lock is forgettable, because
 * forgetting it still lets the write through.** The per-document edit lock asked
 * every writer to volunteer, and in practice the agent did not — the user's live
 * workspace held zero lock files against a git log full of agent edits. Nothing
 * in the write path required one.
 *
 * A key cannot be forgotten, because a write without a valid one does not
 * happen. The enforcement moved out of the writer's discipline and into the
 * write path, which is why the one thing this module must never do is make the
 * key optional where it applies: **an optional field a server may ignore
 * reproduces the lock exactly**, one layer down and harder to see. See
 * {@link KEYED_UPDATE_FIELDS}.
 *
 * ## What a key is
 *
 * A key names **the version you read**. Reading a document gives you its key
 * ({@link documentKeyResponseField}, carried on `Doc` and therefore on every
 * route that returns a whole document body). Writing the body back means
 * presenting that key, and the write is refused if the document has changed
 * since — a stale key is exactly the statement *"I am about to overwrite
 * something I never read"*. Every write that lands answers with the document it
 * wrote, carrying a fresh key for the next one.
 *
 * A refusal is a `409` carrying the document **as it now stands**, whose own
 * `key` is the fresh one (`StaleKeyError` in `./error.ts`). Never a bare refusal,
 * and never a lost edit: nothing was written, and the content the writer tried to
 * save is still theirs to resend.
 *
 * ## The derivation — chosen here, deliberately not in SPEC
 *
 * SPEC guarantees only the behaviour ("a key names the version you read and
 * changes when the document does"), because pinning an algorithm into a
 * behavioural spec would be wrong. SHARED-041's adjudication fixes one property
 * above the algorithm: the key is **derived from the document's current content,
 * not issued**. That single choice is what removes the registry, the expiry, the
 * revocation and the reaping in one move, and it is what makes an out-of-band
 * edit — you open the file in another editor and save — invalidate every
 * outstanding key for free, with nothing having to remember anything.
 *
 * **The derivation this contract fixes: the lowercase hexadecimal SHA-256 digest
 * of the document file's stored bytes, exactly as they sit on disk** — the
 * frontmatter block and the body together, un-normalised and un-re-serialised.
 * That is the obligation `SERVER-098` implements and the shape
 * {@link DocumentKeySchema} validates. Measured against the five constraints, in
 * the order CONTRACT-049 gives them:
 *
 *   1. **Changes iff the stored bytes change.** It is a function of exactly
 *      those bytes and of nothing else — not of the request, the clock, the
 *      reader, or the path.
 *   2. **Stable across a restart**, because it is computed from the file each
 *      time and no state is kept anywhere. A server that has just booted derives
 *      the same key for an untouched document as the one that died.
 *   3. **A move does not invalidate it.** A move rewrites the path, not the
 *      content (§9.2: the id never changes), and the path is not an input. A
 *      writer who read before a move can still write after it, which is correct:
 *      nothing it read has changed.
 *   4. **Cheap on the hottest path.** A document read already loads the file's
 *      bytes to answer with them, so the key costs one pass of a hash over bytes
 *      that are in hand — no extra read, no extra query, no extra process.
 *   5. **Opaque.** A bare digest offers a caller nothing to branch on: no
 *      substructure, no ordering, no embedded time, nothing that means anything
 *      apart from "this exact document". See the opacity rules below.
 *
 * **What was rejected, and why** — each fails a constraint above rather than
 * being merely less pretty:
 *
 *   - **mtime, size, or the pair.** Fails (1) in both directions: two writes
 *      inside one filesystem timestamp tick are indistinguishable, and restoring
 *      a file rewrites the timestamp without changing a byte. It also describes
 *      the file rather than the document, so it is not stable under the ordinary
 *      operations a workspace performs on its own files.
 *   - **The git blob hash of `HEAD`.** Fails (1) and (4): the working tree
 *      legitimately differs from `HEAD` (a hook rejected the auto-commit, §11),
 *      so the version you read may have no blob at all, and it puts a git
 *      invocation on every document read.
 *   - **A version counter, an ETag registry, or any issued token.** Fails (2)
 *      and, worse, fails the property the rider fixed: a counter is state, so it
 *      must be persisted, migrated, and updated by whatever notices an
 *      out-of-band edit. An external edit would *not* invalidate it, which is
 *      precisely the case that today has no other guard. This is the design the
 *      derivation exists to avoid.
 *   - **The frontmatter `updated` timestamp.** Fails (1) and (5): it has
 *      one-second granularity, a hand edit that does not touch it leaves it
 *      unchanged, and it is a value the client can read, predict and forge — a
 *      key a writer can manufacture is not evidence that it read anything.
 *   - **Hashing only the body.** Fails (1) for the second write §7 names: a
 *      whole-frontmatter rewrite would not move the key, so two writers could
 *      overwrite each other's frontmatter silently while the mechanism reported
 *      everything as fine.
 *   - **A shorter digest, or a version prefix (`k1_…`).** Neither buys
 *      anything here and the prefix costs constraint (5): a prefix is
 *      substructure, and substructure is the first thing a client parses. A key
 *      is valid for at most one write, so a derivation change needs no
 *      generation marker — every key changes anyway.
 *
 * ## Opacity, stated as rules because it is what the mechanism rests on
 *
 * A key is **evidence that you read a version**, and evidence you manufactured
 * is not evidence. So a client:
 *
 *   - **echoes** the key it received, verbatim, and nothing else;
 *   - never **computes** one (a client that hashes the content it is about to
 *     send has written a key for a version it never read — the exact overwrite
 *     this refuses);
 *   - never **parses**, splits, truncates, or orders keys — there is nothing
 *     inside one, and two keys are only ever equal or unequal;
 *   - never **holds** one past the write it was read for. It is not a claim, a
 *     lease or a handle; there is nothing to release, and holding one confers
 *     nothing.
 *
 * The published description says this too, in the words a client author reading
 * only `openapi.json` will see. What it deliberately does **not** say is the
 * algorithm: a caller that knows it is a caller that will eventually compute
 * one.
 *
 * ## Why it rides in the body, and not as `If-Match`
 *
 * HTTP has a shape for this — `ETag` with `If-Match` and a `412` — and it was
 * rejected on three counts:
 *
 *   1. **The signed spec fixes `409`, carrying the document.** §7's *what a
 *      refusal says* is one exchange rather than two, and a `412` carrying the
 *      current representation is not what `412` means to anything that reads it.
 *   2. **Required-where-it-applies is not expressible across the boundary.** The
 *      key is required exactly when the request replaces the body, and a
 *      refinement can only see one schema: with the key in a header and the body
 *      in the body, no single check can tie them together, and the enforcement
 *      degrades into a server comment. In the body, {@link KEYED_UPDATE_FIELDS}
 *      makes it a `400` before any handler runs.
 *   3. **`ETag` implies a cache contract this server does not offer** —
 *      conditional `GET`, `304`, revalidation — and any intermediary is entitled
 *      to act on it.
 *
 * ## Not the editing signal, and never merged with it
 *
 * {@link userEditingField} sits beside the key on every read and answers a
 * different question. The key is correctness: it stops a writer overwriting
 * something it never read. The signal is politeness: it says a person is at the
 * document right now. Ignoring the signal costs politeness; ignoring the key
 * costs nothing, because the write does not happen. One field holding both would
 * lose that distinction — and it is the whole trade §7 makes deliberately.
 */

/** Characters in a key. Fixed, because the derivation is fixed. */
export const DOCUMENT_KEY_LENGTH = 64;

/**
 * Lowercase hexadecimal, fixed width. Validated so that a value that is not a
 * key — an id, a path, an empty string, an issued token — is a `400` at the
 * boundary rather than a mismatch reported as a stale key, which would send a
 * caller re-reading a document that never moved.
 *
 * Lowercase only, with no case-folding: a key is compared for equality and
 * nothing else, and accepting two spellings of one value would make equality
 * depend on which spelling a caller happened to send.
 */
export const DOCUMENT_KEY_PATTERN = /^[0-9a-f]{64}$/;

const DOCUMENT_KEY_DESCRIPTION =
  "The **key** naming the version of this document that was read (SPEC.md §7). Present it on a " +
  "write that replaces the document's body, and the write is refused with `409` if the document " +
  "has changed since — carrying the document as it now stands, and a fresh key for it, so a " +
  "refusal is one exchange rather than two. **A refusal is never a lost edit**: nothing was " +
  "written, and the content you tried to save is yours to resend.\n\n" +
  "**It is opaque. Echo it back exactly as received.** It is *derived from the document's stored " +
  "content*, which is what makes it need no acquiring, releasing, expiry or reaping: an edit made " +
  "outside the app invalidates it for free, and it survives a server restart. How it is derived " +
  "is not contract and is deliberately unpublished. **Never compute, construct, parse, truncate " +
  "or order a key** — a key is evidence that you read a version, and evidence you manufactured is " +
  "not evidence; two keys are only ever equal or unequal. It is not a claim, a lease or a handle: " +
  "there is nothing to release, and holding one confers nothing on you. Every write that lands " +
  "answers with the document it wrote, carrying a fresh key for the next one.";

/**
 * A key on the wire. Not registered as a named component: it is a string, and
 * `openapi.test.ts`'s "every named component is a plain, non-nullable,
 * undefaulted object" invariant is what keeps the component namespace to
 * resources. `./weight.ts` sets the same precedent for the same reason.
 */
export const DocumentKeySchema = openapi(
  z
    .string()
    .regex(DOCUMENT_KEY_PATTERN, "not a document key — read the document and send back its `key`"),
  { example: "3b2ec1f04d75a2c6ef2b8b9a1f0c4d3e5a6b7c8d9e0f1a2b3c4d5e6f708192a3" },
).describe(DOCUMENT_KEY_DESCRIPTION);

/** The read-side field: on `Doc`, and so on every route that returns one. */
export const documentKeyResponseField = DocumentKeySchema.describe(
  `${DOCUMENT_KEY_DESCRIPTION}\n\nAlways present on a document read: a read that carried no key ` +
    "would leave a writer with nothing to present, and the only way to write would be not to have " +
    "read.",
);

/**
 * The write-side field. Optional **in the schema and required by the
 * refinement** ({@link keyedUpdateRefinement}), because the two writes it
 * applies to and the several it does not share one request body.
 */
export const documentKeyRequestField = DocumentKeySchema.optional().describe(
  `${DOCUMENT_KEY_DESCRIPTION}\n\n**Required when this request carries \`body\`**, which is the ` +
    "write that replaces a block without naming what it changes; a `body` with no key is a `400` " +
    "naming this field. **Not required by a write that names its own delta** — a tag, a status, " +
    "`reviewed`, a view or board key, an `unset` — which merges with whatever else happened " +
    "rather than overwriting " +
    "it. Sending one anyway is welcome and is **still checked**: presenting a key always means " +
    "*I am writing against this version*, so a stale one is refused whatever else the request " +
    "changes. A caller that always sends what it read therefore needs no rule about which fields " +
    "are which.",
);

/**
 * The fields of an update that **replace a block** rather than naming a delta,
 * and therefore require a key (SPEC.md §7 "What needs a key").
 *
 * Exactly one today, and the list exists so that the next one is a single edit
 * rather than a rediscovery of the rule. **The rule for classifying a new
 * field**: does its value replace something whose current contents the request
 * does not state? `body` does — it carries no statement of what it meant to
 * change, so it can destroy silently. A scalar (`title`, `status`, `stage`,
 * `due`, `reviewed`, `evergreen`, `order`, `defaultOpen`) does not: naming it is
 * a complete statement of the change, and last-writer-wins on it loses nothing
 * the request did not itself state. `extra` does not: it is an RFC 7386 shallow
 * merge patch, so it is per-key delta by construction. `unset` does not: it
 * names the keys it removes, which is the whole of what it does.
 *
 * **`columns` and `kanban` are whole-value fields and still do not need a key**
 * (CONTRACT-074), which is the one place the rule above wants reading twice. A
 * `columns` write does replace a list whose current contents the request does
 * not state, so it can lose a column another writer just added. It stays keyless
 * because §7 puts the line at *the body*, and because the recovery differs in
 * kind: a lost column is one visible item a person re-adds from the board, where
 * a lost body is prose nobody can reconstruct. A caller that cares presents the
 * key anyway — doing so always means *I am writing against this version*, and is
 * still checked.
 *
 * **`tags` is deliberately not here**, and the reason is now a mechanism rather
 * than a residual (SERVER-102). §7 names *"adding a tag"* among the writes that
 * need no key, and CONTRACT-049's acceptance criteria name *"tag add/remove"*
 * the same way; adding `tags` to this list would refuse the write §7 holds up as
 * the canonical keyless one.
 *
 * **Both add/remove paths merge server-side, and that is what makes the
 * classification honest.** PR #43's review found that only one did: `POST
 * /api/docs/bulk`'s `tag` act computed the next set inside the write lane, while
 * `corpus doc edit --add-tag` read the list, merged in the client and sent the
 * whole set — reproducibly losing one of two concurrent tags. The fix was the
 * missing **wire shape**, not a key: `UpdateDocRequest` now carries
 * `addTags`/`removeTags` beside `tags`, and the server merges them against the
 * file it is holding. So §7's *"they merge with whatever else happened"* is
 * literally true of both paths.
 *
 * `tags` itself remains on the request and remains a whole-set replacement, for
 * the caller that genuinely means *these and no others*. Last-writer-wins on it
 * is §7's *"What a key does not do"* — and it is now a shape a caller chooses
 * rather than the only one on offer, which is the whole difference. It is the
 * **only** whole-set field on `UpdateDocRequest`: every other frontmatter field
 * there is a scalar, a nullable view key, or `extra`'s per-key merge patch, so
 * none of them can lose a neighbour's change the way a set can.
 *
 * A **whole-frontmatter rewrite** — §7's second keyed write — is not a shape
 * this API offers: every frontmatter field on `UpdateDocRequest` is named
 * individually, which is literally a write that names its own delta. If one is
 * ever added, it belongs in this list.
 *
 * `POST /api/docs/{id}/patch` (§7's anchored patch, `./doc-patch.ts`) takes
 * **no** key: it names the text it expects to find, which is the same check by
 * another route, and a patch whose text has moved is refused on its own terms —
 * with a better message than a key mismatch could give, since it says *which*
 * text is gone rather than *that* the document changed. This paragraph predates
 * the route by design, so that whoever added it would not add a key out of
 * symmetry; CONTRACT-046 landed it in 2026-08-12 without one. The rule stays
 * recorded for the next writer with the same instinct: a request that already
 * states the content it is replacing has stated which version it read.
 */
export const KEYED_UPDATE_FIELDS = ["body"] as const;

export type KeyedUpdateField = (typeof KEYED_UPDATE_FIELDS)[number];

/**
 * Whether this update replaces a block, and so must present a key.
 *
 * Reads `undefined` as absent, which is the same reading the rest of the request
 * uses: a request names only what it changes, and an omitted body is exactly a
 * `{}` body — a save that rewrites nothing and needs no key. An **explicitly
 * empty** body (`""`) is a change: it replaces the block with nothing, which is
 * the most destructive spelling of the write this guards, so it needs a key like
 * any other.
 */
export function updateNeedsDocumentKey(patch: {
  readonly [Field in KeyedUpdateField]?: unknown;
}): boolean {
  return KEYED_UPDATE_FIELDS.some((field) => patch[field] !== undefined);
}

/**
 * What a keyless body-replacing write is told, at the field it is missing.
 *
 * Applied in `./doc.ts` as a **refinement** on the update request rather than as
 * a union of two strict objects: zod v4 attaches checks to the schema instead of
 * wrapping it, so `additionalProperties: false` survives registration
 * (CONTRACT-038) and CONTRACT-017's strictness sweep stays non-vacuous — while a
 * `oneOf` would publish one request body as two shapes and answer a typo with
 * "invalid union". It also means the refusal arrives before any handler runs:
 * `@hono/zod-openapi` validates the body, so a keyless body write is a `400`
 * that no server code has to remember to produce.
 */
export const MISSING_DOCUMENT_KEY_MESSAGE =
  "`key` is required when the request carries `body`: replacing a document's body without naming " +
  "the version being replaced is exactly the overwrite SPEC.md §7's key exists to refuse. Read " +
  "the document and send back the `key` it carried.";

/**
 * §7's advisory signal: **someone is editing this**.
 *
 * Carried on every read that carries a key, and the schema is written to make
 * the misreading hard: it is named for the fact it reports rather than for a
 * state it puts the document into, and it says three times over that nothing is
 * refused because of it. Where the lock's failure mode was that forgetting it
 * cost *correctness*, this one's is that ignoring it costs only *politeness* —
 * the trade §7 makes deliberately.
 */
export const userEditingField = z
  .boolean()
  .describe(
    "True when a **person** currently has an edit session open on this document (SPEC.md §4's " +
      "edit session — the same one that ends in an acknowledgment; SPEC.md §7's *someone is " +
      "editing this*).\n\n" +
      "**Information, never a gate.** Nothing is refused because of it, there is nothing to " +
      "acquire and nothing to release, and no document is ever read-only. Correctness is the " +
      "`key`'s job; this is politeness — a writer that ignores it is impolite, not incorrect. " +
      "The agent is expected to leave the document alone and come back, and may defer its claimed " +
      "queue event (`POST /api/queue/{id}/defer`, `blockedOn` this document) to say so; that " +
      "deferral returns to `pending` on its own once the session ends.\n\n" +
      "**Asymmetric on purpose**, because the two writers are: a person's editing is a session " +
      "the server tracks, while the agent's writing is a sequence of one-shot commands with no " +
      "session to report. So this never reports the agent, and the person instead sees the " +
      "agent's writes land live (SPEC.md §9.2). Neither is a lock in the other direction.",
  );
