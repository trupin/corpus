/**
 * The `embedding` block of `.corpus/config.json`: its on-disk shape, and the
 * boot-time judgement of whether this build can serve what it names.
 *
 * The split between the two is the point. `EmbeddingConfigSchema` is
 * **permissive** — every field but `provider` is optional and typed as a plain
 * string — because `.corpus/config.json` is read by more than this server (the
 * CLI keeps its own loose reader, `apps/cli/src/workspace.ts:36`) and a file a
 * newer `corpus init` wrote must not become unreadable to an older component
 * over a key that is none of its business. What this *version* can actually
 * serve is then decided at boot, in the shape `dataDir` already uses
 * (`config.ts`'s `unsupportedDataDirError`) — except non-fatally: a typo in a
 * provider name must not stop a document tool from serving documents.
 *
 * A bad block is never silently ignored. It produces a boot warning naming the
 * file and the key, and the seam resolves to an explicit error state rather than
 * falling through to the embedded engine — a configured choice failing is not
 * the same event as no choice having been made (SPEC.md §9.1).
 *
 * `config.ts` reaches this through `semantic/index.ts` like every other consumer.
 * The dependency runs one way only: nothing under `semantic/` may *value*-import
 * `../config.ts`, or the module that parses the config and the module that
 * judges it would form a cycle.
 */

import { z } from "zod";
import { redactSecrets } from "./provider.js";

/** Wire shapes this build knows how to speak. `none` is the explicit opt-out. */
export const CONFIGURED_PROVIDER_KINDS = ["ollama", "openai"] as const;

export type ConfiguredProviderKind = (typeof CONFIGURED_PROVIDER_KINDS)[number];

/** `"provider": "none"` — semantic indexing off by an operator's decision, not by absence. */
export const EMBEDDING_PROVIDER_NONE = "none";

export const EmbeddingConfigSchema = z.object({
  provider: z.string().min(1),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  /**
   * Never logged, never included in an error message: everything that can reach
   * a log on this path goes through `redactSecrets` (`provider.ts`).
   */
  apiKey: z.string().optional(),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

export interface ConfiguredEmbeddingProvider {
  readonly kind: ConfiguredProviderKind;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey?: string | undefined;
}

/** What `loadServerConfig` hands the seam: the block, already judged. */
export type EmbeddingSettings =
  /** No `embedding` block — the zero-config case, which is not an error. */
  | { readonly kind: "absent" }
  /** `"provider": "none"` — an operator turned it off. */
  | { readonly kind: "off" }
  | { readonly kind: "configured"; readonly provider: ConfiguredEmbeddingProvider }
  /** Present and unusable; `detail` is already in the boot warnings. */
  | { readonly kind: "invalid"; readonly detail: string };

export interface EmbeddingSettingsResult {
  readonly settings: EmbeddingSettings;
  /** Non-fatal boot warning, in `ServerConfig.warnings`' voice; absent when the block is fine. */
  readonly warning?: string;
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

function invalid(detail: string, configPath: string): EmbeddingSettingsResult {
  return {
    settings: { kind: "invalid", detail },
    warning:
      `the "embedding" block in ${configPath} is not usable: ${detail} — semantic indexing ` +
      `reports an error until it is corrected, and search stays lexical`,
  };
}

/**
 * Judges a parsed block against what this build can serve. Pure: it reads no
 * environment and dials no endpoint — whether a *reachable* endpoint answers is
 * a question for resolution, which is asynchronous and must not sit in front of
 * a boot.
 */
export function resolveEmbeddingSettings(
  raw: EmbeddingConfig | undefined,
  configPath: string,
): EmbeddingSettingsResult {
  if (raw === undefined) return { settings: { kind: "absent" } };

  const provider = raw.provider.trim();
  if (provider === EMBEDDING_PROVIDER_NONE) return { settings: { kind: "off" } };

  const known = CONFIGURED_PROVIDER_KINDS.find((kind) => kind === provider);
  if (known === undefined) {
    return invalid(
      `this version of corpus does not know the provider ${JSON.stringify(provider)} — ` +
        `use one of ${[EMBEDDING_PROVIDER_NONE, ...CONFIGURED_PROVIDER_KINDS].join(", ")}, ` +
        `or remove the block to use the embedded engine`,
      configPath,
    );
  }

  const endpoint = raw.endpoint?.trim() ?? "";
  if (endpoint === "") {
    return invalid(`provider ${JSON.stringify(provider)} needs an "endpoint"`, configPath);
  }
  if (!isHttpUrl(endpoint)) {
    // Quoted back so the operator can see their typo — through `redactSecrets`,
    // because a rejected value is still a value they may have written
    // credentials into (`ftp://user:pass@host` fails this check and would
    // otherwise land verbatim in a boot warning).
    return invalid(
      `"endpoint" must be an http(s) URL, got ${JSON.stringify(redactSecrets(endpoint, []))}`,
      configPath,
    );
  }

  const model = raw.model?.trim() ?? "";
  if (model === "") {
    return invalid(`provider ${JSON.stringify(provider)} needs a "model"`, configPath);
  }

  const apiKey = raw.apiKey?.trim();
  return {
    settings: {
      kind: "configured",
      provider: {
        kind: known,
        endpoint,
        model,
        ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
      },
    },
  };
}
