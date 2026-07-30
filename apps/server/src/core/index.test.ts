import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("core public surface", () => {
  it("exposes the whole document model from one entry point", () => {
    // Nothing outside `core/` imports its internal modules directly, so this
    // list is the contract the rest of the server codes against.
    for (const name of [
      "parseDocument",
      "serializeDocument",
      "setFrontmatterFields",
      "setBody",
      "duplicateKeysAt",
      "hasFrontmatterKey",
      "DocumentParseError",
      "FileFrontmatterSchema",
      "FileThreadFrontmatterSchema",
      "validateFrontmatter",
      "documentFrontmatter",
      "threadFrontmatter",
      "isThreadFrontmatter",
      "parseTurns",
      "parseThreadBody",
      "appendTurn",
      "deleteTurn",
      "duplicateTurnTimestamps",
      "newId",
      "IdGenerationError",
      "ID_PREFIXES",
      "idPrefixForDocType",
      "isDocId",
      "isThreadId",
      "isDocumentId",
      "isAnchorId",
      "isEventId",
      "readForm",
      "carriesForm",
      "extractRefs",
      "referencedIds",
      "documentPathFor",
      "parseDocumentPath",
      "slugifyTitle",
      "isWorkspaceRelative",
      "resolveInWorkspace",
      "PathTraversalError",
      "checkCorpus",
      "toCheckDocument",
      "CHECK_CODES",
      "nowIso",
      "normalizeInstant",
      "normalizeCalendarDate",
      "codeRanges",
      "fencedCodeRanges",
      "inlineCodeRanges",
      "splitLines",
      "overlapsRange",
    ]) {
      expect(core, `core should export ${name}`).toHaveProperty(name);
    }
  });

  it("round-trips a document through the entry point alone", () => {
    const raw = "---\nid: doc_a1b2c3\ntype: note\n---\nBody.\n";
    expect(core.serializeDocument(core.parseDocument(raw))).toBe(raw);
  });
});
