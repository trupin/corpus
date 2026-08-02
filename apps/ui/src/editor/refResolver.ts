import type { Doc } from "@corpus/contract";
import { docKey } from "@corpus/kit";
import type { QueryClient } from "@tanstack/react-query";
import { UNRESOLVED_REF, type RefResolver, type RefTarget } from "./clipboard.js";

/**
 * A `[[ref]]`'s title, for the clipboard, read straight out of the query cache.
 *
 * **Synchronous on purpose.** A clipboard serializer runs inside the browser's
 * `copy` event and cannot await anything, so this reads what is already cached
 * rather than fetching. That is not a compromise: every ref in an open document
 * is a mounted `RefNodeView` doing `useDoc(id)` under this exact key, so by the
 * time a person has selected text and pressed ⌘C the titles they can *see* are
 * the titles in the cache. A ref that somehow is not resolves to no title and
 * falls back to what the reader saw — its id.
 *
 * **`href` stays `null`** (see {@link RefTarget}): nothing in v1 gives a Corpus
 * document an address outside the app, so nothing here may invent one.
 */
export function refResolver(client: QueryClient): RefResolver {
  return (id: string): RefTarget => {
    const cached = client.getQueryData<Doc>(docKey(id));
    const title = cached?.frontmatter.title;
    return title === undefined || title === "" ? UNRESOLVED_REF : { title, href: null };
  };
}
