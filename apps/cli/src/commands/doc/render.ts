import type { Doc } from "@corpus/contract";
import { StaleKeyError } from "../../errors.js";

/**
 * How a document looks in a terminal — and, because SPEC.md §7's refusal carries
 * a document, how a refused write looks too.
 *
 * The two renderings are one function on purpose. §7 says a refusal comes back
 * with *the document as it now stands*, and the most useful shape for that is
 * the shape the agent already knows how to read: **a refusal prints exactly what
 * `corpus doc show` would print**, fresh key included. Two renderers would drift,
 * and the drift would land on the one output an agent reads while recovering.
 *
 * Nothing here touches a file or the network — it is a pure function of a `Doc`
 * the server sent.
 */

/** What an absent value renders as — the contract's own prescription for null. */
const NONE = "—";

/** Anchor quotes are one line of context, not the passage; longer ones are cut. */
const MAX_QUOTE = 60;

/**
 * The key line, and it is **the whole key**, never an abbreviation.
 *
 * The contract's opacity rules (`packages/contract/src/schemas/key.ts`) forbid a
 * client truncating a key, and a *display* that truncates is worse than a client
 * that does: the agent copies what it reads, so an elided key is a key it cannot
 * present. It is deliberately printed bare, with no explanation trailing it —
 * the explanation belongs where the mistake happens (`corpus doc edit`'s refusal
 * names the flag and the fix), and a 64-character line with prose after it wraps
 * into something no one can copy.
 */
export function keyLine(doc: Doc): string {
  return `key ${doc.key}`;
}

/**
 * §7's advisory signal, rendered as the invitation it is.
 *
 * Three things it must not do, because each is the lock's failure re-learned:
 * imply the write would be refused (nothing refuses it), imply something must be
 * released (there is nothing to release), or imply the agent is blocked (it is
 * not — it is being asked to be polite). So it names the fact, says plainly that
 * nothing is refused, and offers the one action that fits: park the claimed work
 * and let it come back on its own.
 */
export function editingNotice(doc: Doc): string {
  return (
    `someone is editing this — a person has an edit session open on ${doc.frontmatter.id} right ` +
    `now. Nothing is refused for it and a write would land; the polite move is to leave the ` +
    `document alone and come back, or park the work with \`corpus queue defer <event-id> ` +
    `--blocked-on ${doc.frontmatter.id}\`, which returns to pending on its own when the session ends.`
  );
}

/**
 * A document as `corpus doc show` prints it: the header a person reads first,
 * the **key** a writer has to carry, the editing signal when there is one, the
 * anchored threads with their resolution state, then the body.
 *
 * The key sits third — under the identity line, above everything descriptive —
 * because it is the one line whose absence from the reader's attention costs a
 * round trip, and everything below it is context rather than an instrument.
 */
export function documentLines(doc: Doc): readonly string[] {
  const { frontmatter } = doc;
  const lines: string[] = [
    frontmatter.title,
    `${frontmatter.id} · ${frontmatter.type} · ${frontmatter.status}`,
    keyLine(doc),
  ];

  if (doc.userEditing) lines.push(editingNotice(doc));

  lines.push(
    doc.path,
    `created ${frontmatter.created ?? NONE} · updated ${frontmatter.updated ?? NONE}`,
    `tags ${frontmatter.tags.length === 0 ? NONE : frontmatter.tags.join(", ")}`,
  );

  // Only when the document actually carries one of them: an always-printed
  // "due — · reviewed — · evergreen no" is noise on every note in the corpus.
  if (frontmatter.due !== null || frontmatter.reviewed !== null || frontmatter.evergreen) {
    lines.push(
      `due ${frontmatter.due ?? NONE} · reviewed ${frontmatter.reviewed ?? NONE} · evergreen ${
        frontmatter.evergreen ? "yes" : "no"
      }`,
    );
  }

  if (doc.anchors.length > 0) {
    lines.push("anchors:");
    for (const anchor of doc.anchors) {
      const position =
        anchor.orphaned || anchor.range === null
          ? "orphaned, its quote is no longer in the body"
          : `chars ${String(anchor.range.start)}–${String(anchor.range.end)}`;
      lines.push(
        `  ${anchor.anchorId} → ${anchor.threadId} (${anchor.threadStatus}) · ${position} · "${oneLine(anchor.selector.exact)}"`,
      );
    }
  }

  lines.push("", doc.body.trim() === "" ? "(no body)" : doc.body.trimEnd());
  return lines;
}

/** An anchor's quote, collapsed to a single line so one anchor is one line. */
function oneLine(exact: string): string {
  const collapsed = exact.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_QUOTE ? collapsed : `${collapsed.slice(0, MAX_QUOTE - 1)}…`;
}

