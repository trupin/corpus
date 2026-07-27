import { createCorpusClient, type CorpusClient } from "@corpus/kit";

/**
 * The UI always talks to its own origin: in development the Vite dev server
 * proxies `/api` and `/events` to `127.0.0.1:8765`, and in the installed tool
 * the server serves the built UI itself (SPEC.md §3). So there is no base URL
 * to configure — only a base URL to inherit.
 *
 * The client itself is `@corpus/kit`'s, not `@corpus/contract`'s: this module is
 * the app's provider wiring, and it is the last place in `apps/ui` that is
 * allowed to know a transport exists. Everything else reads through kit hooks.
 */
function currentOrigin(): string {
  return globalThis.location.origin;
}

/**
 * Where the bearer token comes from — and the only place in the app that decides.
 *
 * The kit takes the token as *configuration* and never sources it: it reads no
 * file, no cookie and no environment variable, so a plugin cannot reach through
 * it for credentials. That leaves provisioning here, and it is split in two:
 *
 * - **Development** (this function): `VITE_CORPUS_TOKEN`, exported by whoever
 *   starts the dev server from the workspace's `.corpus/config.json`. See
 *   `apps/ui/README.md`.
 * - **Production**: the server that serves the built UI injects it. That half is
 *   SERVER-024; until it lands an installed build has no token, and every
 *   authenticated query fails with a visible 401 rather than silently.
 *
 * `import.meta.env` carries an index signature, so the value arrives untyped and
 * is narrowed here rather than trusted.
 */
function configuredToken(): string {
  const configured: unknown = import.meta.env.VITE_CORPUS_TOKEN;
  return typeof configured === "string" ? configured : "";
}

export interface UiClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createUiClient(options: UiClientOptions = {}): CorpusClient {
  return createCorpusClient({
    baseUrl: options.baseUrl ?? currentOrigin(),
    token: options.token ?? configuredToken(),
    // Late-bound on purpose: `openapi-fetch` captures the transport when the
    // client is built, and this client is built at module load.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  });
}

export const uiClient: CorpusClient = createUiClient();
