import { useEffect } from "react";
import type { FolderDocs } from "./treeRows";
import { useFolderDocs } from "./useFolderDocs";

/**
 * One folder's documents, fetched by a component that renders nothing.
 *
 * **A component rather than a loop, because hooks cannot be called in one.**
 * The tree opens an arbitrary number of folders, each needing its own
 * `GET /api/docs?folder=…`, and React's rule of hooks makes "one query per open
 * folder" a mounting question rather than an iteration question. So the panel
 * mounts one of these per open folder and collects the answers into a map.
 *
 * The alternative — one query for the whole corpus, filtered client-side — is
 * the enumeration SPEC.md §7 forbids, and would defeat the per-folder bound
 * §10 requires. The alternative *within* React — a nested render where each
 * folder component draws its own rows — costs the flat keyboard list the tree
 * is built on (see `treeRows.ts`).
 *
 * A collapsed folder mounts none of these, so a closed tree costs one request.
 */

export interface FolderDocsProbeProps {
  readonly path: string;
  readonly onAnswer: (path: string, docs: FolderDocs) => void;
}

export function FolderDocsProbe({ path, onAnswer }: FolderDocsProbeProps): null {
  const docs = useFolderDocs(path);
  useEffect(() => {
    onAnswer(path, docs);
  }, [docs, onAnswer, path]);
  return null;
}
