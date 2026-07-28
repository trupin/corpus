import { ACTOR_HEADER } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import * as kit from "./index.js";

it("exports the package name", () => {
  expect(kit.PACKAGE_NAME).toBe("@corpus/kit");
});

it("resolves @corpus/contract through its package entry point", () => {
  expect(ACTOR_HEADER).toBe("x-corpus-author");
});

/**
 * TEST-2. `index.ts` is the plugin contract (SPEC.md §10), so its surface is
 * pinned rather than described: a new export is a deliberate decision that
 * shows up here, and a removed one is a breaking change for every plugin.
 */
const RUNTIME_SURFACE = [
  "PACKAGE_NAME",
  // data path
  "createCorpusClient",
  "CorpusRequestError",
  "CorpusProvider",
  "mountedCorpusProviders",
  "createCorpusQueryClient",
  "useCorpusClient",
  // read hooks
  "useDocs",
  "useDoc",
  "useThread",
  "useTree",
  "useJobs",
  "useJobLog",
  "capLogLines",
  "EMPTY_JOB_LOG",
  "MAX_BUFFERED_LOG_LINES",
  "useQueueStatus",
  "useLocks",
  "useHealth",
  // write path
  "useAppendTurn",
  "provisionalBody",
  "useDeleteTurn",
  "useRespondToForm",
  "useAttachment",
  "attachmentKey",
  "useMarkSeenOnce",
  "hasSeenMark",
  "resetSeenMarks",
  "useUpdateDoc",
  "useUpdateDocById",
  "useCreateDoc",
  "useCapture",
  "useCreateThread",
  "useDeleteDoc",
  "useMarkThreadSeen",
  "useSetThreadStatus",
  "useBreakLock",
  "useAcquireLock",
  "useReleaseLock",
  "useHaltQueue",
  "useResumeQueue",
  "useRetryJob",
  "useAbandonJob",
  "isPendingTurn",
  "mergePendingTurns",
  "PendingTurnStore",
  // query keys
  "canonicalFilter",
  "docKey",
  "docsListKey",
  "DOCS_KEY",
  "HEALTH_KEY",
  "jobKey",
  "jobsListKey",
  "JOBS_KEY",
  "lockKey",
  "LOCKS_KEY",
  "PLUGIN_KEY_PREFIX",
  "pluginKey",
  "QUEUE_KEY",
  "threadKey",
  "TREE_KEY",
  // live updates
  "Row",
  "AgeChip",
  "LockChip",
  "NeedsYouBadge",
  "UnreadBadge",
  "unreadBadgeProps",
  "WorkingDot",
  "reasonChip",
  "reasonChips",
  "REASON_CHIP_CLASSES",
  "ageAnchor",
  "ageLabel",
  "hasStaleActions",
  "humanizeAge",
  "stalenessClass",
  "stalenessLevel",
  "UNKNOWN_AGE_LABEL",
  "folderOf",
  "isThreadRow",
  "rowContext",
  "rowExcerpt",
  "threadExcerpt",
  "threadKind",
  "THREAD_DOC_TYPE",
  "archivedMessage",
  "triagePrompt",
  "useRowActions",
  "useAgentActivity",
  "useDocLock",
  // rendered markdown + the `[[ref]]` grammar
  "MarkdownView",
  "parseRefs",
  "refIds",
  "remarkCorpusRefs",
  "splitTextNode",
  "REF_ALIAS_ATTRIBUTE",
  "REF_ID_ATTRIBUTE",
  "REF_NODE_TYPE",
  "REF_PATTERN",
  // the shared `@` / `/` / `[[` autocomplete
  "AutocompleteMenu",
  "applyCompletion",
  "completionText",
  "detectTrigger",
  "TRIGGER_KINDS",
  "AUTOCOMPLETE_LIMIT",
  "GENERIC_AGENT_TOKEN",
  "invocableName",
  "MENTION_DOC_TYPE",
  "rowToken",
  "SKILL_DOC_TYPE",
  "useAutocomplete",
  "useConnectionState",
  "backoffDelay",
  "DEFAULT_BASE_DELAY_MS",
  "DEFAULT_BATCH_WINDOW_MS",
  "DEFAULT_MAX_DELAY_MS",
] as const;

describe("the plugin contract surface", () => {
  it("exports exactly the runtime symbols it declares", () => {
    expect(Object.keys(kit).sort()).toEqual([...RUNTIME_SURFACE].sort());
  });

  // The omissions matter more than the exports: a plugin that can build its own
  // transport bypasses the kit's cache, keys and invalidation, and SPEC.md §10's
  // "the UI contract is @corpus/kit" stops meaning anything.
  it.each([
    "CorpusApi",
    "createEventStream",
    "eventStreamUrl",
    "paths",
    "components",
    "operations",
    "uploadTurn",
    "uploadCapture",
    "buildTurnFormData",
    "buildCaptureFormData",
    "QueryClient",
    "useQuery",
    "useMutation",
  ])("does not re-export %s", (symbol) => {
    expect(Object.keys(kit)).not.toContain(symbol);
  });
});
