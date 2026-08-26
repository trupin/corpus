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
 * TEST-2. `index.ts` is the shared UI kit's whole surface (SPEC.md §10), so it
 * is pinned rather than described: a new export is a deliberate decision that
 * shows up here, and a removed one is a change every board surface feels.
 */
const RUNTIME_SURFACE = [
  "PACKAGE_NAME",
  // data path
  "createCorpusClient",
  "CorpusRequestError",
  "reattachRefusalReason",
  "staleKeyDoc",
  "unknownRecipientLane",
  "CorpusProvider",
  "mountedCorpusProviders",
  "createCorpusQueryClient",
  "useCorpusClient",
  // read hooks
  "useDocs",
  "useDoc",
  "useThread",
  "useTree",
  "useRelatedDocs",
  "useCorpusSearch",
  "useJobs",
  "useOutstandingJobs",
  "OUTSTANDING_JOB_STATUSES",
  "OUTSTANDING_JOB_STATUS_PARAM",
  "useJobLog",
  "capLogLines",
  "EMPTY_JOB_LOG",
  "MAX_BUFFERED_LOG_LINES",
  "useQueueStatus",
  "useAgentsRoster",
  "useIndexStatus",
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
  "useSetDocArchived",
  "useMoveDoc",
  "useCreateDoc",
  "useCapture",
  "useCreateThread",
  "useDeleteDoc",
  "useRenameFolder",
  "useSetFolderArchived",
  "useDeleteFolder",
  "useReorderBoards",
  "useMarkThreadSeen",
  "useSetThreadStatus",
  "useSetResident",
  "useReattachThread",
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
  "AGENTS_KEY",
  "DOCS_KEY",
  "HEALTH_KEY",
  "INDEX_KEY",
  "jobKey",
  "jobsListKey",
  "JOBS_KEY",
  "QUEUE_KEY",
  // The reflection clock's key (SPEC.md §7's rider 9). Named on every frame that
  // names `["docs"]` or `["queue"]`, so one subscription covers the Reflect
  // control's count and its pending state (UI-153).
  "REFLECT_KEY",
  "relatedKey",
  "searchKey",
  "threadKey",
  "threadScopeKey",
  "TREE_KEY",
  // live updates
  "Row",
  "AgeChip",
  "NeedsYouBadge",
  "UnreadBadge",
  "unreadBadgeProps",
  "WorkingDot",
  // …and the same dot for work nobody has taken, plus the one call that picks
  // between them so no row implementation decides for itself (UI-097).
  "QueuedDot",
  "AgentActivityDot",
  // …and the diamond for a document changed since the agent last reflected,
  // which three surfaces draw — a row, a column head, a board tab (UI-153).
  "ChangedMark",
  "CHANGED_MARK_LABEL",
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
  // …and what a row says while the agent has a request parked on somebody's
  // editing (SPEC.md §7, UI-115): a sentence, so the board's dot and the
  // conversation's pending row cannot come to word one state two ways.
  "deferredRowTitle",
  // §11's warning channel as a notice: one tone per code, exhaustive over
  // `WarningCode`, so a carried effect is not painted as a failure (UI-106).
  "WARNING_PRESENTATION",
  "warningNotice",
  "warningNotices",
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
  "isLineBreakTag",
  "remarkTableCellBreaks",
  // images: one renderer, and the door to the app's viewer
  "attachmentTarget",
  "ATTACHMENT_PREFIX",
  "CorpusImage",
  "IMAGE_BROKEN_CLASS",
  "IMAGE_CLASS",
  "IMAGE_PENDING_CLASS",
  "ImageViewerProvider",
  "useImageViewer",
  // the shared `@` / `/` / `[[` autocomplete
  "AutocompleteMenu",
  "applyCompletion",
  "completionText",
  "detectTrigger",
  "TRIGGER_KINDS",
  "AUTOCOMPLETE_LIMIT",
  "GENERIC_AGENT_TOKEN",
  "invocableName",
  "isAddressableTarget",
  "MENTION_DOC_TYPE",
  "rowToken",
  "SKILL_DOC_TYPE",
  "useAutocomplete",
  "useRefCompletions",
  // the one keyboard contract every completion menu obeys
  "handleAutocompleteKeyDown",
  // the composer key contract every composer obeys
  "COMPOSER_NEWLINE_HINT",
  "COMPOSER_PRIMARY_KEY",
  "COMPOSER_SECONDARY_KEY",
  "handleComposerKeyDown",
  // the attachment trio every composer obeys §6 with: the three intake routes,
  // the chip strip that previews them, and the 📎 that opens the picker. Here
  // for the same reason the key contract is — §10's rider binds every composer,
  // and one copy is what makes them all obey it (UI-070).
  "useAttachmentIntake",
  "releaseAttachments",
  "PendingAttachments",
  "AttachButton",
  // the weight a composer may state (SPEC.md §10's rider, signed 2026-08-06).
  // Published here so every composer offers the same levels, with one import and
  // no copy.
  "WEIGHT_TABLE_HEADER",
  "useComposerWeight",
  "useWeightLevels",
  "parseWeightLevels",
  "findOrchestrateSkill",
  "ORCHESTRATE_SKILL_NAME",
  "composerReachesAgent",
  "chooseWeight",
  "weightChoice",
  "subscribeWeightChoices",
  // `resetWeightChoices` is deliberately absent: it is test support, and it lives
  // on `@corpus/kit/testing`. SPEC.md §10 describes no "forget my weights"
  // action, so publishing one on the runtime surface would invent one (UI-082's
  // PR #35 review).
  "threadWeightScope",
  "docWeightScope",
  "GLOBAL_COMPOSE_WEIGHT_SCOPE",
  // The control the weight and the recipient are shown through since UI-126:
  // one line stating who answers and at what weight, opening to change either.
  // For a resident's lane the weight section is a sentence naming the
  // resident's weight, never a control whose choice would be discarded
  // (SPEC.md §7 and §10, rider signed 2026-08-19).
  "ComposerAddress",
  "composerAddress",
  "answeringRow",
  "residentWeightSentence",
  "weightLabel",
  // What a lane list says when it reached the card's ceiling (UI-130): a capped
  // list that looked complete would be a silent cap.
  "lanesCappedNote",
  "ADDRESS_OPEN_TITLE",
  "ADDRESS_FLOOR_TITLE",
  "ADDRESSED_TO",
  "LAUNCH_WEIGHT_CLAUSE",
  "LINE_SEPARATOR",
  "NOBODY_ASKED",
  "RECIPIENT_GROUP_LABEL",
  "RECIPIENT_LEAD",
  "WEIGHT_GROUP_LABEL",
  "WEIGHT_LEAD",
  "WEIGHT_UNKNOWN_TITLE",
  // SPEC.md §7's recipient — the roster read, the scope walk, the one-message
  // override, and the control. Published for `WeightPicker`'s reason: every
  // composer offers the same live roster from one copy. `useAgentsRoster` is
  // beside the other read hooks above.
  "RECIPIENT_UNKNOWN_STATEMENT",
  "RECIPIENT_REFUSED_STATEMENT",
  "DEFAULT_ROW_NOTE",
  "statementFor",
  "useComposerRecipient",
  "useScopeWalk",
  "useThreadScope",
  "walkToLane",
  "laneOf",
  // The third answer a `ScopeNodeLookup` may give: *the corpus does not hold
  // this*, which is a dead branch, as against a read that has not landed, which
  // withholds (UI-119).
  "SCOPE_NODE_ABSENT",
  "MAX_SCOPE_WALK",
  "laneRow",
  "laneRows",
  "lapsedWaiting",
  "laneName",
  "laneLine",
  "laneLiveness",
  "unknownLaneRow",
  "ORCHESTRATOR_LABEL",
  "UNNAMED_RESIDENT_LABEL",
  "LIVE_WITHOUT_SUMMARY",
  "NEVER_SEEN_LINE",
  "LAPSED_QUIET",
  "LAPSED_ORCHESTRATOR",
  // Who is resident, as against whether they are there — one vocabulary for the
  // three shapes a `Resident` now has, so the badge, the menu and the picker
  // cannot each invent a label for a designation that named no profile
  // (CONTRACT-061, UI-122).
  "laneResidentKind",
  "laneNote",
  // …and the same report at the width of a row in a list, for the surface where
  // a lane is chosen rather than shown: the picker's pills sit side by side and
  // the note is a sentence (PR #49 review).
  "laneMark",
  "GENERAL_RESIDENT_LABEL",
  "MISSING_PROFILE_MARK",
  "MISSING_PROFILE_NOTE",
  // …and the acts that sentence is composed from, exported because the parity
  // test that measures them against the real server pairs each with a workspace
  // act by identity rather than by matching words (PR #50, third review).
  "MISSING_PROFILE_CAUSES",
  // …and the same vocabulary read by a surface that is not a composer (UI-109):
  // is *this* conversation a lane, which lane answers *here*, and the one dot
  // both the picker and the board draw it with.
  "useLaneRow",
  "useResidentLane",
  "LaneDot",
  "humanizeElapsed",
  "useConnectionState",
  "backoffDelay",
  "DEFAULT_BASE_DELAY_MS",
  "DEFAULT_BATCH_WINDOW_MS",
  "DEFAULT_MAX_DELAY_MS",
] as const;

describe("the kit's published surface", () => {
  it("exports exactly the runtime symbols it declares", () => {
    expect(Object.keys(kit).sort()).toEqual([...RUNTIME_SURFACE].sort());
  });

  // The omissions matter more than the exports: a surface that can build its own
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
