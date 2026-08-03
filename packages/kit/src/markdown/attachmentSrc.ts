/**
 * Which `<img src>` values name a **workspace attachment**, and what target the
 * authenticated fetch wants for them (SPEC.md §11's "images anywhere in a body
 * that reference workspace attachments load through the same authenticated
 * path as turn attachments").
 *
 * The question exists because `/attachments/*` sits behind the workspace bearer
 * token and a browser sends no `Authorization` header on an `<img src>` — see
 * {@link useAttachment}. A reference the renderer leaves as a bare relative
 * `src` therefore does not 404 loudly; it resolves against the SPA route and
 * loads nothing at all. So the renderer has to know which sources are ours.
 *
 * The grammar is the server's, from the other end: `attachmentTarget()` in
 * `apps/server/src/attachments/references.ts` writes
 * `attachments/<thread>/<ts>/<name>` with every segment after the first
 * percent-encoded exactly once, and the serving route decodes each segment
 * exactly once. Nothing here re-encodes or decodes: the target travels through
 * `fetchAttachment` byte-for-byte as the body wrote it, which is what makes the
 * round trip total.
 */

/** The one prefix that means "the workspace serves these bytes". */
export const ATTACHMENT_PREFIX = "attachments/";

/**
 * A URL scheme — `https:`, `data:`, `blob:`. Anchored, and the class excludes
 * `/`, so an attachment path whose *later* segments carry an encoded colon can
 * never be mistaken for one.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The attachment this source names, or `null` when it names something else.
 *
 * `null` is the "leave it exactly alone" answer, and it is the answer for every
 * remote URL, every `data:`/`blob:` source, and every relative path that is not
 * under `attachments/`. Those already render; nothing about them is this
 * package's business.
 *
 * Three sources are refused on purpose rather than by omission:
 *
 * - a **protocol-relative** `//host/attachments/x` is another origin wearing a
 *   familiar path, and the token must not follow it;
 * - a `..` segment resolves *out* of `/attachments` before the request is sent
 *   (`new URL` does that, not the server), so a body could aim an authenticated
 *   read at an unrelated route by writing one;
 * - a bare `attachments/` with nothing after it addresses no file.
 */
export function attachmentTarget(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed === "" || trimmed.startsWith("//") || SCHEME.test(trimmed)) return null;

  // Both spellings a body may use for the same file. The leading slash is
  // dropped rather than kept because `fetchAttachment` resolves the target
  // against the server origin, where `attachments/x` and `/attachments/x` are
  // one path.
  const path = trimmed.replace(/^\.?\//, "");
  if (!path.startsWith(ATTACHMENT_PREFIX) || path.length === ATTACHMENT_PREFIX.length) return null;
  if (path.split("/").includes("..")) return null;
  return path;
}
