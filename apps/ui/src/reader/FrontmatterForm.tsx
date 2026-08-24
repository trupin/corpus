import { DOC_STATUSES, type Doc, type DocStatus, type UpdateDocRequest } from "@corpus/contract";
import {
  CorpusRequestError,
  docKey as docQueryKey,
  folderOf,
  useUpdateDoc,
  warningNotice,
  type RowNotice,
} from "@corpus/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useMaybeBoardSurface } from "../board/BoardsProvider";
import { onPageHide } from "../abandon/pagehide";
import { isAbandoned, publishTitleDraft } from "../abandon/registry";
import { unloadClient } from "../abandon/unloadClient";
import { statusLock } from "../doc/statusLock";
import { useContextMenu } from "../menu/ContextMenuHost";
import { offeredStages, stageChoicesFor } from "./stageChoices";
import { beginEditWrite, endEditWrite, useEditSurface } from "../editor/editSessionFlush";
import { SaveChipView } from "../editor/SaveChip";
import { AUTOSAVE_DEBOUNCE_MS, type SaveState } from "../editor/useAutosave";

/**
 * The chip strip **is** the frontmatter editor (SPEC.md §10, rider signed
 * 2026-08-23): _"Frontmatter is edited on the strip that shows it. … every chip
 * that names an editable field **is** the control for that field. There is no
 * second copy of the same values below it, and no labelled form beside it."_
 *
 * The labelled `TAGS` / `STATUS` / `DUE` grid that used to sit under the title
 * is gone — a value displayed in one place and edited in another is two answers
 * to one question. What each chip does now:
 *
 * - a **tag chip** opens a menu offering Rename and Remove; Rename swaps the
 *   chip for an input in place, and a `+` at the end of the tags adds one;
 * - the **status chip** opens §5's one vocabulary, marks the current word, and
 *   says why when the status is not the reader's to set (`statusLock`);
 * - the **stage chip** opens the words the claiming kanbans name, grouped under
 *   their board's title, and is absent when the document is claimed by none and
 *   holds none;
 * - the **due chip** swaps for a date input whose native picker opens, and can
 *   clear the date; with no due date it reads as an unset chip rather than
 *   disappearing, so the field stays reachable;
 * - `type`, the folder and `updated` stay read-only — they are not frontmatter
 *   the reader sets — and the strip still ends with the save chip.
 *
 * The chip menus are the app's one menu frame (`ContextMenuProvider` →
 * `ContextMenu`): anchored to the chip, clamped by `clampToViewport`, with the
 * ceiling derived from the measured room (`menuRoom`, SHARED-061). A menu that
 * invented its own placement here would rediscover UI-159.
 *
 * **Under the body's rule, not beside it: no edit mode, no save button**
 * (SHARED-030, signed 2026-08-12). The controls are live wherever the document
 * is shown, and a change commits where it is made.
 *
 * **One patch, one write.** Every control writes into one *local* map of the
 * fields the person has touched; the request carries only what differs from the
 * document, and only one request is ever on the wire. That is not a nicety: the
 * server compares untouched keys structurally and leaves their bytes alone
 * (SERVER-001), and four controls each firing their own `PUT` would defeat that
 * guarantee from the client side and race each other besides.
 *
 * **When a change is sent** is the one thing this form decides, and it decides
 * it per *change*, not per control — see {@link isDeliberate}. A menu choice is
 * one chosen value and sends at once; typing in a tag rename is a run of
 * keystrokes and waits out the debounce, exactly as the text field it replaced
 * did. Nothing here chooses a cadence: the debounce is `AUTOSAVE_DEBOUNCE_MS`,
 * imported from the body's autosave, because §10 says frontmatter is "debounced
 * exactly as the body's autosave is" and a second constant is how two rules
 * that agree on the day they were written stop agreeing.
 *
 * **Nothing here squashes commits.** Two fields changed a second apart are two
 * writes, and §4's open commit window is what makes them one commit — the same
 * window that already joins them to a body edit made in the same sitting. A
 * batching window of this form's own would be that rule written twice.
 *
 * The body is **not** here. UI-006 owns the always-editable document with its
 * own autosave; this form deliberately stops at frontmatter so there is one
 * writer per concern.
 *
 * **The local map outlives no surface.** Leaving the document flushes it, on the
 * same seams the abandon rule (SPEC.md §10) watches — the reader unmounting or
 * rebinding, and `pagehide`. Without that, a user who typed a title and left
 * (which is the gesture §10 describes as primary — "title selected, ready to
 * type") lost it silently, *and* left behind exactly the untitled empty
 * document UI-017 exists to delete: the abandon rule was keeping the document
 * on the strength of a title that would never be written (UI-017 eval FAIL-1).
 */

