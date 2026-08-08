// `POST /api/capture` — the composer's Capture action (SPEC.md §11, §6).
//
// One call, three effects, **one commit**: an inbox document holding the
// captured text, a whole-document filing thread on it, and the
// `comment.created` that asks the agent to file it. It is a composition of
// primitives that already exist — no new machinery — and it exists as one
// endpoint only so the board can show the new document with its pending-agent
// indicator without a three-call round trip that can half-fail.
//
// **Filing is the default, not the point of the flag.** `requestsAgent` omitted
// requests the agent, because a capture nobody files is an inbox that only
// grows. An explicit `false` still creates both files — it is a capture the user
// wants to file themselves, not a capture that did not happen.
//
// **Attachments belong to the conversation, not to the document** (SPEC.md §6,
// SERVER-010). A capture's files land on the *filing thread's* first turn —
// `.corpus/attachments/<threadId>/<turn-ts>/` — and only that turn's body gains
// the reference lines. The inbox document keeps the captured text alone: §6 puts
// attachments on *turns*, and a document body quoting bytes the user attached to
// a message would be the server inventing content. "Screenshot + one line is a
// first-class capture" is satisfied by the thread the screenshot is attached to.
//
// `CaptureRequestSchema.text` stays `min(1)` and mandatory, so an
// attachment-only capture remains a `400` — that is the contract's rule, not
// this module's, and SERVER-010 does not change it.

import type { Actor, CaptureRequest, CaptureResult } from "@corpus/contract";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  assertWithinLimits,
  attachmentReferences,
  withAttachmentReferences,
} from "../attachments/index.js";
import {
  DEFAULT_DOC_FOLDER,
  DOCS_ROOT,
  ID_PREFIXES,
  THREADS_ROOT,
  appendTurn,
  emptyDocument,
  formatInstant,
  newId,
  serializeDocument,
  setFrontmatterFields,
} from "../core/index.js";
import {
  CREATE_LANE,
  allocatePath,
  isIdTaken,
  loadDocument,
  runMutation,
  validateBeforeWrite,
  type DocumentMutex,
  type MutationResult,
} from "../docs/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import {
  CAPTURE_SUBJECT,
  EVENT_SOURCE,
  assertClosedFences,
  decideParticipation,
  deriveThreadTitle,
  enqueueComment,
  firstProseLine,
  parseMentions,
  storeTurnFiles,
  whileUnreferenced,
  type ThreadsWorkspace,
} from "../threads/index.js";

/** The document type a capture lands as — a plain note, filed in `inbox/` (§11). */
export const CAPTURE_DOC_TYPE = "note";

/** How much of the captured text becomes the document's title. */
export const CAPTURE_TITLE_LENGTH = 80;

export const UNTITLED_CAPTURE = "Untitled capture";

/**
 * What the filing thread's first turn says. The wording is this module's; what
 * is asserted is that the ask is *there* — a capture whose thread said nothing
 * would wake the agent with no instruction. Deliberately free of `@agent`: the
 * enqueue is decided by the flag, and a body that begs for the agent while
 * `requestsAgent: false` suppressed the event would be a lie on disk.
 */
export const FILING_REQUEST =
  "Captured to the inbox. Please file it: give it a real title, move it out of `inbox/`, " +
  "expand it if it is a stub, and tag it.";

export interface CaptureOutcome {
  readonly result: CaptureResult;
  readonly mutation: MutationResult;
}

/** The captured text's first prose line, as a title. */
export function captureTitle(text: string): string {
  const line = firstProseLine(text);
  return line === null ? UNTITLED_CAPTURE : line.slice(0, CAPTURE_TITLE_LENGTH);
}

