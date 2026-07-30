import { DOC_STATUSES, type Doc, type DocStatus, type UpdateDocRequest } from "@corpus/contract";
import { folderOf, useUpdateDoc, type RowNotice } from "@corpus/kit";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { isAbandoned, publishTitleDraft } from "../abandon/registry";

/**
 * Frontmatter as the small form SPEC.md §11 asks for — title, tags, status,
 * due — over the prototype's `.fm-chips` strip.
 *
 * **One draft, one write.** The title is an input styled as the document's `h1`
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
  /** An agent (or another session) holds the edit lock — every control freezes. */
  readonly locked: boolean;
  readonly onNotify: (notice: RowNotice) => void;
  /**
   * Rendered between the chip strip and the title, where the prototype puts the
   * lock banner. A prop rather than a sibling because the strip, the banner and
   * the title are one visual block and their order is the mockup's, not the
   * caller's.
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

/**
 * The `PUT` body: only what the user changed.
 *
 * `due` is cleared with `null` rather than by omission, because omission means
 * "leave it alone" on this route — the two have to be distinguishable or a
 * deadline can never be removed.
 */
export function changedFields(doc: Doc, draft: Draft): UpdateDocRequest {
  const current = draftOf(doc);
  const changes: UpdateDocRequest = {};
  const title = draft.title.trim();
  if (title !== "" && title !== current.title) changes.title = title;
  if (draft.tags.trim() !== current.tags) changes.tags = textToTags(draft.tags);
  if (draft.status !== current.status) changes.status = draft.status;
  if (draft.due !== current.due) changes.due = draft.due === "" ? null : draft.due;
  return changes;
}

export function FrontmatterForm({
  doc,
  selectTitle,
  locked,
  onNotify,
  banner,
}: FrontmatterFormProps): ReactElement {
  const docId = doc.frontmatter.id;
  /*
   * The callbacks ride on the **hook**, not on the call (the `SettledCallbacks`
   * seam UI-012 added). A save issued while the reader is unmounting has no
   * observer left to receive a per-call `onSuccess`, so it would commit the
   * write in silence — and the exit flush below is exactly that save.
   */
  const update = useUpdateDoc(docId, {
    onSuccess: (_response, saved) => {
      setDraft(null);
      onNotify({
        tone: "info",
        message: `Saved — ${Object.keys(saved).join(", ")} updated and committed.`,
      });
    },
    onError: (error) => {
      onNotify({ tone: "error", message: `Save failed — ${error.message}` });
    },
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
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
   * that gets dropped. Under a foreign lock nothing here can be written at all,
   * so the draft is withheld and the corpus's own title decides.
   */
  useEffect(() => {
    publishTitleDraft(docId, draft === null || locked ? null : draft.title);
  }, [docId, draft, locked]);

  useEffect(() => {
    if (!selectTitle || selected.current) return;
    selected.current = true;
    field.current?.focus();
    // Selected, not merely focused: SPEC.md §11 says "ready to type", and a
    // caret after "Untitled" is not that.
    field.current?.select();
  }, [selectTitle]);

  const save = (): void => {
    if (!isDirty || locked) return;
    update.mutate(changes);
  };

  /*
   * What the flush needs, read at flush time rather than closed over: the
   * effect below is registered once, and a handler holding the first render's
   * draft would write an empty title over a typed one.
   */
  const pending = useRef({ doc, draft, locked });
  pending.current = { doc, draft, locked };
  const mutate = useRef(update.mutate);
  mutate.current = update.mutate;

  /**
   * Send the draft now — the document is being left.
   *
   * It declines for an **abandoned** document for the same reason autosave
   * does: the emptiness that decided the removal is what this would be writing,
   * and it would be a `PUT` racing the `DELETE` behind it. The ordering is
   * load-bearing and not incidental — the abandon decision is taken in the
   * host's *layout*-effect teardown, which runs ahead of this passive one.
   */
  const flush = useCallback((): void => {
    const { doc: outgoing, draft: unsaved, locked: frozen } = pending.current;
    if (unsaved === null || frozen) return;
    const id = outgoing.frontmatter.id;
    if (isAbandoned(id)) return;
    const changed = changedFields(outgoing, unsaved);
    if (Object.keys(changed).length === 0) return;
    mutate.current(changed);
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

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

      <input
        ref={field}
        className="doc-title"
        aria-label="Document title"
        value={value.title}
        readOnly={locked}
        onChange={(event) => {
          patch({ title: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape" && draft !== null) {
            // Consumed here rather than by the escape chain: reverting a draft is
            // what Escape means while a field holds unsaved text.
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />

      {editing ? (
        <div className="fm-form" aria-label="Frontmatter">
          <label className="fm-field">
            <span>tags</span>
            <input
              className="fm-input"
              value={value.tags}
              disabled={locked}
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
              disabled={locked}
              onChange={(event) => {
                patch({ status: event.target.value as DocStatus });
              }}
            >
              {DOC_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="fm-field">
            <span>due</span>
            <input
              className="fm-input"
              type="date"
              value={value.due}
              disabled={locked}
              onChange={(event) => {
                patch({ due: event.target.value });
              }}
            />
          </label>
        </div>
      ) : null}

      {isDirty ? (
        <div className="fm-actions" role="status">
          <span className="fm-dirty">
            {locked
              ? "unsaved — the document was locked while you were editing; your changes are kept here"
              : "unsaved changes"}
          </span>
          <button
            type="button"
            className="fm-save"
            disabled={locked || update.isPending}
            onClick={save}
          >
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