export interface FrontmatterFormProps {
  readonly doc: Doc;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  readonly onNotify: (notice: RowNotice) => void;
  /**
   * Rendered between the chip strip and the title — today the archived notice.
   * A prop rather than a sibling because the strip, the banner and the title are
   * one visual block and their order is the mockup's, not the caller's.
   */
  readonly banner?: ReactNode;
}

interface Draft {
  readonly title: string;
  readonly tags: string;
  readonly status: DocStatus;
  /** `""` is *no stage*, which is what the wire spells `null` (SPEC.md §5). */
  readonly stage: string;
  readonly due: string;
}

type FieldName = keyof Draft;

const FIELD_NAMES: readonly FieldName[] = ["title", "tags", "status", "stage", "due"];

/** The value that clears the field — never a legal stage (non-empty). */
export const CLEAR_STAGE = "";

/** The fields the person has touched and the server has not yet confirmed. */
type Local = { -readonly [K in FieldName]?: Draft[K] };

/** `["finance", "mortgage"]` ⇄ `"finance, mortgage"`. Tags are comma-free by contract. */
export function tagsToText(tags: readonly string[]): string {
  return tags.join(", ");
}

export function textToTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}

/**
 * One tag list as the strip renders it and the wire will carry it: trimmed,
 * empties dropped, first occurrence wins. Collapsing here is what makes a tag
 * renamed onto a name the document already has **one** tag rather than a
 * duplicate, and a tag renamed to empty a removal rather than an empty tag.
 */
export function normalizedTags(tags: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    kept.push(trimmed);
  }
  return kept;
}

function draftOf(doc: Doc): Draft {
  const { frontmatter } = doc;
  return {
    title: frontmatter.title,
    tags: tagsToText(frontmatter.tags),
    status: frontmatter.status,
    stage: frontmatter.stage ?? "",
    due: frontmatter.due ?? "",
  };
}

/** SPEC.md §7's reversible act, which this form is deliberately not a door to. */
const ARCHIVED: DocStatus = "archived";

/**
 * Why choosing `archived` in the status menu writes nothing: both directions of
 * the archive act live on their own routes (UI-020, SERVER-039), so the word is
 * shown — it is part of §5's one vocabulary — and gated, with this as the why.
 */
const ARCHIVE_ROUTE_REASON =
  "archive from the ⋯ menu — a status flip would not move a skill’s folder";

/**
 * Whether this change is a **deliberate commit moment** — send it now — or one
 * keystroke in a run of them, which waits out the debounce.
 *
 * The question is asked of the *change*, not of the control, and that is the
 * whole of the distinction. A menu produces one chosen value per gesture and
 * nothing in between, so it always commits — `status` and `stage` are only ever
 * set that way, and a tag **removed** by its menu goes through
 * {@link isDeliberateTagChange} for the same reason. A free-text field produces
 * a value per keystroke and never commits on one, which is what a tag rename
 * in place is.
 *
 * **A date input is discrete except when it is empty**, and that exception is
 * measured rather than assumed: while its segments are half-filled Chromium
 * reports `value === ""` and fires a change for each one, so "commit every
 * change a date picker makes" would clear a stored deadline twice on the way to
 * typing a new one. Empty is also what *clearing* the field looks like, and the
 * two are indistinguishable at the moment they arrive — so the empty value waits
 * out the debounce, which is exactly long enough for the rest of a typed date to
 * arrive and short enough that a deliberate clear still lands by itself.
 */
export function isDeliberate(field: FieldName, value: string): boolean {
  if (field === "status" || field === "stage") return true;
  if (field === "due") return value !== "";
  return false;
}

/**
 * The `PUT` body: only what the user changed.
 *
 * `due` is cleared with `null` rather than by omission, because omission means
 * "leave it alone" on this route — the two have to be distinguishable or a
 * deadline can never be removed.
 *
 * **`status` never crosses the archive boundary from here** (UI-020). Both
 * directions belong to routes this form does not call: `POST …/archive` is the
 * only thing that moves a skill's folder to `.claude/skills-archived/`, and
 * `PUT` with a non-archived `status` on an archived document is refused outright
 * with a `400` naming `POST …/unarchive` (SERVER-039). The guard lives *here*
 * rather than only on the menu because the menu is not the only path to the
 * wire: leaving the document, rebinding the reader and `pagehide` all flush
 * through this function, and guarding the control alone would ship a refusal the
 * user could not connect to anything they did.
 *
 * **The lock is not a second guard here.** The only lock is the archive door, it
 * is read straight off the document this function already holds, and the guard
 * above is exactly it — so nothing strips a second time on the way out.
 */
