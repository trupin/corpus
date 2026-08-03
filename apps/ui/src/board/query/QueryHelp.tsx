import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import {
  QUERY_COMBINATORS,
  QUERY_EXAMPLES,
  QUERY_FIELDS,
  QUERY_OPERATORS,
  type QueryField,
} from "./grammar";

/**
 * The query syntax reference (UI-039), opened from the `?` beside the query
 * field.
 *
 * **Generated from `grammar.ts`, never written out** — the same rule the `?`
 * cheat-sheet follows for shortcuts, and for the same reason: a reference
 * maintained by hand is wrong the first time somebody adds a filter in a hurry,
 * and a wrong reference is worse than none because it is the only place a user
 * can look. Since that module reads its field names off `DocsQuerySchema`, this
 * panel and the server's parser cannot disagree.
 *
 * It renders on `.ac-menu`, the surface every positioned panel in the product
 * uses, and keeps that family's conventions: esc dismisses, an outside press
 * dismisses, focus lands inside on open and returns to the opener on close.
 */

export interface QueryHelpProps {
  readonly onClose: () => void;
  /** Positioning is the host's, exactly as `AutocompleteMenu` has it. */
  readonly style?: CSSProperties | undefined;
}

function valueHint(field: QueryField): string {
  const source = field.values;
  const base =
    source.kind === "fixed"
      ? source.values.join(" · ")
      : source.kind === "free"
        ? source.hint
        : source.kind === "docId"
          ? "a document, by title"
          : source.kind === "folder"
            ? "a folder under data/docs/"
            : source.kind === "tag"
              ? "a tag in use"
              : "a type in use";
  return field.multi ? `${base}  (comma-separated)` : base;
}

export function QueryHelp({ onClose, style }: QueryHelpProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (panel.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      className="ac-menu open query-help"
      role="dialog"
      aria-label="Query syntax"
      tabIndex={-1}
      style={style}
      // A press inside must not blur the field behind it: that would commit the
      // edit and unmount the very panel being read.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <p className="query-help-lead">
        A column&apos;s query is the same filter string the server takes. One operator, two ways to
        combine.
      </p>

      <h4>Combining</h4>
      <dl className="query-help-rules">
        {[...QUERY_OPERATORS, ...QUERY_COMBINATORS].map((rule) => (
          <div className="query-help-rule" key={rule.token}>
            <dt>
              <code>{rule.token}</code>
            </dt>
            <dd>{rule.meaning}</dd>
          </div>
        ))}
      </dl>

      <h4>Examples</h4>
      <dl className="query-help-rules">
        {QUERY_EXAMPLES.map((example) => (
          <div className="query-help-rule" key={example.query}>
            <dt>
              <code>{example.query}</code>
            </dt>
            <dd>{example.meaning}</dd>
          </div>
        ))}
      </dl>

      <h4>Fields</h4>
      <dl className="query-help-fields">
        {QUERY_FIELDS.map((field) => (
          <div className="query-help-field" key={field.name} data-query-field={field.name}>
            <dt>
              <code>{field.name}</code>
            </dt>
            <dd>
              {field.summary}
              <span className="query-help-values">{valueHint(field)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
