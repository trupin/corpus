import { DOC_STATUSES, type Doc, type DocStatus, type UpdateDocRequest } from "@corpus/contract";
import {
  CorpusRequestError,
  docKey as docQueryKey,
  folderOf,
  useUpdateDoc,
  type RowNotice,
} from "@corpus/kit";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { onPageHide } from "../abandon/pagehide";
import { isAbandoned, publishTitleDraft } from "../abandon/registry";
import { unloadClient } from "../abandon/unloadClient";
import {
  DERIVED_FIELDS,
  NO_FIELD_LOCKS,
  useFieldLocks,
  type DerivedField,
  type FieldLock,
  type FieldLocks,
} from "../doc/fieldLock";
import { beginEditWrite, endEditWrite, useEditSurface } from "../editor/editSessionFlush";
import { SaveChipView } from "../editor/SaveChip";
import { AUTOSAVE_DEBOUNCE_MS, type SaveState } from "../editor/useAutosave";

/**
 * Frontmatter as the small form SPEC.md §10 asks for — title, tags, status,
 * due — over the prototype's `.fm-chips` strip.
 *
 * **Under the body's rule, not beside it: no edit mode, no save button**
 * (SHARED-030, signed 2026-08-12). The controls are live wherever the document
 * is shown, and a change commits where it is made. There was an `edit` chip, a
 * draft and a Save button here until UI-093, which meant changing a status cost
 * three clicks on a surface whose neighbouring body accepts a keystroke.
 *
 * **One patch, one write.** Every control writes into one *local* map of the
 * fields the person has touched; the request carries only what differs from the
 * document, and only one request is ever on the wire. That is not a nicety: the
 * server compares untouched keys structurally and leaves their bytes alone
 * (SERVER-001), and four controls each firing their own `PUT` would defeat that
 * guarantee from the client side and race each other besides.
 *
 * **When a change is sent** is the one thing this form decides, and it decides
 * it per *change*, not per control — see {@link isDeliberate}. Nothing here
 * chooses a cadence: the debounce is `AUTOSAVE_DEBOUNCE_MS`, imported from the
 * body's autosave, because §10 says frontmatter is "debounced exactly as the
 * body's autosave is" and a second constant is how two rules that agree on the
 * day they were written stop agreeing.
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
  readonly due: string;
}

type FieldName = keyof Draft;

const FIELD_NAMES: readonly FieldName[] = ["title", "tags", "status", "due"];

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

function draftOf(doc: Doc): Draft {
  const { frontmatter } = doc;
  return {
    title: frontmatter.title,
    tags: tagsToText(frontmatter.tags),
    status: frontmatter.status,
    due: frontmatter.due ?? "",
  };
}

/** SPEC.md §7's reversible act, which this form is deliberately not a door to. */
const ARCHIVED: DocStatus = "archived";

/** The statuses this form may write; archiving is a route, not a status flip. */
export const EDITABLE_STATUSES: readonly DocStatus[] = DOC_STATUSES.filter(
  (status) => status !== ARCHIVED,
);

/**
 * A field the person may **see but not set**, and the sentence that says why.
 *
 * SHARED-030: *"A field whose value is derived rather than authored… shows the
 * value and says where it comes from, and is editable by nobody — that is not an
 * edit mode, it is a field that was never the person's to set."* So a control
 * has three states here, not two: absent, live, or shown-with-a-reason.
 *
 * Both the shape and the predicate moved to `doc/fieldLock.ts` in UI-094: the
 * row context menu asks the same question of a subject that is **not** a `Doc`,
 * and the only two honest ways to serve both callers were one predicate over the
 * fields they share or two predicates that would eventually disagree. This form
 * reads the answer through `useFormStatusLock` and decides nothing itself —
 * that hook is the shared predicate plus one narrowing question this form is
 * able to ask because it holds the whole `Doc`.
 *
 * **The third state is a statement rather than a switched-off control**
 * (UI-092). A `derived` lock replaces the `<select>` with the value in words:
 * §12 says the control "shows the derived value and says it comes from the
 * items", and a disabled dropdown says something else — that there is an act
 * here, currently unavailable. There is no act here. An `archived` lock keeps
 * the control, because there *is* one and it lives on another route (UI-020).
 *
 * **`due` asks the same question of the same module** (`useFormDueLock`,
 * PLUGINS-018 / SERVER-134), and draws the answer the same way. It has to: the
 * server converges a derived `due` on every write it makes, so the live date
 * control this form shipped in UI-093 offered a change the write path undid in
 * the same request — pick a date, `200`, and the control snaps back to the
 * derived value with nothing said. UI-092's own summary warned against exactly
 * that, "offering a change the write path would immediately undo".
 */

