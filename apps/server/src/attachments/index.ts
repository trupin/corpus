// Attachments (SPEC.md §6): ingest on the two multipart write paths, and the
// read route that serves the bytes back.

export {
  CONTENT_TYPES,
  DEFAULT_CONTENT_TYPE,
  IMAGE_EXTENSIONS,
  contentTypeOf,
  extensionOf,
  isImageName,
  isInlineDisposition,
} from "./mime.js";
export {
  DEFAULT_ATTACHMENT_LIMITS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  assertWithinLimits,
  createUploadSizeGuard,
  fileTooLargeMessage,
  formatBytes,
  requestTooLargeMessage,
  type AttachmentLimits,
} from "./limits.js";
export {
  FALLBACK_NAME,
  MAX_NAME_LENGTH,
  dedupeName,
  sanitizeAttachmentName,
  storedNames,
} from "./names.js";
export {
  ATTACHMENT_URL_PREFIX,
  attachmentReference,
  attachmentReferences,
  attachmentTarget,
  withAttachmentReferences,
} from "./references.js";
export {
  ATTACHMENTS_PATH_PREFIX,
  ATTACHMENT_NOT_FOUND_BODY,
  createAttachmentHandler,
  createRawAttachmentPathGuard,
  isUnnormalizedAttachmentTarget,
  mountAttachmentRoutes,
  parseAttachmentPath,
  type AttachmentServeOptions,
} from "./serve.js";
export {
  ATTACHMENTS_DIRNAME,
  attachmentsRootOf,
  removeThreadAttachments,
  removeTurnAttachments,
  threadAttachmentDir,
  turnAttachmentDir,
  writeTurnAttachments,
  type StoredAttachment,
} from "./store.js";
