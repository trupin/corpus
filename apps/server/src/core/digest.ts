import { ThreadDigestSchema, type ThreadDigest } from "@corpus/contract";
import { instantToEpochMs, normalizeInstant } from "./time.js";
import { parseThreadBody } from "./turns.js";

/**
 * A thread's digest as its frontmatter spells it, and back again (SPEC.md §6's
 * rider signed 2026-09-05).
 *
 * The sibling of `core/resident.ts`, written the same way and for the same
 * reason: one reader and one writer for a frontmatter block, so "what the file
 * may say" and "what the wire carries" are the same shape by construction. The
 * contract's own `ThreadDigestSchema` is what validates it, so nothing here
 * restates what a digest may be.
 */

/**
 * The `stale` key as the *stored* shape spells it: **absent means false**.
 *
 * `resident.ts`'s `withStoredKey` case, with the polarity the rider gives it. A
 * digest the server wrote always carries the key — see {@link digestToStored},
 * which writes `stale: false` rather than omitting it, because *"a stale digest
 * is shown as stale wherever it is shown"* reads far better off a file that says
 * the flag out loud than off one where a reader has to know that nothing means
 * no. But a digest a person types into frontmatter by hand will not carry it,
 * and refusing that digest would be refusing the only field the rider lets a
 * person write at all.
 *
 * The default is applied here rather than in the schema so the **wire** shape
 * keeps `stale` required: a response field that is sometimes missing is a field
 * every consumer has to guard.
 */
const withStoredStale = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.hasOwn(value, "stale") ? value : { ...value, stale: false };

/**
 * The digest stored on a frontmatter mapping, or `null` — which is *"the
 * ordinary state, not a fault"*.
 *
 * **The watermark is normalized on the way in**, exactly as `threads/read.ts`
 * normalizes `created` and `updated`: it is a turn's `ts`, a hand-written one
 * may be `2026-09-05 10:00:00 +0000`, and the wire publishes a canonical
 * instant. A value that is not an instant at all is left as it stands and is
 * refused by the schema, which is the honest outcome — a digest whose watermark
 * names no moment claims no coverage, and there is no repair the server is
 * allowed to make.
 *
 * **An ill-shaped block reads as no digest**, whole, the way an ill-shaped
 * `resident:` block does: half a digest would be prose with no statement of what
 * it covers, or a coverage claim with nothing to read. Nothing is written back
 * — §5 keeps the file the truth, and the rider forbids the server to repair a
 * digest — so a hand-written block that does not parse stays exactly as its
 * author left it, and the thread simply reads as having none until they fix it
 * or a resident writes one.
 */
export const storedDigest = (value: unknown): ThreadDigest | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = withStoredStale(value as Record<string, unknown>);
  const watermark = record["watermark"];
  const normalized = typeof watermark === "string" ? normalizeInstant(watermark) : null;
  const parsed = ThreadDigestSchema.safeParse(
    normalized === null ? record : { ...record, watermark: normalized },
  );
  return parsed.success
    ? { body: parsed.data.body, watermark: parsed.data.watermark, stale: parsed.data.stale }
    : null;
};

/**
 * The frontmatter value a digest write produces — {@link storedDigest}'s
 * inverse, and the one place the stored shape is built.
 *
 * All three keys, always. `resident.ts` spreads its optional keys away because
 * `null` and absent would be two spellings of *"none chosen"*; here `false` is
 * not a second spelling of nothing, it is the rider's answer to a question the
 * file should answer where a person can read it.
 */
export const digestToStored = (digest: ThreadDigest): Record<string, unknown> => ({
  body: digest.body,
  watermark: digest.watermark,
  stale: digest.stale,
});

/**
 * Does this digest claim to cover the turn at `ts`? — the rider's *"at or
 * before the watermark"*, and the whole of what decides staleness.
 *
 * Compared as instants rather than as strings, because a hand-written watermark
 * and a stamped one need not share a spelling and a lexical comparison of two
 * differently-spelled instants is a coin toss. A `ts` that is not an instant
 * covers nothing: it names no turn this digest could have read.
 */
