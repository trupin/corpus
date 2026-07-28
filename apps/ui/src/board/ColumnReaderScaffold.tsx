import { useDoc, useUpdateDoc, type RowNotice } from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * **Scaffolding — UI-005 replaces this file.**
 *
 * SPEC.md §11 makes one promise about creation that cannot be deferred to the
 * reader issue: "the new document opens immediately in its column, title
 * selected, ready to type". That is a creation criterion, not a reading one, so
 * the minimum surface that keeps the promise lives here: the column widens, the
 * document's title is editable and selected, and `‹` goes back to the list.
 *
 * Everything a reader actually is — the body, the navigation stack, focus mode,
 * the ⋯ document menu, the lock banner, anchored threads — is UI-005's and is
 * deliberately absent rather than half-built.
 */

export interface ColumnReaderScaffoldProps {
  readonly docId: string;
  readonly columnTitle: string;
  /** True right after creation: the title is focused *and* selected. */
  readonly selectTitle: boolean;
  readonly onClose: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

export function ColumnReaderScaffold({
  docId,
  columnTitle,
  selectTitle,
  onClose,
  onNotify,
}: ColumnReaderScaffoldProps): ReactElement {
  const doc = useDoc(docId);
  const update = useUpdateDoc(docId);
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const selected = useRef(false);

  const title = doc.data?.frontmatter.title ?? "";
  const value = draft ?? title;

  useEffect(() => {
    if (!selectTitle || selected.current || doc.data === undefined) return;
    selected.current = true;
    field.current?.focus();
    // Selected, not merely focused: SPEC.md §11 says "ready to type", and a
    // caret after "Untitled" is not that.
    field.current?.select();
  }, [doc.data, selectTitle]);

  const commit = (): void => {
    const next = value.trim();
    setDraft(null);
    if (next === "" || next === title) return;
    update.mutate(
      { title: next },
      {
        onSuccess: () => {
          onNotify({ tone: "info", message: `Renamed to “${next}” — committed.` });
        },
        onError: (error) => {
          onNotify({ tone: "error", message: `Rename failed — ${error.message}` });
        },
      },
    );
  };

  return (
    <div className="reader" data-reader-doc={docId}>
      <div className="reader-head">
        <button type="button" className="back" onClick={onClose}>
          ‹ {columnTitle}
        </button>
        <span className="reader-id">{docId}</span>
      </div>
      <div className="reader-scroll">
        {doc.isError ? (
          <p className="col-card-body" role="alert">
            {doc.error.message}
          </p>
        ) : (
          <>
            <input
              ref={field}
              className="doc-title"
              aria-label="Document title"
              value={value}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                }
              }}
            />
            <p className="reader-note">
              The document view — body, threads, focus mode — arrives with the reader.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
