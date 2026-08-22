import type { ReactElement } from "react";
import type { PluginColumnRef } from "../board/viewDoc.js";

/**
 * The "plugin missing" card (SPEC.md §12 M6): a pinned view document whose
 * `column:` names an unregistered plugin or column type renders this in the
 * column's **body**, while the column header and controls stay present,
 * reorderable and deletable. The view document's frontmatter is left
 * untouched, so restoring the plugin restores the column with zero edits.
 */
export function PluginMissingCard({ plugin }: { readonly plugin: PluginColumnRef }): ReactElement {
  return (
    <div className="col-list">
      <div className="col-card plugin-missing-card" role="note">
        <p className="col-card-title">Plugin missing</p>
        <p className="col-card-body">
          This column renders <code>{plugin.plugin}</code>&rsquo;s <code>{plugin.type}</code> view,
          which is not installed. Restore the plugin to bring the column back, or unpin this list —
          its view document is untouched either way.
        </p>
      </div>
    </div>
  );
}