export function changedFields(doc: Doc, draft: Draft): UpdateDocRequest {
  const current = draftOf(doc);
  const changes: UpdateDocRequest = {};
  const title = draft.title.trim();
  if (title !== "" && title !== current.title) changes.title = title;
  if (draft.status !== current.status && draft.status !== ARCHIVED && current.status !== ARCHIVED) {
    changes.status = draft.status;
  }
  if (draft.tags.trim() !== current.tags) changes.tags = textToTags(draft.tags);
  /*
   * `stage` is cleared with an explicit `null`, like `due` and for the same
   * reason: omission means "leave it alone" on this route, so a stage could
   * never be removed. §5 makes clearing the **unmapped** case — a document in a
   * kanban whose stage is cleared is written `open` in the same commit, by the
   * server, which then says so in a `stage_status` warning.
   *
   * **`status` is never sent alongside it.** The coupling has one home
   * (SERVER-138), and the two controls here write one patch: a user who moved
   * both in one sitting is asking for two things §5 says cannot both hold, and
   * the stage is the one §5 gives the last word.
   */
  if (draft.stage !== current.stage) changes.stage = draft.stage === "" ? null : draft.stage;
  if (draft.due !== current.due) changes.due = draft.due === "" ? null : draft.due;
  return changes;
}

/**
 * **The field a refusal named**, read off the contract's own error shape rather
 * than out of its prose.
 *
 * `assertNotUnarchivingByPut` (SERVER-039) answers a `400 bad_request` whose
 * `issues` carry `path: "body.status"` — the field, structured, said by the only
 * party that knows. That is what makes this precise enough to act on: a `500`, a
 * dropped connection or any other failure names nothing, so nothing is dropped
 * and a save that merely failed still holds everything the person typed.
 *
 * **`status` and nothing else.** A refusal naming `title` says the value was
 * malformed, not that the field is nobody's, and the person's own text is the
 * last thing this form may throw away. `status` is the only field a save can be
 * told is not the person's, so it is the only one this drops.
 *
 * `changedFields` already refuses to send a status across the archive door, so
 * this fires for the one case it cannot see: the projection reports a document
 * archived that its own frontmatter does not (a `SKILL.md` under
 * `.claude/skills-archived/`), and only the server knows.
 */
function statusRefused(error: Error): boolean {
  return (
    error instanceof CorpusRequestError &&
    error.issues.some((issue) => issue.path === "body.status")
  );
}

/**
 * The local map, with `status` removed when a refusal named it.
 *
 * A refusal is the one place the server tells this form a field was not the
 * person's to set, and a value that cannot be written is not an unsaved edit —
 * it is a value that will ride on every later patch and be refused again, which
 * is precisely the wedge PR #55's re-review measured: a `400` on `status`, then
 * a title that could not be saved until the page was reloaded.
 *
 * Returns the map it was given when nothing was named, so the ordinary failure
 * path re-renders nothing at all.
 */
function dropRefused(local: Local, refused: boolean): Local {
  if (!refused) return local;
  let kept: Local = {};
  for (const name of FIELD_NAMES) {
    const value = local[name];
    if (value === undefined || name === "status") continue;
    kept = withField(kept, name, value);
  }
  return kept;
}

/** What the person is looking at: the document, overlaid with what they typed. */
function valueOf(doc: Doc, local: Local): Draft {
  return { ...draftOf(doc), ...local };
}

/**
 * `{ ...local, [name]: value }`, written out.
 *
 * TypeScript cannot type a computed key drawn from a union of literals — the
 * result widens to a string index signature and `status` stops being a
 * `DocStatus`. This switch *is* that inference, so every other site here reads
 * and writes ordinary fields. `status` is checked against the contract's own
 * list on the way in rather than asserted: a menu item is a boundary like any
 * other, and a value nothing recognises changes nothing.
 */
function withField(local: Local, name: FieldName, value: string): Local {
  switch (name) {
    case "title":
      return { ...local, title: value };
    case "tags":
      return { ...local, tags: value };
    case "due":
      return { ...local, due: value };
    case "stage":
      return { ...local, stage: value };
    case "status": {
      const status = DOC_STATUSES.find((each) => each === value);
      return status === undefined ? local : { ...local, status };
    }
  }
}

/** The subset of `local` a request carries, remembered until it answers. */
function pickFields(local: Local, names: ReadonlySet<string>): Local {
  let picked: Local = {};
  for (const name of FIELD_NAMES) {
    const value = local[name];
    if (value === undefined || !names.has(name)) continue;
    picked = withField(picked, name, value);
  }
  return picked;
}

/**
 * `local` with the fields a landed request carried removed — unless the person
 * has typed into one again since it was sent, in which case the newer value is
 * the one that must survive.
 */
function dropSettled(local: Local, carried: Local): Local {
  let kept: Local = {};
  for (const name of FIELD_NAMES) {
    const value = local[name];
    if (value === undefined || value === carried[name]) continue;
    kept = withField(kept, name, value);
  }
  return kept;
}

/**
 * Escape leaves the field, exactly as it leaves the body (`DocEditor`).
 *
 * The escape chain ignores keys typed inside an `input`, a `textarea` or a
 * `select` — otherwise `⌫` would close the reader instead of deleting a
 * character — so with no draft left to revert, Escape in one of these controls
 * would do nothing at all, on a surface whose own hint says "esc closes". The
 * first press blurs and the second reaches the chain, which is the rule the
 * always-editable body already follows.
 */