/**
 * SPEC.md §7's refusal, rendered so that **an agent can recover from the message
 * alone**. That is the whole requirement: a caller that cannot act on what it
 * reads guesses, and guessing here means writing over someone's work.
 *
 * So it says the two useful things and nothing else. *What the document now
 * says* — the whole of it, rendered as a document rather than dumped as a
 * payload, because the point of the server sending it is that the writer reads
 * it. And *the fresh key*, quoted in the hint beside the flag it goes in, so the
 * retry is one line down from the sentence telling you to retry.
 *
 * The advice **inverts** what the old `423` carried. A lock conflict meant a
 * person was typing and retrying in a loop was the wrong answer; a stale key
 * means the document moved and **re-reading then retrying is exactly right** —
 * it is the mechanism's designed path, not a failure. The message says so,
 * because an agent that reads "conflict" and stops has lost the edit as surely
 * as one that overwrites.
 *
 * ## `keyed: false` — the same refusal on the one route that presents no key
 *
 * SPEC.md §7 exempts `corpus doc patch`: quoting the text it expects to find
 * *is* its staleness check, so it has no `--key` and passing one is exit 2. The
 * keyed recovery above would therefore name a flag that does not exist, and an
 * agent following it reaches a dead end — the recovery it needs was stated only
 * in a reference table it was not reading (PR #44 re-review). So that route gets
 * {@link patchStaleKeyError}: a different fact, a different recovery, and no
 * document.
 */
export function staleKeyError(
  status: number,
  doc: Doc,
  options: { readonly keyed?: boolean } = {},
): StaleKeyError {
  // Keyed by default: every write but one presents a key, so the exception has
  // to ask for itself rather than be assumed.
  if (options.keyed === false) return patchStaleKeyError(status, doc);

  const id = doc.frontmatter.id;
  return new StaleKeyError(
    `${String(status)} stale_key: ${id} changed after the read that handed you that key — ` +
      `nothing was written, and the text you tried to save is still yours to resend.`,
    {
      status,
      hint:
        `Reconcile against the document below — it is what \`corpus doc show ${id}\` would print ` +
        `right now — then run the same command again with \`--key ${doc.key}\`. Retrying after a ` +
        `re-read is the expected path here, not a failure.`,
      // The machine reader's copy: `--json` emits this structurally, so
      // `.error.details.key` is the fresh key and `.error.details.body` is the
      // current content, un-rendered and un-truncated.
      details: doc,
      detailLines: ["", ...documentLines(doc)],
    },
  );
}

/**
 * The stale-key refusal of `corpus doc patch`, which is a different event
 * wearing the same code.
 *
 * A keyed write goes stale because *the caller* read the document and then
 * something else wrote it. A patch presents no key at all: the server reads the
 * body, matches the excerpt, and hands the result to the ordinary write path
 * with the key of the bytes it just matched (`packages/contract/src/routes/
 * doc-patch.ts`). For that key to be stale, something **outside Corpus** must
 * have rewritten the file inside that window. The caller did nothing wrong, its
 * excerpt is very likely still there, and the patch is still the right patch —
 * so the recovery is to run the identical command again, and the message says
 * exactly that.
 *
 * ## Why it does not print the document
 *
 * `doc patch` exists so that a bounded change costs the bounded amount instead
 * of the length of the file. A refusal that ships the whole document back
 * inverts that premise on the one verb whose reason to exist is not shipping it
 * — and it is not even usable here: there is no key to re-present and no merged
 * body to resend, so nothing in the recovery reads it. What replaces it is the
 * two-step the hint names: run it again, and *if* that is refused at exit 10,
 * the excerpt really is gone and `corpus doc show` is the way to see what
 * replaced it. Worst case that is one extra command, in the rarer of two rare
 * cases; the alternative is paying for a document on every occurrence.
 *
 * `details` still carries it, un-rendered, so `--json` loses nothing: a caller
 * that wants to check its excerpt against the new body before retrying reads
 * `.error.details.body` and spends the round trip only if it wants to. The empty
 * `detailLines` is how this file says "the prose is the human rendering"
 * (`patchRefusal`'s precedent in `patch.ts`); without it the renderer would fall
 * back to dumping `details` as JSON, which is the document again and worse.
 */
function patchStaleKeyError(status: number, doc: Doc): StaleKeyError {
  const id = doc.frontmatter.id;
  return new StaleKeyError(
    `${String(status)} stale_key: ${id} was changed by something outside Corpus while this ` +
      `patch was being applied — nothing was written, and the patch itself is still good.`,
    {
      status,
      hint:
        `Run the same patch again. If it is refused at exit 10 instead, the text you quoted is ` +
        `no longer there — re-read with \`corpus doc show ${id}\` and quote what it says now.`,
      details: doc,
      detailLines: [],
    },
  );
}
