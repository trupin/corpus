import { QUERY_KEY_NAMES, QUERY_KEY_VOCABULARY, type QueryKey } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import type { DocsWorkspace } from "../docs/index.js";
import { createDocumentMutex } from "../docs/index.js";
import { silentLogger } from "../logger.js";
import { createPluginContext, PLUGIN_KEY_PREFIX } from "./context.js";

/**
 * The namespacing half of the context. The write half — createDoc/updateDoc
 * running the real pipeline (git commit, projection, broadcast) — is proven
 * end to end in `discover.test.ts` against a real workspace; these tests pin
 * the key discipline, which is pure.
 */

function contextWithRecorder(): {
  broadcast: (keys: readonly (readonly (string | number)[])[]) => void;
  emitted: QueryKey[][];
} {
  const emitted: QueryKey[][] = [];
  const workspace = {
    bus: {
      invalidate: (keys: readonly QueryKey[]) => {
        emitted.push([...keys.map((key) => [...key])]);
      },
    },
  } as unknown as DocsWorkspace;
  const context = createPluginContext({
    plugin: "fx",
    workspace,
    mutex: createDocumentMutex(),
    logger: silentLogger,
    now: () => 0,
  });
  return { broadcast: (keys) => context.broadcastInvalidate(keys), emitted };
}

describe("broadcastInvalidate", () => {
  it("prefixes every key with ['x', <plugin>] — byte-identical to the kit's pluginKey", () => {
    const { broadcast, emitted } = contextWithRecorder();
    broadcast([["notes"], ["notes", "doc_1"]]);
    expect(emitted).toEqual([
      [
        [PLUGIN_KEY_PREFIX, "fx", "notes"],
        [PLUGIN_KEY_PREFIX, "fx", "notes", "doc_1"],
      ],
    ]);
  });

  it("is a no-op for an empty key list", () => {
    const { broadcast, emitted } = contextWithRecorder();
    broadcast([]);
    expect(emitted).toEqual([]);
  });

  // The pin the guard's hand-written list never had. SERVER-051 added `["index"]`
  // to the contract's vocabulary and this test — transcribing the same list a
  // second time — could not notice, so a plugin naming its key `index` was
  // quietly namespaced instead of being told why it may not. Reading the roots
  // out of the vocabulary is what stops the eleventh shape repeating it.
  it("rejects every root the contract's key vocabulary declares, plus the kit's health", () => {
    const { broadcast, emitted } = contextWithRecorder();
    const roots = QUERY_KEY_NAMES.map((name) => QUERY_KEY_VOCABULARY[name].key("id")[0]).filter(
      (segment): segment is string => typeof segment === "string",
    );
    // Every shape is named by its first segment; one filtered away here would be
    // a root no plugin is ever refused.
    expect(roots).toHaveLength(QUERY_KEY_NAMES.length);
    expect(roots).toContain("index");

    for (const root of [...roots, "health"]) {
      expect(() => {
        broadcast([[root]]);
      }).toThrow(/may not invalidate/);
    }
    expect(emitted).toEqual([]);
  });

  it("still namespaces a plugin key that merely resembles a core one", () => {
    const { broadcast, emitted } = contextWithRecorder();
    broadcast([["indexes"], ["docs-of-mine"]]);
    expect(emitted).toEqual([
      [
        [PLUGIN_KEY_PREFIX, "fx", "indexes"],
        [PLUGIN_KEY_PREFIX, "fx", "docs-of-mine"],
      ],
    ]);
  });

  it("rejects a key that tries to smuggle its own x/ prefix", () => {
    const { broadcast } = contextWithRecorder();
    expect(() => {
      broadcast([["x", "other-plugin", "notes"]]);
    }).toThrow(/may not invalidate/);
  });

  it("rejects an empty key", () => {
    const { broadcast } = contextWithRecorder();
    expect(() => {
      broadcast([[]]);
    }).toThrow(/empty invalidation key/);
  });
});