function leaveOnEscape(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Escape") return;
  event.currentTarget.blur();
}

/**
 * One tag being edited in place — a rename, or the `+` chip's addition, which
 * is a rename of an entry that does not exist yet ({@link TagEdit.index} is
 * then `base.length`).
 *
 * `base` is the list the edit started from, and the other chips render from it
 * while the input is up. That is not a cache: the entry under the caret can
 * pass through states — empty, or equal to a neighbour — that
 * {@link normalizedTags} collapses out of the *written* value, and a strip that
 * re-derived itself from that value mid-keystroke would drop the very chip
 * being typed into.
 */
interface TagEdit {
  readonly base: readonly string[];
  readonly index: number;
  readonly text: string;
}

export function FrontmatterForm({
  doc,
  selectTitle,
  onNotify,
  banner,
}: FrontmatterFormProps): ReactElement {
  const docId = doc.frontmatter.id;
  /*
   * An editing surface for SPEC.md §4's close path, exactly as the body editor
   * is: a title write opens a session too, and on a thread or a view — which
   * have no body editor — this form is the *only* surface the document has.
   * Without it, saving a title would look like a document nobody has open and
   * flush the session out from under the reader still showing it.
   */
  useEditSurface(docId);
  const queryClient = useQueryClient();
  /*
   * The boards, for the stage chip's vocabulary (SPEC.md §10, rider 6).
   * `useMaybeBoardSurface` because a reader is legitimately rendered without a
   * board provider in component tests, and a document's frontmatter is not a
   * surface that *needs* one — with no boards there is simply nothing to
   * offer, which is the honest state of a workspace holding no kanban.
   */
  const boardSurface = useMaybeBoardSurface();
  /*
   * The one menu frame the app has (`ContextMenu` under `ContextMenuProvider`):
   * anchored placement, measured room, the escape layer and the roving
   * keyboard all come from it. Defaults to a no-op outside the shell, where a
   * component test renders the strip with no host.
   */
  const menus = useContextMenu();

  const [local, setLocal] = useState<Local>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [tagEdit, setTagEdit] = useState<TagEdit | null>(null);
  const [dueOpen, setDueOpen] = useState(false);

  /*
   * What the timers and the exit flush read, held in refs rather than closed
   * over: an effect registered once and a `setTimeout` armed several keystrokes
   * ago would otherwise write the value the field had when they were created.
   * Same rule, and the same reason, as `useAutosave`.
   */
  const localRef = useRef<Local>(local);
  const docRef = useRef(doc);
  docRef.current = doc;
  const inFlight = useRef(false);
  /** A change arrived while a `PUT` was on the wire; send it when that lands. */
  const queued = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The field values the request in flight carries, so a landing can clear them. */
  const sent = useRef<Local>({});
  const notify = useRef(onNotify);
  notify.current = onNotify;

  // A textarea, not an input: the title wraps (UI-065). The `.title-grow`
  // wrapper in `Reader.css` gives it its height.
  const field = useRef<HTMLTextAreaElement>(null);
  const selected = useRef(false);
  const tagField = useRef<HTMLInputElement>(null);
  const dueField = useRef<HTMLInputElement>(null);

  const clearTimer = useCallback((): void => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  }, []);

  /** The landed request's fields leave the local map; anything newer stays. */
  const clearSettled = useCallback((): void => {
    const carried = sent.current;
    sent.current = {};
    const kept = dropSettled(localRef.current, carried);
    if (Object.keys(kept).length === Object.keys(localRef.current).length) return;
    localRef.current = kept;
    setLocal(kept);
  }, []);

  const send = useRef<() => void>(() => undefined);

  /*
   * The callbacks ride on the **hook**, not on the call (the `SettledCallbacks`
   * seam UI-012 added). A save issued while the reader is unmounting has no
   * observer left to receive a per-call `onSuccess`, so it would commit the
   * write in silence — and the exit flush below is exactly that save. The
   * edit-session bracket rides on them for the same reason: a `beginEditWrite`
   * never answered would hold this document's close flush open indefinitely.
   */
  const update = useUpdateDoc(docId, {
    onSuccess: (response) => {
      inFlight.current = false;
      endEditWrite(docId, true);
      /*
       * Read-your-write, exactly as `DocEditor` publishes a save's response
       * (SPEC.md §7): `useDoc` reads this cache entry, so the controls show what
       * the server stored the instant it stored it. Without it the invalidation
       * behind this leaves a refetch-long gap in which every live control snaps
       * back to the value the person just changed away from.
       */
      queryClient.setQueryData(docQueryKey(docId), response.doc);
      clearSettled();
      /*
       * §11's `stage_status`: this write moved a stage and the board's
       * `kanban.status` map decided a status in the same commit (SPEC.md §5).
       * The caller asked for one field and got two, so the second one is
       * reported here rather than left to be noticed in `git log` — the server's
       * own sentence, which names the board that decided.
       */
      for (const warning of response.warnings) {
        if (warning.code !== "stage_status") continue;
        // The tone and the wording come from the kit's per-code map, not from a
        // literal here: one place decides how §11's channel is shown, so this
        // site and the composers cannot come to word one code two ways (UI-106).
        notify.current(warningNotice(warning));
      }
      setSave({
        kind: "saved",
        remapped: response.anchors.remapped.length,
        orphaned: response.anchors.orphaned.length,
      });
      if (!queued.current) return;
      queued.current = false;
      send.current();
    },
    onError: (error) => {
      inFlight.current = false;
      queued.current = false;
      endEditWrite(docId, false);
      /*
       * Nothing is cleared for a save that merely **failed**: the local map
       * still holds every value the person set, the controls still show them,
       * and the chip's retry re-sends the lot. A form that dropped them would
       * have discarded an edit silently, which is worse than a form that says it
       * could not save one.
       *
       * A field the server **named as not yours to set** is the other case, and
       * it leaves — see {@link dropRefused}. Keeping one is what wedged the
       * form: it rides on every later patch and is refused again, so one bad
       * value made every subsequent save of every field fail (PR #55 re-review,
       * finding 1).
       */
      const kept = dropRefused(localRef.current, statusRefused(error));
      if (kept !== localRef.current) {
        localRef.current = kept;
        setLocal(kept);
      }
      setSave({ kind: "error", message: error.message });
      notify.current({ tone: "error", message: `Save failed — ${error.message}` });
    },
  });
  const mutate = useRef(update.mutate);
  mutate.current = update.mutate;

  /**
   * What a write would carry right now, or `null` when it would carry nothing.
   *
   * It declines for an **abandoned** document for the same reason autosave
   * does: the emptiness that decided the removal is what this would be writing,
   * and it would be a `PUT` racing the `DELETE` behind it. The ordering is
   * load-bearing and not incidental — the abandon decision is taken in the
   * host's *layout*-effect teardown, which runs ahead of this passive one, and
   * on the tab-close route by {@link onPageHide}'s `decide` phase.
   */
  const outgoingWrite = useCallback((): { id: string; changes: UpdateDocRequest } | null => {
    const outgoing = docRef.current;
    const id = outgoing.frontmatter.id;
    if (isAbandoned(id)) return null;
    const changes = changedFields(outgoing, valueOf(outgoing, localRef.current));
    if (Object.keys(changes).length === 0) return null;
    return { id, changes };
  }, []);

  send.current = (): void => {
    clearTimer();
    const write = outgoingWrite();
    if (write === null) return;
    /*
     * Two `PUT`s for one document must never overlap: the second could land
     * first and re-assert a value the first one changed. The change is not
     * dropped — the local map still holds it, and the landing above sends it.
     */
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    sent.current = pickFields(localRef.current, new Set(Object.keys(write.changes)));
    setSave({ kind: "saving" });
    beginEditWrite(write.id);
    mutate.current(write.changes);
  };

  const arm = useCallback((): void => {
    clearTimer();
    debounce.current = setTimeout(() => {
      debounce.current = null;
      send.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearTimer]);

  /**
   * A control changed. The value is remembered and the write is scheduled — or
   * issued, when the change was a deliberate one ({@link isDeliberate}).
   *
   * A deliberate change sends **everything outstanding**, not only its own
   * field: the request is one patch either way, and holding a half-typed tag
   * back would mean a second write a moment later for a sitting §4 is going to
   * squash into one commit regardless.
   */
  const patch = useCallback(
    (name: FieldName, value: string): void => {
      localRef.current = withField(localRef.current, name, value);
      setLocal(localRef.current);
      if (isDeliberate(name, value)) send.current();
      else arm();
    },
    [arm],
  );

  const retry = useCallback((): void => {
    send.current();
  }, []);

  /**
   * The title the abandon rule should judge: the one that is about to be
   * written, not the one on disk.
   *
   * It is safe to publish an *uncommitted* value here only because the exit
   * flush below guarantees it is committed on every route the abandon rule
   * treats as an exit — otherwise this would keep a document alive on a value
   * that gets dropped.
   */
  useEffect(() => {
    publishTitleDraft(docId, local.title ?? null);
  }, [docId, local.title]);

  useEffect(() => {
    if (!selectTitle || selected.current) return;
    selected.current = true;
    field.current?.focus();
    // Selected, not merely focused: SPEC.md §10 says "ready to type", and a
    // caret after "Untitled" is not that.
    field.current?.select();
  }, [selectTitle]);

  /**
   * Send what is outstanding now — the document is being left, inside a living
   * page.
   *
   * It does not defer to a request already in flight, and that is the one place
   * this form sends a second one: the flush's patch is computed against the same
   * document the in-flight one was, so it carries everything that write carries
   * plus whatever was typed after it left. Deferring would mean waiting for a
   * response on a surface that is being torn down, which is the same as dropping
   * the edit.
   */
  const flush = useCallback((): void => {
    clearTimer();
    const write = outgoingWrite();
    if (write === null) return;
    beginEditWrite(write.id);
    mutate.current(write.changes);
  }, [clearTimer, outgoingWrite]);

  /**
   * The same flush, on the one exit the ordinary client does not survive
   * (PR #12 review, MINOR 13).
   *
   * A `PUT` issued from `pagehide` on the ordinary client is racing the
   * browser's own teardown and is routinely cancelled — which would make
   * closing the tab the one exit route that silently threw away a typed title,
   * the very loss this flush exists to prevent (UI-017 eval FAIL-1). It goes
   * out through {@link unloadClient} for the same reason the abandon `DELETE`
   * does: `keepalive: true` lets the request outlive the document that issued
   * it. Nothing is reported — the chip is going away with the page — and the
   * refusal is swallowed rather than left as an unhandled rejection.
   */
  const flushOnUnload = useCallback((): void => {
    const write = outgoingWrite();
    if (write === null) return;
    void unloadClient()
      .updateDoc(write.id, write.changes)
      .catch(() => undefined);
  }, [outgoingWrite]);

  useEffect(() => onPageHide("flush", flushOnUnload), [flushOnUnload]);

  // Unmount, and — because `DocView` keys this form by document id — a reader
  // rebinding to another document. Both are "the user left"; both must save.
  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );

  /*
   * The input that replaces a chip takes the caret the moment it exists. A
   * layout effect, so it runs after the menu frame's own unmount cleanup has
   * returned focus to the (now unmounted) chip — last write wins, and it is
   * this one.
   */
  const tagEditing = tagEdit !== null;
  useLayoutEffect(() => {
    if (!tagEditing) return;
    tagField.current?.focus();
    tagField.current?.select();
  }, [tagEditing]);

  useLayoutEffect(() => {
    if (!dueOpen) return;
    const input = dueField.current;
    input?.focus();
    try {
      // The native picker, where the browser supports asking for it — placed by
      // the browser itself, so there is no placement here to get wrong. The
      // click that opened this chip is still the active gesture, because React
      // flushes discrete events synchronously.
      input?.showPicker?.();
    } catch {
      // Outside a user gesture (or jsdom): the input itself is still a date
      // field, focused and typeable, with its own picker control.
    }
  }, [dueOpen]);

  const value = valueOf(doc, local);
  const statusReason = statusLock(doc.frontmatter);
  const folder = folderOf(doc.path);
  /*
   * Which kanbans claim this document, and therefore which words its `stage`
   * may take. A workspace with no kanban over `stage` offers none, and the
   * chip's menu is absent rather than empty — there is no vocabulary to pick
   * from and a menu with nothing in it would be a control that cannot be used.
   */
  const stageGroups = stageChoicesFor(boardSurface?.boards ?? [], {
    frontmatter: doc.frontmatter,
    folder,
  });
  const stages = offeredStages(stageGroups, doc.frontmatter.stage);

  /** The tags as the strip shows them: the edit's own base while one is up. */
  const tagList = tagEdit === null ? normalizedTags(textToTags(value.tags)) : tagEdit.base;

  /**
   * Opens the app's one menu frame at this chip: anchored to the chip's own
   * box, clamped to the viewport, ceiling derived from the measured room
   * (`menuModel.ts`). `detail === 0` is a keyboard activation — `↵`/Space on
   * the chip — and moves focus to the first item, exactly as ⇧F10 does.
   */
  const chipMenu = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      label: string,
      items: (close: () => void) => ReactNode,
    ): void => {
      const rect = event.currentTarget.getBoundingClientRect();
      menus.open({
        label,
        clientX: Math.round(rect.left),
        clientY: Math.round(rect.bottom) + 4,
        autoFocus: event.detail === 0,
        items,
      });
    },
    [menus],
  );

  /** A menu's Remove: one chosen value, so it sends at once ({@link isDeliberate}). */
  const removeTag = useCallback(
    (base: readonly string[], index: number): void => {
      patch("tags", tagsToText(base.filter((_, at) => at !== index)));
      send.current();
    },
    [patch],
  );

  const startTagEdit = useCallback((base: readonly string[], index: number, text: string): void => {
    setTagEdit({ base, index, text });
  }, []);

  const tagInput = (edit: TagEdit): ReactElement => (
    <input
      key="tag-edit"
      ref={tagField}
      className="chip fm-chip-input"
      aria-label={
        edit.index === edit.base.length ? "New tag" : `Rename tag ${edit.base[edit.index] ?? ""}`
      }
      value={edit.text}
      onChange={(event) => {
        const text = event.target.value;
        setTagEdit({ ...edit, text });
        const next = [...edit.base];
        next.splice(edit.index, 1, text);
        // Typed, so it debounces — and the written value is normalized, which
        // is what collapses a rename onto an existing tag and turns a rename
        // to empty into the removal it is.
        patch("tags", tagsToText(normalizedTags(next)));
      }}
      onBlur={() => {
        setTagEdit(null);
      }}
      onKeyDown={(event) => {
        leaveOnEscape(event);
        if (event.key !== "Enter") return;
        event.preventDefault();
        send.current();
        setTagEdit(null);
      }}
    />
  );

  return (
    <>
      {/*
       * The strip is the frontmatter editor (SPEC.md §10, rider signed
       * 2026-08-23). Every value an editable chip shows comes from
       * `valueOf(doc, local)` — the document overlaid with what the person just
       * set — so an optimistic value shows while `saving…` is on the chip at
       * the end, and the chip menus mark the same value the strip displays.
       */}
      <div className="fm-chips" role="group" aria-label="Frontmatter">
        <span className="chip">{doc.frontmatter.type}</span>
        {folder === "" ? null : <span className="chip">{folder}</span>}

        {tagList.map((tag, index) =>
          tagEdit !== null && tagEdit.index === index ? (
            tagInput(tagEdit)
          ) : (
            <button
              key={`${String(index)}:${tag}`}
              type="button"
              className="chip fm-chip"
              data-chip="tag"
              data-tag={tag}
              aria-haspopup="menu"
              onClick={(event) => {
                const base = tagList;
                chipMenu(event, `Tag #${tag}`, (close) => (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="ac-item"
                      data-act="rename-tag"
                      onClick={() => {
                        close();
                        startTagEdit(base, index, tag);
                      }}
                    >
                      Rename
                      <span className="d">edits the tag in place</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="ac-item"
                      data-act="remove-tag"
                      onClick={() => {
                        close();
                        removeTag(base, index);
                      }}
                    >
                      Remove
                      <span className="d">takes #{tag} off this document</span>
                    </button>
                  </>
                ));
              }}
            >
              #{tag}
            </button>
          ),
        )}
        {/* At the end of the tags, not at the end of the strip: it stays beside
            what it adds to, however far the strip wraps. */}
        {tagEdit !== null && tagEdit.index === tagList.length ? (
          tagInput(tagEdit)
        ) : (
          <button
            type="button"
            className="chip fm-chip fm-chip-add"
            data-chip="add-tag"
            aria-label="Add a tag"
            title="Add a tag"
            onClick={() => {
              startTagEdit(tagList, tagList.length, "");
            }}
          >
            +
          </button>
        )}

        <button
          type="button"
          className="chip on fm-chip"
          data-chip="status"
          aria-haspopup="menu"
          onClick={(event) => {
            const current = value.status;
            chipMenu(event, "Set status", (close) => (
              <>
                {/* §10: the chip "says why when a document's status is not the
                    reader's to set" — the reason is `statusLock`'s own sentence,
                    not one invented here. */}
                {statusReason === null ? null : (
                  <div className="ac-item ac-item-note fm-menu-note" role="note">
                    {statusReason}
                  </div>
                )}
                {DOC_STATUSES.map((word) => {
                  const isCurrent = word === current;
                  /*
                   * §5's whole vocabulary is offered; what is *writable* from
                   * here is narrower. A locked document writes nothing at all,
                   * and `archived` is a route rather than a status flip
                   * (UI-020), so choosing it is gated with the why beneath it.
                   */
                  const gated = statusReason !== null || word === ARCHIVED;
                  return (
                    <button
                      key={word}
                      type="button"
                      role="menuitem"
                      className="ac-item"
                      data-act={`status:${word}`}
                      data-current={isCurrent ? "" : undefined}
                      disabled={gated}
                      onClick={() => {
                        close();
                        if (gated) return;
                        patch("status", word);
                      }}
                    >
                      {isCurrent ? `✓ ${word}` : word}
                      {word === ARCHIVED && statusReason === null ? (
                        <span className="d">{ARCHIVE_ROUTE_REASON}</span>
                      ) : null}
                    </button>
                  );
                })}
              </>
            ));
          }}
        >
          status: {value.status}
        </button>

        {/* A stage is shown when there is one, or when a board offers words for
            it — a document no kanban claims and that holds none says nothing
            about a field it does not use (`offeredStages` includes the held
            value, so a chip that shows is always a control: at minimum Clear
            plus the value it is looking at). */}
        {value.stage === "" && stages.length === 0 ? null : (
          <button
            type="button"
            className={value.stage === "" ? "chip fm-chip" : "chip on fm-chip"}
            data-chip="stage"
            aria-haspopup="menu"
            onClick={(event) => {
              const current = value.stage;
              const orphanStage =
                current !== "" && stageGroups.every((group) => !group.stages.includes(current))
                  ? current
                  : null;
              chipMenu(event, "Set stage", (close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="ac-item"
                    data-act="stage:clear"
                    data-current={current === "" ? "" : undefined}
                    onClick={() => {
                      close();
                      patch("stage", CLEAR_STAGE);
                    }}
                  >
                    {current === "" ? "✓ Clear the stage" : "Clear the stage"}
                    <span className="d">
                      a kanban'd document is written `open` in the same commit
                    </span>
                  </button>
                  {stageGroups.map((group) => (
                    <Fragment key={group.boardId}>
                      {/* The words are the boards': two kanbans over one
                          document share one `stage` value and two
                          vocabularies (stageChoices.ts). */}
                      <div className="ac-item ac-item-note fm-menu-group">{group.boardTitle}</div>
                      {group.stages.map((stage) => (
                        <button
                          key={`${group.boardId}:${stage}`}
                          type="button"
                          role="menuitem"
                          className="ac-item"
                          data-act={`stage:${stage}`}
                          data-current={stage === current ? "" : undefined}
                          onClick={() => {
                            close();
                            patch("stage", stage);
                          }}
                        >
                          {stage === current ? `✓ ${stage}` : stage}
                        </button>
                      ))}
                    </Fragment>
                  ))}
                  {/* A stage the document carries that no board draws: shown so
                      the menu marks the value it is looking at, rather than
                      marking nothing over a document that has one. */}
                  {orphanStage === null ? null : (
                    <button
                      type="button"
                      role="menuitem"
                      className="ac-item"
                      data-act={`stage:${orphanStage}`}
                      data-current=""
                      onClick={close}
                    >
                      {`✓ ${orphanStage}`}
                      <span className="d">no board draws this</span>
                    </button>
                  )}
                </>
              ));
            }}
          >
            stage: {value.stage === "" ? "none" : value.stage}
          </button>
        )}

        {/* The due chip swaps for the field itself: the date picker is the
            browser's own, placed by the browser, and clearing the field is
            clearing the date ({@link isDeliberate} holds the empty value for
            the debounce, which is also what lets a typed date finish arriving).
            With no due date it reads as an unset chip rather than disappearing,
            so the field is reachable. */}
        {dueOpen ? (
          <input
            ref={dueField}
            className="chip fm-chip-input"
            type="date"
            aria-label="Due date"
            value={value.due}
            onChange={(event) => {
              patch("due", event.target.value);
            }}
            onBlur={() => {
              setDueOpen(false);
            }}
            onKeyDown={(event) => {
              leaveOnEscape(event);
              if (event.key !== "Enter") return;
              event.preventDefault();
              send.current();
              setDueOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={value.due === "" ? "chip ghost fm-chip" : "chip on fm-chip"}
            data-chip="due"
            onClick={() => {
              setDueOpen(true);
            }}
          >
            {value.due === "" ? "due: —" : `due: ${value.due}`}
          </button>
        )}

        {doc.frontmatter.updated === null ? null : (
          <span className="chip">updated {doc.frontmatter.updated.slice(0, 10)}</span>
        )}
        {/*
         * Where the `edit` chip used to be, and it costs the layout nothing that
         * the chip it replaced did not: one always-present item, of one reserved
         * width, at the end of a strip that was already there. It is pointedly
         * **not** in the reader head — that row is at its limit (UI-135), and a
         * body save landing there must never be able to overwrite the report
         * that a frontmatter save failed.
         */}
        <SaveChipView
          state={save}
          onRetry={save.kind === "error" ? retry : null}
          surface="frontmatter"
        />
      </div>

      {banner}

      {/*
       * The wrapper is what makes the title wrap (UI-065): a hidden copy of the
       * value stacked in the same grid cell, so the row is as tall as the text
       * and the field stretches to it — the browser laying out the same string
       * in the same font.
       *
       * It replaced a `scrollHeight` measurement, which worked and cost too
       * much: writing `height: auto` to measure, then writing the result back,
       * momentarily shortened the document and made the reader's scroll
       * container clamp `scrollTop` to 0. Five reveal specs caught it — an
       * item revealed by a click stopped being scrolled into view. Measuring
       * by layout instead of by mutation cannot do that.
       */}
      <div className="title-grow" data-replicated-value={value.title}>
        <textarea
          ref={field}
          className="doc-title"
          aria-label="Document title"
          // The field grows by wrapping, never by the user adding rows: `↵`
          // sends what is outstanding (below), so no newline can reach the
          // value and one row is always the floor.
          rows={1}
          value={value.title}
          onChange={(event) => {
            patch("title", event.target.value);
          }}
          onKeyDown={(event) => {
            leaveOnEscape(event);
            if (event.key !== "Enter") return;
            /*
             * Not a save button in disguise: the title saves itself either way,
             * and this only says "now" instead of "in 700 ms".
             */
            event.preventDefault();
            send.current();
          }}
        />
      </div>
    </>
  );
}
