import { DOC_STATUSES, type Doc, type DocStatus, type UpdateDocRequest } from "@corpus/contract";
import { folderOf, useUpdateDoc, type RowNotice } from "@corpus/kit";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { onPageHide } from "../abandon/pagehide";
import { isAbandoned, publishTitleDraft } from "../abandon/registry";
import { unloadClient } from "../abandon/unloadClient";
import { beginEditWrite, endEditWrite, useEditSurface } from "../editor/editSessionFlush";

/**
 * Frontmatter as the small form SPEC.md §11 asks for — title, tags, status,
 * due — over the prototype's `.fm-chips` strip.
 *
 * **One draft, one write.** The title is a field styled as the document's `h1`
 * (the prototype edits it in place), and it belongs to the *same* draft as the
 * three fields below it, so editing all four and saving issues one `PUT`
 * carrying only the keys that actually changed. That is not a nicety: the server
 * compares untouched keys structurally and leaves their bytes alone (SERVER-001),
 * and a form that re-sent every field would defeat that guarantee from the
 * client side.
 *
 * The body is **not** here. UI-006 brings the always-editable document with its
 * own autosave; this form deliberately stops at frontmatter so there is one
 * writer per concern.
 *
 * **The draft outlives no surface.** Enter and Save are not the only ways a
 * frontmatter edit reaches the corpus: leaving the document flushes it, on the
 * same seams the abandon rule (SPEC.md §11) watches — the reader unmounting or
 * rebinding, and `pagehide`. Without that, a user who typed a title and left
 * (which is the gesture §11 describes as primary — "title selected, ready to
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
 * through this function, and guarding the button alone would ship a refusal the
 * user could not connect to anything they did.
 */
