// SPEC.md §7's resident (SHARED-043, SERVER-109): the agent a standalone thread
// belongs to, as it is stored in that thread's frontmatter.
//
// One reader, for the same reason `provenance.ts` is one reader of `origin`:
// three paths ask this question of raw frontmatter — the file parser (§14
// validation), the thread read that answers the wire, and the projection — and
// three spellings of "is this a resident" is how they come to disagree about a
// hand-written file.
//
// **Lenient, like every other read of a file the server did not write.** A
// `resident:` key that is not `{name, docId}` reads as *no resident* rather than
// failing the document: `resident` was a legal frontmatter key before it meant
// anything here (§5 and §12 make frontmatter the plugin extension point), so a
// workspace may already hold a thread whose `resident:` means something else
// entirely, and a corpus that predates a field must not become unreadable
// because of it. What the value cannot do is be *half* honoured: the wire
// promises `{name, docId}` or null, so anything else is null.

import { ResidentSchema, type Resident } from "@corpus/contract";

/**
 * The resident stored on a frontmatter mapping, or `null`.
 *
 * Validated with the contract's own `Resident` schema rather than a hand-written
 * predicate, so "what the file may say" and "what the wire carries" are the same
 * shape by construction — including the name's bounds, which exist precisely so
 * an unbounded string never reaches a lookup.
 */
export const residentOrNull = (value: unknown): Resident | null => {
  const parsed = ResidentSchema.safeParse(value);
  return parsed.success ? { name: parsed.data.name, docId: parsed.data.docId } : null;
};

/**
 * The resident a thread's frontmatter designates: {@link residentOrNull} of the
 * `resident` key, and `null` for a thread that has a parent.
 *
 * §7 allows the designation only on a **standalone** thread — "a thread on a
 * document is *about* that document, and a resident owns a conversation rather
 * than a passage" — and the contract states the consequence as a promise about
 * every response: `resident` is always null on an anchored or whole-document
 * thread. The routes refuse to write one there, so this is about the other way
 * in: a hand-edited file, which §5 makes the source of truth. Filtering it here,
 * where both the wire read and the projection ask, is what keeps the promise
 * true of a workspace the server did not write.
 */
export const storedResident = (value: unknown, parent: string | null): Resident | null =>
  parent === null ? residentOrNull(value) : null;
