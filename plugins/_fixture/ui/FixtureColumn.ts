import { usePluginQuery } from "@corpus/kit";
import type { ColumnComponentProps } from "@corpus/kit/plugin";
import { createElement, type ReactElement } from "react";
import { z } from "zod";

/**
 * The fixture's column `Component`, built exclusively on `@corpus/kit`
 * (SPEC.md §10): `usePluginQuery` fetches the fixture's own server route and
 * caches under `["x", "_fixture", "notes"]` — the key the route's
 * `broadcastInvalidate` announces over the core SSE stream — so the column
 * live-updates with no machinery of its own. The wire shape is the plugin's
 * alone, validated here with the plugin's own schema (Zod at the boundary).
 */

const NotesPayloadSchema = z.object({
  notes: z.array(z.object({ id: z.string(), title: z.string() })),
});

export function FixtureColumn({ viewDocId, title }: ColumnComponentProps): ReactElement {
  const query = usePluginQuery("_fixture", "notes");

  if (query.error !== null) {
    return createElement(
      "div",
      { className: "col-card col-card-error", role: "alert", "data-fixture-column": viewDocId },
      `Fixture column failed to load: ${query.error.message}`,
    );
  }
  if (query.data === undefined) {
    return createElement(
      "p",
      { className: "col-empty", "data-fixture-column": viewDocId },
      "Loading…",
    );
  }

  const parsed = NotesPayloadSchema.safeParse(query.data);
  if (!parsed.success) {
    return createElement(
      "div",
      { className: "col-card col-card-error", role: "alert", "data-fixture-column": viewDocId },
      "Fixture column received an unexpected payload.",
    );
  }

  return createElement(
    "div",
    { className: "fixture-column", "data-fixture-column": viewDocId },
    createElement(
      "p",
      { className: "fixture-column-head" },
      `${title} — ${String(parsed.data.notes.length)} note${parsed.data.notes.length === 1 ? "" : "s"}`,
    ),
    createElement(
      "ul",
      { className: "fixture-column-list" },
      ...parsed.data.notes.map((note) =>
        createElement("li", { key: note.id, "data-fixture-note": note.id }, note.title),
      ),
    ),
  );
}
