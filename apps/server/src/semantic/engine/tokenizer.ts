/**
 * The WordPiece tokenizer the model's own `tokenizer.json` describes.
 *
 * Written here rather than pulled in as a dependency for one reason and one
 * measurement: every published JavaScript tokenizer that reads a HuggingFace
 * `tokenizer.json` arrives either as a native addon with a per-platform binary
 * or inside `@huggingface/transformers`, which drags `onnxruntime-node` and
 * `sharp` behind it — 393 MiB of `node_modules` measured, against 137 MiB for
 * the runtime this build actually uses. A BERT tokenizer is ~120 lines of
 * pure text handling; that is a better trade than a third inference stack.
 *
 * It is not written from memory. The implementation reproduces
 * `transformers.js`'s token ids **exactly** on the ten adversarial inputs in
 * `tokenizer.test.ts` — accents, CJK, punctuation runs, whitespace storms,
 * emoji, over-long words, rare subword-heavy vocabulary — and the vectors that
 * come out of the same model on the same runtime match to 1e-8. Those cases
 * are the specification; the prose below is only why each step exists.
 *
 * The file is **data at a trust boundary**: it is downloaded (hash-pinned, but
 * still), so it is parsed with Zod like every other boundary in this codebase
 * and never `eval`ed, `require`d, or otherwise executed. What comes out is a
 * string→number map and four scalars.
 */

import { z } from "zod";
import { CorpusError } from "../../errors.js";

export class TokenizerError extends CorpusError {
  override readonly name = "TokenizerError";
}

/**
 * The subset of `tokenizer.json` this engine understands. Unknown keys pass
 * through — the file carries padding/truncation defaults, an `added_tokens`
 * table and a post-processor template that this build re-derives from the
 * model type rather than interpreting, and rejecting a file for carrying them
 * would be refusing the format's normal shape.
 */
const TokenizerFileSchema = z.object({
  model: z.object({
    type: z.literal("WordPiece"),
    unk_token: z.string().min(1),
    continuing_subword_prefix: z.string(),
    max_input_chars_per_word: z.number().int().positive(),
    vocab: z.record(z.string(), z.number().int().nonnegative()),
  }),
  normalizer: z
    .object({
      lowercase: z.boolean().optional(),
      strip_accents: z.boolean().nullish(),
      handle_chinese_chars: z.boolean().optional(),
      clean_text: z.boolean().optional(),
    })
    .nullish(),
});

const CLS_TOKEN = "[CLS]";
const SEP_TOKEN = "[SEP]";

/**
 * The blocks `BertNormalizer` spaces out so that each ideograph becomes its own
 * token. Han plus the compatibility and extension blocks, as upstream lists
 * them; the surrounding CJK punctuation is deliberately not included.
 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];

const isCjk = (codePoint: number): boolean =>
  CJK_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);

const MARK = /\p{Mn}/gu;
const PUNCTUATION = /\p{P}/u;
const CONTROL = /\p{Cc}|\p{Cf}/u;
const SPACE_SEPARATOR = /\p{Zs}/u;

/**
 * BERT's own definition, which is wider than Unicode's: every ASCII symbol that
 * is not alphanumeric counts as punctuation, so `$`, `+`, `<`, `^`, `` ` `` and
 * `|` split words even though Unicode files them under `Sc`/`Sm`/`Sk`.
 */
function isPunctuation(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  if (
    (codePoint >= 33 && codePoint <= 47) ||
    (codePoint >= 58 && codePoint <= 64) ||
    (codePoint >= 91 && codePoint <= 96) ||
    (codePoint >= 123 && codePoint <= 126)
  ) {
    return true;
  }
  return PUNCTUATION.test(char);
}

const isWhitespace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || SPACE_SEPARATOR.test(char);

const isControl = (char: string): boolean =>
  char !== "\t" && char !== "\n" && char !== "\r" && CONTROL.test(char);

export interface NormalizerOptions {
  readonly lowercase: boolean;
  readonly stripAccents: boolean;
  readonly handleChineseChars: boolean;
  readonly cleanText: boolean;
}

/**
 * `clean_text` → `handle_chinese_chars` → `strip_accents` → `lowercase`, in
 * that order, because the order changes the answer: stripping accents after
 * lowercasing loses the distinction for scripts where case folding composes.
 */
