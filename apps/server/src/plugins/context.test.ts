import type { QueryKey } from "@corpus/contract";
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

  it("rejects every member of core's closed vocabulary", () => {
    const { broadcast, emitted } = contextWithRecorder();
    for (const root of ["docs", "tree", "threads", "queue", "jobs", "locks", "health"]) {
      expect(() => {
        broadcast([[root]]);
      }).toThrow(/may not invalidate/);
    }
    expect(emitted).toEqual([]);
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