export function changedFields(doc: Doc, draft: Draft): UpdateDocRequest {
  const current = draftOf(doc);
  const changes: UpdateDocRequest = {};
  const title = draft.title.trim();
  if (title !== "" && title !== current.title) changes.title = title;
  if (draft.tags.trim() !== current.tags) changes.tags = textToTags(draft.tags);
  if (draft.status !== current.status && draft.status !== ARCHIVED && current.status !== ARCHIVED) {
    changes.status = draft.status;
  }
  if (draft.due !== current.due) changes.due = draft.due === "" ? null : draft.due;
  return changes;
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
  /*
   * The callbacks ride on the **hook**, not on the call (the `SettledCallbacks`
   * seam UI-012 added). A save issued while the reader is unmounting has no
   * observer left to receive a per-call `onSuccess`, so it would commit the
   * write in silence — and the exit flush below is exactly that save.
   */
  /*
   * The edit-session bracket rides on these — the **hook**-level callbacks —
   * for the same reason the toast does: the write that most needs releasing it
   * is the one issued from the unmount cleanup below, and a per-call callback
   * is skipped once the observer is gone. A `beginEditWrite` never answered
   * would hold this document's close flush open indefinitely.
   */
  const update = useUpdateDoc(docId, {
    onSuccess: (_response, saved) => {
      endEditWrite(docId, true);
      setDraft(null);
      onNotify({
        tone: "info",
        message: `Saved — ${Object.keys(saved).join(", ")} updated and committed.`,
      });
    },
    onError: (error) => {
      endEditWrite(docId, false);
      onNotify({ tone: "error", message: `Save failed — ${error.message}` });
    },
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  // A textarea, not an input: the title wraps (UI-065). The `.title-grow`
  // wrapper in `Reader.css` gives it its height.
  const field = useRef<HTMLTextAreaElement>(null);
  const selected = useRef(false);

  const current = draftOf(doc);
  const value = draft ?? current;
  const changes = draft === null ? {} : changedFields(doc, draft);
  const isDirty = Object.keys(changes).length > 0;

  /**
   * The title the abandon rule should judge: the one that is about to be
   * written, not the one on disk.
   *
   * It is safe to publish an *uncommitted* draft here only because the exit
   * flush below guarantees it is committed on every route the abandon rule
   * treats as an exit — otherwise this would keep a document alive on a value
   * that gets dropped.
   */
  useEffect(() => {
    publishTitleDraft(docId, draft?.title ?? null);
  }, [docId, draft]);

  useEffect(() => {
    if (!selectTitle || selected.current) return;
    selected.current = true;
    field.current?.focus();
    // Selected, not merely focused: SPEC.md §11 says "ready to type", and a
    // caret after "Untitled" is not that.
    field.current?.select();
  }, [selectTitle]);

  const save = (): void => {
    if (!isDirty) return;
    beginEditWrite(docId);
    update.mutate(changes);
  };

  /*
   * What the flush needs, read at flush time rather than closed over: the
   * effect below is registered once, and a handler holding the first render's
   * draft would write an empty title over a typed one.
   */
  const pending = useRef({ doc, draft });
  pending.current = { doc, draft };
  const mutate = useRef(update.mutate);
  mutate.current = update.mutate;

  /**
   * What leaving the document would write, or `null` when it would write
   * nothing.
   *
   * It declines for an **abandoned** document for the same reason autosave
   * does: the emptiness that decided the removal is what this would be writing,
   * and it would be a `PUT` racing the `DELETE` behind it. The ordering is
   * load-bearing and not incidental — the abandon decision is taken in the
   * host's *layout*-effect teardown, which runs ahead of this passive one, and
   * on the tab-close route by {@link onPageHide}'s `decide` phase.
   */
  const outgoingWrite = useCallback((): { id: string; changes: UpdateDocRequest } | null => {
    const { doc: outgoing, draft: unsaved } = pending.current;
    if (unsaved === null) return null;
    const id = outgoing.frontmatter.id;
    if (isAbandoned(id)) return null;
    const changes = changedFields(outgoing, unsaved);
    if (Object.keys(changes).length === 0) return null;
    return { id, changes };
  }, []);

  /** Send the draft now — the document is being left, inside a living page. */
  const flush = useCallback((): void => {
    const write = outgoingWrite();
    if (write === null) return;
    beginEditWrite(write.id);
    mutate.current(write.changes);
  }, [outgoingWrite]);

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
   * it. Nothing is reported — the toast surface is going away with the page —
   * and the refusal is swallowed rather than left as an unhandled rejection.
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

  const patch = (change: Partial<Draft>): void => {
    setDraft({ ...value, ...change });
  };

  const isArchived = doc.frontmatter.status === ARCHIVED;
  const folder = folderOf(doc.path);

  return (
    <>
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
        <button
          type="button"
          className="chip fm-edit-toggle"
          aria-expanded={editing}
          onClick={() => {
            setEditing(!editing);
          }}
        >
          {editing ? "done" : "edit"}
        </button>
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
          // The field grows by wrapping, never by the user adding rows: `↵` is
          // save (below), so no newline can reach the value and one row is
          // always the floor.
          rows={1}
          value={value.title}
          onChange={(event) => {
            patch({ title: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape" && draft !== null) {
              // Consumed here rather than by the escape chain: reverting a draft
              // is what Escape means while a field holds unsaved text.
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
      </div>

      {editing ? (
        <div className="fm-form" aria-label="Frontmatter">
          <label className="fm-field">
            <span>tags</span>
            <input
              className="fm-input"
              value={value.tags}
              placeholder="comma, separated"
              onChange={(event) => {
                patch({ tags: event.target.value });
              }}
            />
          </label>
          <label className="fm-field">
            <span>status</span>
            <select
              className="fm-input"
              value={value.status}
              disabled={isArchived}
              onChange={(event) => {
                patch({ status: event.target.value as DocStatus });
              }}
            >
              {/*
               * `archived` is offered only as the *current* value of a document
               * that already is, so the control has something to show — never as
               * a destination. Picking it here would set the frontmatter key and
               * leave a skill's folder in `.claude/skills/`, which is §7's
               * promise with the only part that mattered missing (UI-020).
               */}
              {(isArchived ? DOC_STATUSES : EDITABLE_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <span className="fm-hint">
              {isArchived
                ? "archived — Unarchive in the ⋯ menu brings it back"
                : "archive from the ⋯ menu — a status flip would not move a skill’s folder"}
            </span>
          </label>
          <label className="fm-field">
            <span>due</span>
            <input
              className="fm-input"
              type="date"
              value={value.due}
              onChange={(event) => {
                patch({ due: event.target.value });
              }}
            />
          </label>
        </div>
      ) : null}

      {isDirty ? (
        <div className="fm-actions" role="status">
          <span className="fm-dirty">unsaved changes</span>
          <button type="button" className="fm-save" disabled={update.isPending} onClick={save}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="fm-revert"
            onClick={() => {
              setDraft(null);
            }}
          >
            Revert
          </button>
        </div>
      ) : null}
    </>
  );
}