export async function captureDocument(
  workspace: ThreadsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  request: CaptureRequest,
): Promise<CaptureOutcome> {
  assertWithinLimits(request.files, workspace.attachmentLimits ?? DEFAULT_ATTACHMENT_LIMITS);
  // The captured text becomes the filing thread's first turn as well as the
  // document's body, so a fence left open here swallows the filing request
  // itself and every reply the agent or the person writes afterwards
  // (SERVER-075). Refusing the capture covers both files at once: they carry the
  // same words, and there is no version of this where the document is worth
  // writing and the conversation about it is not.
  assertClosedFences(request.text, CAPTURE_SUBJECT);

  // One lane: both ids are minted against the projection and the document's
  // filename is deduped against the filesystem, so a concurrent capture of the
  // same text must not be choosing its slug at the same moment.
  return mutex.run(CREATE_LANE, async () => {
    const stamp = formatInstant(workspace.now());
    const docId = newId(ID_PREFIXES.doc, (candidate) => isIdTaken(workspace.projection, candidate));
    const threadId = newId(ID_PREFIXES.thread, (candidate) =>
      isIdTaken(workspace.projection, candidate),
    );
    const title = captureTitle(request.text);
    const docPath = allocatePath(
      workspace.workspaceRoot,
      { id: docId, type: CAPTURE_DOC_TYPE, title },
      `${DOCS_ROOT}/${DEFAULT_DOC_FOLDER}`,
    );

    // Mentions come from the *captured* text alone: `/comment` in what the user
    // wrote routes the filing, while the server's own filing sentence must never
    // resolve to anything.
    const parsed = parseMentions(workspace.projection, request.text);
    const decision = decideParticipation({
      // Omitted means "file this" — the contract's documented default for a
      // capture, and the opposite of thread creation's mention-only default.
      // Written as an explicit branch rather than `?? true`: the tri-state is
      // three instructions, and only *omitted* becomes the default here.
      requestsAgent: request.requestsAgent === undefined ? true : request.requestsAgent,
      author: actor,
      parsed,
      thread: null,
    });

    const docText = serializeDocument(
      setFrontmatterFields(emptyDocument(`${request.text}\n`), {
        id: docId,
        type: CAPTURE_DOC_TYPE,
        title,
        created: stamp,
        updated: stamp,
        tags: [],
        status: "open",
        anchors: {},
        due: null,
        reviewed: null,
        evergreen: false,
      }),
    );

    // Bytes before markdown: the stamp names their directory and the turn body
    // quotes it, so a reference can never be committed ahead of the file. A
    // failure while the markdown is still being *built* removes them again — §6
    // forbids a committed reference to a file that does not exist — and
    // `whileUnreferenced` is where that window closes (SERVER-021).
    const stored = await storeTurnFiles(workspace, threadId, stamp, request.files);
    const threadPath = `${THREADS_ROOT}/${threadId}.md`;

    const prepared = whileUnreferenced(workspace.attachmentsRoot, threadId, stamp, stored, () => {
      const turnText = withAttachmentReferences(
        `${request.text}\n\n${FILING_REQUEST}`,
        attachmentReferences(
          threadId,
          stamp,
          stored.map((file) => file.name),
        ),
      );
      const { body, turn } = appendTurn("", { author: actor, text: turnText, ts: stamp });
      const threadText = serializeDocument(
        setFrontmatterFields(emptyDocument(body), {
          id: threadId,
          type: "thread",
          title: deriveThreadTitle({ parentTitle: title, body: turnText }),
          created: stamp,
          updated: stamp,
          tags: [],
          status: "open",
          parent: docId,
          anchor: null,
          agent: decision.agent,
        }),
      );

      return {
        turn,
        threadText,
        warnings: [
          ...validateBeforeWrite(workspace, docPath, docText),
          ...validateBeforeWrite(workspace, threadPath, threadText),
        ],
      };
    });

    // From here on the bytes stay, whatever fails: the write pipeline may already
    // have committed the turn that quotes them.
    const mutation = await runMutation(workspace, {
      docId,
      actor,
      warnings: prepared.warnings,
      plan: {
        operations: [
          { kind: "write", path: docPath, content: docText },
          { kind: "write", path: threadPath, content: prepared.threadText },
        ],
        stage: [docPath, threadPath],
        project: [docPath, threadPath],
        unproject: [],
        commit: { subject: `capture: ${title} (${docId}) by ${actor}` },
        keys: [DOCS_KEY, docKey(docId), docKey(threadId), threadKey(threadId)],
        // The captured document lands in a folder under `data/docs/`, and its
        // filing thread counts there too.
        mayChangeTree: true,
      },
    });

    const eventId = decision.enqueue
      ? await enqueueComment(workspace, {
          threadId,
          parentId: docId,
          turnTs: prepared.turn.ts,
          parsed,
          source: EVENT_SOURCE.capture,
        })
      : null;

    // Read back rather than trusting the plan: the capture answers with ids, and
    // an id that names no readable document would be a lie the client caches.
    loadDocument(workspace.workspaceRoot, workspace.projection, docId);

    return {
      result: { docId, threadId, eventId, warnings: [...mutation.warnings] },
      mutation,
    };
  });
}