/** The options a select must offer: the editable set, plus its own value. */
function statusOptions(current: DocStatus): readonly DocStatus[] {
  return EDITABLE_STATUSES.includes(current) ? EDITABLE_STATUSES : DOC_STATUSES;
}

/**
 * Whether this change is a **deliberate commit moment** — send it now — or one
 * keystroke in a run of them, which waits out the debounce.
 *
 * The question is asked of the *change*, not of the control, and that is the
 * whole of the distinction. A `<select>` produces one chosen value per gesture
 * and nothing in between, so it always commits. A free-text field produces a
 * value per keystroke and never commits on one.
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
  if (field === "status") return true;
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
 * rather than only on the `<select>` because the select is not the only path to
 * the wire: leaving the document, rebinding the reader and `pagehide` all flush
 * through this function, and guarding the control alone would ship a refusal the
 * user could not connect to anything they did.
 *
 * **No locked field ever leaves here**, and `locks` is that guard — the same
 * rule for the same reason, one field over and then every field at once. The
 * control is not rendered while a lock is on, so this only ever fires for a
 * value set **before** the lock engaged — a status picked or a date typed in the
 * window before plugin discovery settles — which is exactly the case a
 * control-side guard cannot see.
 *
 * **Why it is a list and not a parameter per field** (PR #55 re-review, finding
 * 1). This shipped as `dueLocked`, a boolean covering `due` alone, and the same
 * race on `status` went unguarded — where it is worse, because the write path
 * answers a derived `status` with a `400` rather than converging it silently, and
 * a refused value left in the local map is then carried by every later save. Two
 * ad-hoc booleans would have been the same gap waiting on a third field. So the
 * filter runs over {@link DERIVED_FIELDS} and a field added there is guarded
 * without anybody remembering to guard it.
 *
 * The archive-boundary guard on `status` stays where it is and is **not** this
 * rule. It refuses a value in *both* directions across `archived` (UI-020,
 * SERVER-039), which no lock expresses: `archived` is a place a document is kept,
 * and the routes that move it are not this one.
 */
export function changedFields(
  doc: Doc,
  draft: Draft,
  locks: FieldLocks = NO_FIELD_LOCKS,
): UpdateDocRequest {
  const current = draftOf(doc);
  const changes: UpdateDocRequest = {};
  const title = draft.title.trim();
  if (title !== "" && title !== current.title) changes.title = title;
  if (draft.tags.trim() !== current.tags) changes.tags = textToTags(draft.tags);
  if (draft.status !== current.status && draft.status !== ARCHIVED && current.status !== ARCHIVED) {
    changes.status = draft.status;
  }
  if (draft.due !== current.due) changes.due = draft.due === "" ? null : draft.due;
  return withoutLocked(changes, locks);
}

/**
 * The one gate: whatever the form would have sent, minus every field a lock says
 * is nobody's to set.
 *
 * Written as a loop over {@link DERIVED_FIELDS} rather than as a condition per
 * field so that the set of guarded fields is the *list* and not this function's
 * memory of it.
 */
function withoutLocked(changes: UpdateDocRequest, locks: FieldLocks): UpdateDocRequest {
  const kept: { -readonly [K in keyof UpdateDocRequest]: UpdateDocRequest[K] } = { ...changes };
  for (const field of DERIVED_FIELDS) {
    if (locks[field] !== null) delete kept[field];
  }
  return kept;
}

/** Whether a form field is one a doc type may take away — see {@link DERIVED_FIELDS}. */
function isDerivedField(name: FieldName): name is DerivedField {
  return DERIVED_FIELDS.some((field) => field === name);
}

/**
 * The **derived fields a refusal named**, read off the contract's own error
 * shape rather than out of its prose.
 *
 * `assertDerivedFieldsNotSet` (SERVER-085) answers a `400 bad_request` whose
 * `issues` carry `path: "body.status"` — the field, structured, said by the only
 * party that knows. That is what makes this precise enough to act on: a `500`,
 * a dropped connection or any other failure names nothing, so nothing is
 * dropped and a save that merely failed still holds everything the person typed.
 *
 * Restricted to {@link DERIVED_FIELDS} on purpose. A refusal naming `title` says
 * the value was malformed, not that the field is nobody's, and the person's own
 * text is the last thing this form may throw away.
 */