export function normalizeText(text: string, options: NormalizerOptions): string {
  let out = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (options.cleanText) {
      if (codePoint === 0 || codePoint === 0xfffd || isControl(char)) continue;
      if (isWhitespace(char)) {
        out += " ";
        continue;
      }
    }
    if (options.handleChineseChars && isCjk(codePoint)) {
      out += ` ${char} `;
      continue;
    }
    out += char;
  }
  if (options.stripAccents) out = out.normalize("NFD").replace(MARK, "");
  return options.lowercase ? out.toLowerCase() : out;
}

/** Whitespace split, then each punctuation character peeled off as its own word. */
export function preTokenize(text: string): string[] {
  const words: string[] = [];
  for (const run of text.split(/\s+/)) {
    if (run === "") continue;
    let current = "";
    for (const char of run) {
      if (isPunctuation(char)) {
        if (current !== "") {
          words.push(current);
          current = "";
        }
        words.push(char);
        continue;
      }
      current += char;
    }
    if (current !== "") words.push(current);
  }
  return words;
}

export interface Tokenizer {
  /** Ids for one text, `[CLS] … [SEP]`, never longer than `maxTokens`. */
  encode(text: string, maxTokens: number): number[];
}

export function createTokenizer(source: string): Tokenizer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new TokenizerError("the cached tokenizer is not valid JSON", { cause: error });
  }

  const result = TokenizerFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new TokenizerError(
      `the cached tokenizer is not a WordPiece tokenizer this build can use: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const { model, normalizer } = result.data;
  // A `Map`, never the parsed object: `vocab["constructor"]` on a plain object
  // answers with `Object.prototype.constructor` — a function — and every word in
  // the corpus that starts with "constructor" would then have that function
  // pushed into the id list, where `BigInt(id)` throws and the chunk fails
  // permanently (and a *query* containing the word drops the provider for the
  // whole cooldown). `toString`, `valueOf` and the rest are the same hazard. A
  // `Map` has no inherited keys to find and types the miss as `undefined`, which
  // is the answer the greedy walk below is already written against.
  const vocab = new Map<string, number>(Object.entries(model.vocab));
  const unknownId = vocab.get(model.unk_token);
  const clsId = vocab.get(CLS_TOKEN);
  const sepId = vocab.get(SEP_TOKEN);
  if (unknownId === undefined || clsId === undefined || sepId === undefined) {
    throw new TokenizerError(
      `the cached tokenizer is missing one of ${model.unk_token}, ${CLS_TOKEN}, ${SEP_TOKEN}`,
    );
  }

  const lowercase = normalizer?.lowercase ?? true;
  const options: NormalizerOptions = {
    lowercase,
    // Upstream's default is "strip accents exactly when lowercasing", which is
    // what `strip_accents: null` means in every uncased BERT checkpoint.
    stripAccents: normalizer?.strip_accents ?? lowercase,
    handleChineseChars: normalizer?.handle_chinese_chars ?? true,
    cleanText: normalizer?.clean_text ?? true,
  };
  const prefix = model.continuing_subword_prefix;
  const maxWordChars = model.max_input_chars_per_word;

  return {
    encode(text, maxTokens) {
      const budget = Math.max(2, maxTokens);
      const ids: number[] = [clsId];

      for (const word of preTokenize(normalizeText(text, options))) {
        if (ids.length >= budget - 1) break;
        if (word.length > maxWordChars) {
          ids.push(unknownId);
          continue;
        }
        // Greedy longest-match-first, left to right. A word with no valid split
        // contributes a single `[UNK]`, not a partial decomposition.
        const pieces: number[] = [];
        let start = 0;
        let ok = true;
        while (start < word.length) {
          let end = word.length;
          let match: number | undefined;
          while (start < end) {
            const piece = start > 0 ? `${prefix}${word.slice(start, end)}` : word.slice(start, end);
            match = vocab.get(piece);
            if (match !== undefined) break;
            end -= 1;
          }
          if (match === undefined) {
            ok = false;
            break;
          }
          pieces.push(match);
          start = end;
        }
        if (!ok) {
          ids.push(unknownId);
          continue;
        }
        for (const piece of pieces) ids.push(piece);
      }

      const capped = ids.length > budget - 1 ? ids.slice(0, budget - 1) : ids;
      capped.push(sepId);
      return capped;
    },
  };
}