export const digestCovers = (digest: ThreadDigest, ts: string): boolean => {
  const turn = instantToEpochMs(ts);
  const watermark = instantToEpochMs(digest.watermark);
  return turn !== null && watermark !== null && turn <= watermark;
};

/** The digest with `stale` recorded, or the same object when it already is. */
export const markedStale = (digest: ThreadDigest): ThreadDigest =>
  digest.stale ? digest : { ...digest, stale: true };

/**
 * The frontmatter patch that records a digest as stale, or nothing at all —
 * the rider's *"the server records the staleness and changes nothing else"*.
 *
 * Returned as a **patch** rather than written here, so every staleness trigger
 * sets the flag in the same write as the change that caused it: one commit, one
 * `updated`, and no moment at which the file says a digest covers a turn the
 * same change removed. Callers spread it into their own `setFrontmatterFields`
 * call, which is also what makes an unaffected digest cost exactly nothing —
 * an empty patch changes no key and therefore writes no byte.
 *
 * `body` is never in the patch. Repairing a digest is the resident's act and
 * never the server's, so a stale digest keeps its prose exactly as written —
 * wrong about the conversation, and honest about being wrong.
 *
 * Empty when there is nothing to record: no digest, one that already says so, or
 * a change to a turn the digest never claimed. The last is the rider's own
 * distinction — turns after the watermark are *"simply not yet covered"*.
 */
export const stalenessPatch = (
  digest: ThreadDigest | null,
  affected: boolean,
): Record<string, unknown> =>
  digest === null || digest.stale || !affected
    ? {}
    : { digest: digestToStored(markedStale(digest)) };

/**
 * Did an edit from `oldBody` to `newBody` delete or revise a turn this digest
 * covers? — the rider's two staleness triggers, decided from the two bodies
 * rather than from whichever verb produced them.
 *
 * Written as a body comparison because the trigger has to hold on paths that
 * never name a `ts`: an out-of-band edit in somebody's editor, and a whole-body
 * save through `PUT /api/docs/{id}`. The one path that *does* name a `ts` —
 * `DELETE /api/threads/{id}/turns/{ts}` — asks {@link digestCovers} directly
 * instead, because it knows exactly which turn went and re-parsing two bodies to
 * rediscover that would be the same answer arrived at more slowly.
 *
 * **Only turns at or before the watermark, and only text the digest read.** A
 * turn appended after it is *"not yet covered"*, which the rider is explicit is
 * not staleness. A change to a turn's body **or its author** counts, and a
 * change to the thread's preamble does not: the digest is an account of the
 * conversation.
 *
 * Cheap where it matters: every caller reaches here only for a document whose
 * frontmatter already parsed as carrying a live digest, which is a handful of
 * threads in a workspace and no ordinary document at all.
 */
export const coveredTurnsChanged = (
  digest: ThreadDigest,
  oldBody: string,
  newBody: string,
): boolean => {
  const before = parseThreadBody(oldBody).turns.filter((turn) => digestCovers(digest, turn.ts));
  if (before.length === 0) return false;
  const after = new Map(parseThreadBody(newBody).turns.map((turn) => [turn.ts, turn]));
  return before.some((turn) => {
    const now = after.get(turn.ts);
    return now === undefined || now.body !== turn.body || now.author !== turn.author;
  });
};

/**
 * {@link stalenessPatch} for the whole-body writes, which reach a thread as an
 * ordinary document and decide the question from the two bodies.
 *
 * The guard order is the point: a document with no readable `digest:` key — every
 * document in a workspace but a handful of threads — costs one property read and
 * returns before any body is parsed.
 */
export const bodyEditStalenessPatch = (
  data: Readonly<Record<string, unknown>>,
  oldBody: string,
  newBody: string,
): Record<string, unknown> => {
  const digest = storedDigest(data["digest"]);
  if (digest === null || digest.stale) return {};
  return stalenessPatch(digest, coveredTurnsChanged(digest, oldBody, newBody));
};