function refusedFields(error: Error): readonly DerivedField[] {
  if (!(error instanceof CorpusRequestError)) return [];
  return DERIVED_FIELDS.filter((field) =>
    error.issues.some((issue) => issue.path === `body.${field}`),
  );
}

/**
 * The local map, with the fields a refusal named removed.
 *
 * A refusal is the one place the server tells this form a field was never the
 * person's to set, and a value that cannot be written is not an unsaved edit —
 * it is a value that will ride on every later patch and be refused again, which
 * is precisely the wedge PR #55's re-review measured: a `400` on `status`, then
 * a title that could not be saved until the page was reloaded.
 *
 * Returns the map it was given when nothing was named, so the ordinary failure
 * path re-renders nothing at all.
 */
function dropRefused(local: Local, refused: readonly DerivedField[]): Local {
  if (refused.length === 0) return local;
  let kept: Local = {};
  for (const name of FIELD_NAMES) {
    const value = local[name];
    if (value === undefined) continue;
    if (isDerivedField(name) && refused.includes(name)) continue;
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
 * list on the way in rather than asserted: a `<select>` is a boundary like any
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

interface FieldProps {
  readonly label: string;
  /** Non-null when the value is shown but not settable — the reason is rendered. */
  readonly lock: FieldLock | null;
  /** What the field says when it is live and has something to say. */
  readonly hint?: string;
  readonly children: ReactNode;
}

/**
 * One labelled control, with the one line beneath it that says where its act
 * lives when it is not this control (UI-020) or why it is nobody's to set.
 *
 * The note comes from the lock when there is one, so a field never has to carry
 * two explanations that could disagree.
 */
function Field({ label, lock, hint, children }: FieldProps): ReactElement {
  const note = lock?.reason ?? hint;
  return (
    // `data-field` names the cell for anything addressing one from outside the
    // form — the e2e suite, which since two fields can be statements can no
    // longer say "the statement" and mean one thing. The label text is the
    // field's identity here already, so this introduces no second name for it.
    <label className="fm-field" data-field={label}>
      <span>{label}</span>
      {children}
      {note === undefined ? null : <span className="fm-hint">{note}</span>}
    </label>
  );
}

/**
 * A **derived** status: the value, stated, where the control would have been.
 *
 * SPEC.md §12 (rider signed 2026-08-12) asks for a status control that "shows
 * the derived value and says it comes from the items", and §10 (SHARED-030) for
 * a field that "shows the value and says where it comes from, and is editable by
 * nobody". A disabled `<select>` gets the first half right and the second half
 * wrong: it is the shape of an act, and every disabled act in this app is one a
 * person could arm by doing something. Nothing arms this one, so there is no
 * control here — only a reading of the document, with {@link Field}'s note
 * beneath it saying where the reading came from.
 *
 * **`<output>`, not a `<span>`.** It is the element for a value the application
 * computed, it is labelable — so the field's `status` label still names it — and
 * its implicit `role="status"` means a value that flips under a reader (checking
 * the last item) is announced rather than silently swapped.
 *
 * **The value is the server's** (SERVER-085), never re-derived here: two
 * derivations are two chances to disagree, and where the server sends something
 * this UI's copy of the plugin would not have derived, what the server sent is
 * what the file says.
 *
 * It is `doc.frontmatter.status` and pointedly **not** the local overlay, which
 * is the same sentence read strictly (PR #55 re-review, finding 1). The overlay
 * can hold a value the person picked in the window before the lock engaged and
 * the server then refused — and a statement rendering that would print a status
 * the file does not have, under a note claiming the value came from the
 * document. Measured: `resolved` stated over a file reading `open`.
 *
 * SHARED-057: the box is the grid cell's, not the value's, so `open` and
 * `resolved` occupy identical space and nothing on the form moves when one
 * becomes the other. That is `.fm-statement`'s whole job.
 */
function StatusStatement({ status }: { readonly status: DocStatus }): ReactElement {
  return <output className="fm-statement">{status}</output>;
}

/**
 * What a locked, empty `due` says. It is a **reading of the document**, not a
 * placeholder: `DerivedDocDue`'s middle answer (`{due: null}`) means the
 * derivation applies and this document has no deadline, which is a fact the
 * person is being told rather than a blank waiting to be filled.
 *
 * A `—` or an empty box would say the other thing, and on this control the other
 * thing is false.
 */
const NO_DEADLINE = "no deadline";

/**
 * A **derived** `due`: {@link StatusStatement}'s element, one field over, for the
 * reasons that comment gives — an `<output>` because the application computed the
 * value, labelable so the `due` label still names it, and `role="status"` so a
 * deadline that changes under a screen reader is announced.
 *
 * **The value is the server's**, exactly as the status statement's is (SERVER-134
 * writes the derived `due` into the frontmatter on every write). Nothing here
 * re-derives it, and nothing here composes anything: `DerivedDocDue`'s three
 * answers are a trap for a surface that combines a derived value with a stored
 * one, and this surface never holds both. It is read from `doc.frontmatter.due`
 * and never from the local overlay, for the reason {@link StatusStatement}
 * gives.
 *
 * SHARED-057 / SHARED-061: the box is the grid cell's (`.fm-statement` is
 * `width: 100%`), so a date **appearing and disappearing** — which is what
 * checking the last dated item does — moves nothing on the form. `no deadline`
 * is a good deal wider than `2026-08-04`, which is precisely why the width may
 * not follow the text.
 */
function DueStatement({ due }: { readonly due: string }): ReactElement {
  return <output className="fm-statement">{due === "" ? NO_DEADLINE : due}</output>;
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

  const [local, setLocal] = useState<Local>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  /*
   * What the timers and the exit flush read, held in refs rather than closed
   * over: an effect registered once and a `setTimeout` armed several keystrokes
   * ago would otherwise write the value the field had when they were created.
   * Same rule, and the same reason, as `useAutosave`.
   */
  const localRef = useRef<Local>(local);
  const docRef = useRef(doc);
  docRef.current = doc;
  /**
   * Every derived field's lock as of the last render, for {@link changedFields}'
   * guard.
   *
   * A ref rather than a dependency because every write path here reads its inputs
   * from refs, for the reason stated above: a flush armed several keystrokes ago
   * must send what the form holds *now*. It is assigned where the locks are read,
   * further down — every caller runs after a render has completed.
   */
  const locksRef = useRef<FieldLocks>(NO_FIELD_LOCKS);
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
      const kept = dropRefused(localRef.current, refusedFields(error));
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
    const changes = changedFields(outgoing, valueOf(outgoing, localRef.current), locksRef.current);
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

  const value = valueOf(doc, local);
  const stored = draftOf(doc);
  const locks = useFieldLocks(doc);
  locksRef.current = locks;
  const folder = folderOf(doc.path);

  return (
    <>
      {/*
       * The strip is the document **as the corpus holds it** — the mockup's own
       * `.fm-chips`, unchanged — and the controls below are what you are
       * setting. The two agree except while a save is on the wire, which is
       * exactly when the chip at the end of the strip says `saving…`.
       */}
      <div className="fm-chips">
        <span className="chip">{doc.frontmatter.type}</span>
        {folder === "" ? null : <span className="chip">{folder}</span>}
        {doc.frontmatter.tags.map((tag) => (
          <span className="chip" key={tag}>
            #{tag}
          </span>
        ))}
        <span className="chip on">{doc.frontmatter.status}</span>
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

      <div className="fm-form" aria-label="Frontmatter">
        <Field label="tags" lock={null}>
          <input
            className="fm-input"
            value={value.tags}
            placeholder="comma, separated"
            onKeyDown={leaveOnEscape}
            onChange={(event) => {
              patch("tags", event.target.value);
            }}
          />
        </Field>
        <Field
          label="status"
          lock={locks.status}
          hint="archive from the ⋯ menu — a status flip would not move a skill’s folder"
        >
          {locks.status?.kind === "derived" ? (
            <StatusStatement status={stored.status} />
          ) : (
            <select
              className="fm-input"
              value={value.status}
              disabled={locks.status !== null}
              onKeyDown={leaveOnEscape}
              onChange={(event) => {
                patch("status", event.target.value);
              }}
            >
              {statusOptions(value.status).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="due" lock={locks.due}>
          {/*
           * The `status` field's shape, deliberately unchanged — a `derived`
           * lock is a statement, anything else is the control. `dueLock` returns
           * only `derived` locks (there is no act on `due` on any route, so
           * there is nothing for an `archived` lock to point at), so the second
           * branch is the live control today. It is written this way rather than
           * as `locks.due === null` so that the two fields answer a lock by its
           * `kind` and not by which field it came from.
           */}
          {locks.due?.kind === "derived" ? (
            <DueStatement due={stored.due} />
          ) : (
            <input
              className="fm-input"
              type="date"
              value={value.due}
              disabled={locks.due !== null}
              onKeyDown={leaveOnEscape}
              onChange={(event) => {
                patch("due", event.target.value);
              }}
            />
          )}
        </Field>
      </div>
    </>
  );
}
