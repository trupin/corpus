/**
 * Capture (SPEC.md §11): the composer's "this should live on as a document"
 * action, composed from the document and thread primitives into one call and one
 * commit.
 */

export {
  CAPTURE_DOC_TYPE,
  CAPTURE_TITLE_LENGTH,
  FILING_REQUEST,
  UNTITLED_CAPTURE,
  captureDocument,
  captureTitle,
} from "./capture.js";
export type { CaptureOutcome } from "./capture.js";
export { mountCaptureRoutes } from "./routes.js";
