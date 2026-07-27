// Filename sanitization — the one place in Corpus where a string chosen by an
// untrusted client becomes part of a path the server writes to and later serves
// (SPEC.md §6).
//
// **Allow-list, not deny-list.** A deny-list of "dangerous" characters is a
// promise to have thought of all of them; this keeps Unicode letters and digits,
// `.`, `-` and `_`, and turns everything else into `-`. That covers separators,
// NUL, control bytes and shell metacharacters in one rule — and, as a bonus,
// makes the stored name identical to its percent-encoded form for every ASCII
// name, so the committed markdown reference stays readable (sprint-007 Open
// Conflict 12).
//
// **The result is never `.` or `..`, never starts with a dot, and never contains
// a separator.** The serving path assumes none of that — it re-checks every
// segment of every request — but it is what makes an ingested name safe in the
// first place.

import { stripControlCharacters } from "./chars.js";

/** Total length of a stored name, extension included. */
export const MAX_NAME_LENGTH = 100;

/**
 * Longest suffix still treated as an extension worth preserving through
 * truncation. A "name" whose last dot is forty characters from the end is not
 * carrying an extension, and preserving it would eat the whole budget.
 */
export const MAX_EXTENSION_LENGTH = 16;

/** What a name that sanitizes to nothing becomes. */
export const FALLBACK_NAME = "file";

/** Characters kept verbatim; everything else collapses to a single `-`. */
const DISALLOWED = /[^\p{L}\p{N}._-]+/gu;

/**
 * The basename, treating both `/` and `\` as separators. A Windows-shaped name
 * from a browser on Windows is a real case, and `..\..\etc\passwd` must lose its
 * directories exactly as the POSIX form does.
 */
function basenameOf(raw: string): string {
  const index = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  return index === -1 ? raw : raw.slice(index + 1);
}

/** The `.ext` worth preserving through truncation, or `""`. */
function extensionSuffix(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  const suffix = name.slice(dot);
  return suffix.length > MAX_EXTENSION_LENGTH ? "" : suffix;
}

/**
 * Slice by code unit without splitting a surrogate pair. The allow-list keeps
 * `\p{L}`, which includes astral letters, so a cut at an arbitrary UTF-16 index
 * can otherwise leave a lone high surrogate — a filename no encoder round-trips.
 */
function sliceCodeUnits(value: string, length: number): string {
  const cut = value.slice(0, length);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Truncate to {@link MAX_NAME_LENGTH} while keeping the extension, so a
 * 300-character screenshot name still renders as an image and still opens in the
 * right application.
 */
function truncate(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;

  const suffix = extensionSuffix(name);
  const stem = sliceCodeUnits(name, MAX_NAME_LENGTH - suffix.length);
  // A stem truncated to nothing would leave a name starting with `.`, which
  // callers have been promised cannot happen.
  return suffix === "" || stem === "" ? sliceCodeUnits(name, MAX_NAME_LENGTH) : `${stem}${suffix}`;
}

/**
 * The name an uploaded file is stored under. Total — every input, including the
 * empty string and a name made entirely of dots, produces a usable name.
 */
export function sanitizeAttachmentName(raw: string): string {
  // Control characters are removed, not mapped: turning a stray bell into a `-`
  // would put a separator in a name whose author never typed one.
  const cleaned = stripControlCharacters(basenameOf(raw.normalize("NFC")))
    .replace(DISALLOWED, "-")
    .replace(/-{2,}/g, "-")
    // Leading dots would make a hidden file (and are how `.` and `..` are
    // spelled); trailing dots and dashes are noise a filesystem barely tolerates.
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");

  return cleaned === "" ? FALLBACK_NAME : truncate(cleaned);
}

/**
 * A name not yet used in `taken`, suffixed before the extension: `shot.png`,
 * `shot-2.png`, `shot-3.png`. The candidate is built to fit
 * {@link MAX_NAME_LENGTH} rather than built and then truncated — see the loop.
 *
 * Comparison is case-insensitive because the turn directory may live on a
 * case-insensitive filesystem, where `Shot.png` and `shot.png` are one file —
 * two uploads differing only in case must still become two files.
 */
export function dedupeName(name: string, taken: ReadonlySet<string>): string {
  const lowered = new Set([...taken].map((entry) => entry.toLowerCase()));
  if (!lowered.has(name.toLowerCase())) return name;

  const suffix = extensionSuffix(name);
  const stem = name.slice(0, name.length - suffix.length);

  for (let counter = 2; ; counter += 1) {
    const marker = `-${String(counter)}`;
    // **The stem makes room for the marker; the marker is never truncated.**
    // Appending and then truncating does not terminate: a name already at
    // {@link MAX_NAME_LENGTH} truncates straight back to itself, so every
    // candidate equals the taken name and the loop spins forever. That is
    // reachable from an upload — two files whose sanitized names are both
    // 100 characters — so it is a hang, not a curiosity. Trimming the stem
    // instead makes each candidate differ in its marker, which bounds the loop
    // at `taken.size + 1` iterations.
    const room = MAX_NAME_LENGTH - suffix.length - marker.length;
    const trimmed = room > 0 ? sliceCodeUnits(stem, room) : "";
    const candidate = `${trimmed === "" ? FALLBACK_NAME : trimmed}${marker}${suffix}`;
    if (!lowered.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Stored names for one turn's uploads, in upload order — sanitized, then
 * deduplicated against each other. Pure: nothing is written here, so a request
 * that is going to be refused never creates a directory.
 */
export function storedNames(rawNames: readonly string[]): string[] {
  const taken = new Set<string>();
  return rawNames.map((raw) => {
    const name = dedupeName(sanitizeAttachmentName(raw), taken);
    taken.add(name);
    return name;
  });
}
