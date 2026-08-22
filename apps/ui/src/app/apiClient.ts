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
 * The `id` the server gives the runtime config block it splices into the shell
 * it serves (`apps/server/src/ui-runtime-config.ts` — same constant, and the
 * security rationale for the mechanism lives there). A JSON data block, not
 * executable script, so reading it is a parse and never an evaluation.
 */
const RUNTIME_CONFIG_ELEMENT_ID = "corpus-runtime-config";

/**
 * The token the server that served this page put in it, or `""` when the page
 * was not served by the workspace server (the Vite dev server serves the
 * unmodified `index.html`) or the block is unusable.
 *
 * Every failure is the same answer — absent. A malformed block means no token,
 * which surfaces as visible `401`s and an honest console strip; it must never
 * become an exception at module load, because this runs before React mounts and
 * a throw here is a blank page.
 */
function injectedToken(): string {
  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);
  if (element === null) return "";

  try {
    const parsed: unknown = JSON.parse(element.textContent ?? "");
    if (typeof parsed !== "object" || parsed === null) return "";
    const token: unknown = (parsed as Record<string, unknown>)["token"];
    return typeof token === "string" ? token : "";
  } catch {
    return "";
  }
}

/**
 * Where the bearer token comes from — and the only place in the app that decides.
 *
 * The kit takes the token as *configuration* and never sources it: it reads no
 * file, no cookie and no environment variable, so nothing that imports the kit
 * can reach through it for credentials. That leaves provisioning here, and
 * there are two sources:
 *
 * - **Production**: the workspace server injects the token into the very shell
 *   it serves, and `injectedToken()` reads it back out of the document
 *   (SERVER-024). Zero manual steps.
 * - **Development**: `VITE_CORPUS_TOKEN`, exported by whoever starts the dev
 *   server from the workspace's `.corpus/config.json`. See `apps/ui/README.md`.
 *   `import.meta.env` carries an index signature, so the value arrives untyped
 *   and is narrowed here rather than trusted.
 *
 * **Precedence: the injected value wins.** It is decided rather than incidental.
 * `VITE_CORPUS_TOKEN` is baked into the bundle at *build* time, so it can only
 * ever be a guess about which workspace the build would later be served from —
 * possibly a stale one, possibly another workspace's. The injected value comes
 * from the running server that just handed out this exact page, and it is by
 * construction the token that server will accept. The two only ever collide
 * when a bundle built with the env var is then served by the server, and in
 * that case the runtime answer is the right one. A non-empty injected token
 * therefore shadows the env var; an absent or empty one falls back to it, which
 * is what makes the dev flow unchanged.
 */
function configuredToken(): string {
  const injected = injectedToken();
  if (injected !== "") return injected;

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
