import { randomBytes } from "node:crypto";
import {
  AnchorIdSchema,
  DocIdSchema,
  DocumentIdSchema,
  EventIdSchema,
  ThreadIdSchema,
} from "@corpus/contract";

/**
 * Ids are opaque and prefixed by kind (SPEC.md §5). The contract owns what a
 * *valid* id looks like — the guards below delegate to its schemas and never
 * restate the pattern. Generation is deliberately narrower than validation: we
 * mint one fixed, lowercase, fixed-length shape, which is a generation policy a
 * validator has no business enforcing on ids minted elsewhere (or by hand).
 */
export const ID_PREFIXES = {
  doc: "doc",
  thread: "th",
  anchor: "anc",
  event: "evt",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** RFC 4648 base32, lowercased — 5 bits per character, no case ambiguity. */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Lowercase hex, for anchor ids alone. `anc_*` entries are read straight out of
 * a document's frontmatter by anyone editing the file by hand, and §6's own
 * examples (`anc_k4f7`) are hex — sprint-006 pins the minted shape as
 * `^anc_[0-9a-f]{8}$`. The contract's `AnchorIdSchema` still accepts any
 * alphanumeric suffix, because validation must keep accepting ids minted
 * elsewhere; only *generation* is this narrow.
 */
const HEX_ALPHABET = "0123456789abcdef";

const BITS_PER_BYTE = 8;

/**
 * Suffix length per kind. Documents, threads and anchors get 8 characters (40
 * bits); queue events get 12 (60 bits) because they are minted per comment, per
 * form answer and per subagent wake — orders of magnitude more often than
 * documents — and at 40 bits a busy workspace reaches birthday-collision range
 * around a million events, where a colliding id means one event file silently
 * overwriting another (SPEC.md §7, sprint-003 TEST-38).
 */
export const ID_SUFFIX_LENGTHS: Readonly<Record<IdPrefix, number>> = {
  [ID_PREFIXES.doc]: 8,
  [ID_PREFIXES.thread]: 8,
  [ID_PREFIXES.anchor]: 8,
  [ID_PREFIXES.event]: 12,
};

/**
 * Alphabet per kind. Anchors are hex (see {@link HEX_ALPHABET}); everything else
 * is base32, which packs more entropy into the same eight characters. An anchor
 * is only ever unique *within one document* and is minted against that
 * document's existing keys, so 32 bits is not the same risk 40 bits covers for a
 * corpus-wide id.
 */
export const ID_ALPHABETS: Readonly<Record<IdPrefix, string>> = {
  [ID_PREFIXES.doc]: BASE32_ALPHABET,
  [ID_PREFIXES.thread]: BASE32_ALPHABET,
  [ID_PREFIXES.anchor]: HEX_ALPHABET,
  [ID_PREFIXES.event]: BASE32_ALPHABET,
};

/** Bounded so a saturated namespace fails loudly instead of spinning forever. */
export const MAX_ID_ATTEMPTS = 5;

export class IdGenerationError extends Error {
  override readonly name = "IdGenerationError";
  constructor(
    readonly prefix: string,
    readonly attempts: number,
  ) {
    super(`Could not generate a free ${prefix}_* id after ${attempts} attempts`);
  }
}

const randomSuffix = (length: number, alphabet: string): string => {
  const bitsPerCharacter = Math.log2(alphabet.length);
  const mask = BigInt(alphabet.length - 1);
  const bytes = randomBytes(Math.ceil((length * bitsPerCharacter) / BITS_PER_BYTE));
  let bits = 0n;
  for (const byte of bytes) bits = (bits << BigInt(BITS_PER_BYTE)) | BigInt(byte);
  let suffix = "";
  for (let i = 0; i < length; i += 1) {
    const index = Number((bits >> BigInt(bitsPerCharacter * (length - 1 - i))) & mask);
    suffix += alphabet[index];
  }
  return suffix;
};

/**
 * Mint a collision-safe id. `isTaken` is optional: callers holding the
 * projection pass a real predicate, callers without one rely on the 40 bits of
 * entropy. Gives up after {@link MAX_ID_ATTEMPTS} rather than looping.
 */
export const newId = (prefix: IdPrefix, isTaken?: (id: string) => boolean): string => {
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const id = `${prefix}_${randomSuffix(ID_SUFFIX_LENGTHS[prefix], ID_ALPHABETS[prefix])}`;
    if (isTaken === undefined || !isTaken(id)) return id;
  }
  throw new IdGenerationError(prefix, MAX_ID_ATTEMPTS);
};

export const isDocId = (value: string): boolean => DocIdSchema.safeParse(value).success;
export const isThreadId = (value: string): boolean => ThreadIdSchema.safeParse(value).success;
export const isDocumentId = (value: string): boolean => DocumentIdSchema.safeParse(value).success;
export const isAnchorId = (value: string): boolean => AnchorIdSchema.safeParse(value).success;
export const isEventId = (value: string): boolean => EventIdSchema.safeParse(value).success;

/** The id prefix a document of this `type` must carry (SPEC.md §5): threads are `th_*`. */
export const idPrefixForDocType = (type: string): IdPrefix =>
  type === "thread" ? ID_PREFIXES.thread : ID_PREFIXES.doc;
