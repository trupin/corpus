// What an attachment's *extension* says it is (SPEC.md §6).
//
// The client's declared MIME type is never consulted, for either decision this
// module makes. A browser will happily upload a PDF as `image/png`, and a
// `content-type` a caller chose is not evidence about bytes the server stores —
// so `image/svg+xml` on a `.pdf`, or `application/octet-stream` on a `.png`,
// changes nothing about how the file is referenced or served.

/**
 * Extensions rendered inline as images in the turn body (`![…]`) and served
 * with `Content-Disposition: inline`. `svg` is deliberately **not** here: it is
 * a recognised image type with a content type of its own, but an SVG is a
 * document that can carry script, so it is referenced as an image and served as
 * a download (see {@link isInlineDisposition}).
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
]);

/**
 * Extension → content type. Small and explicit rather than a dependency: the
 * set of things a Corpus attachment plausibly is, is short, and an unknown
 * extension has one correct answer anyway.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Lowercased extension without the dot, or `""` for a name that has none. */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  // A leading dot is not an extension separator — `.hidden` has no extension.
  if (index <= 0) return "";
  return name.slice(index + 1).toLowerCase();
}

/** True when the extension names a format the UI renders inline as an image. */
export function isImageName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Whether the served response says `inline` or `attachment`.
 *
 * Images render inline, with one carve-out: an SVG is XML that may contain a
 * `<script>` element, and an inline SVG served from the workspace origin runs
 * that script with the board's origin. Serving it as a download closes the
 * vector without rewriting anyone's file — the bytes on disk stay exactly what
 * was uploaded.
 */
export function isInlineDisposition(name: string): boolean {
  return isImageName(name) && extensionOf(name) !== "svg";
}
