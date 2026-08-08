// A document file that every user — root included — fails to read
// (SERVER-064).
//
// Getting this right is most of the test, because the two obvious tricks each
// fail in their own way:
//
// - **A directory named `*.md` is never offered to the reader.** That is what
//   the queue's equivalent test uses (SERVER-063: `readdir` lists
//   `evt_*.json`, and every read of it fails `EISDIR`), and it does not
//   transfer. `enumerateDocuments` requires `isFile()` — stat-resolved, so a
//   symlink to a directory and a FIFO are refused too — and a path it never
//   enumerates never reaches `projectDocument`.
// - **`chmod 000` is not a proof by itself.** It produces exactly the fault a
//   real workspace produces, on a real regular file, for free — but **root
//   bypasses file permissions**, so under uid 0 the file reads fine and the test
//   passes while exercising nothing. A test that silently stops testing is worse
//   than no test, and plenty of CI runs as root.
//
// So the fixture does not *assume* it worked: it makes the file unreadable and
// then **checks**, and only if the check says the read succeeded — i.e. only for
// a caller privilege can carry through a permission bit — does it escalate to a
// mechanism no privilege can bypass. A file larger than `kIoMaxLength` (2 GiB)
// is refused by `readFileSync` in Node's own JavaScript, decided by the file's
// size and nothing else: there is no bit to override, no capability that helps,
// and nothing platform- or filesystem-specific about it. `truncate` extends the
// file sparsely, so the 2 GiB is a number in the inode rather than bytes on disk
// (~1 ms to create, 4 KB used) — it is only the fallback because *reading* it is
// what costs: Node's utf8 fast path skips the size check and reads the whole
// file before failing to make a string of it (measured: 2.3 GB peak RSS, 0.75 s),
// which is a poor thing to do on every run of a suite that has a free
// alternative for every non-root user.
//
// Either way the postcondition is the same and is verified before this function
// returns: the path is a regular file the enumeration will offer, and reading it
// throws. The code under test branches on *whether the read threw*, never on
// which errno — the E2E log covers the `EACCES` spelling end to end against a
// real server.

import { chmodSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";

/** Node's `kIoMaxLength`: one byte past what `readFileSync` will return. */
const READ_LIMIT_BYTES = 2 ** 31;

/**
 * How such a read fails, as the reason reaches a log line, a `skipped` entry and
 * a `doctor` finding. Both spellings the fixture can produce, named once so a
 * change in Node's wording is a one-line fix rather than a hunt: `EACCES` for the
 * permission bit, the two size messages for the fallback (Node refuses a Buffer
 * read and a string read in different places, with different words).
 */
export const UNREADABLE_REASON = /EACCES|2 GiB|0x1fffffe8/;

/** True once reading `absPath` throws for *this* process. */
function isUnreadable(absPath: string): boolean {
  try {
    readFileSync(absPath);
    return false;
  } catch {
    return true;
  }
}

/**
 * Creates a regular, enumerable `.md` file at `absPath` that this process cannot
 * read, whoever it is running as.
 *
 * The frontmatter is real and valid on purpose: the file must be unprojectable
 * because of how it has to be *read*, not because of what it says, or the
 * fixture would prove the malformed-content branch instead.
 */
export function writeUnreadableDocument(absPath: string): void {
  writeFileSync(absPath, `---\nid: doc_unreadable\ntype: note\ntitle: Unreadable\n---\n\nBody.\n`);
  chmodSync(absPath, 0o000);
  // Running as root: the permission bit was ignored, so make it a size the
  // reader refuses instead. Checked rather than inferred from `getuid()`, which
  // is not the only way a privilege model can hand back the read.
  if (!isUnreadable(absPath)) truncateSync(absPath, READ_LIMIT_BYTES);

  // The fixture's own contract, asserted here so a test that depends on it can
  // never quietly become a test of nothing.
  if (!statSync(absPath).isFile()) {
    throw new Error(`${absPath} is not a regular file; the enumeration would skip it`);
  }
  if (!isUnreadable(absPath)) {
    throw new Error(`${absPath} is still readable; the fixture proves nothing`);
  }
}
