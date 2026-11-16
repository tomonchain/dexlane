import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  CardReadingSchema,
  RecognitionError,
  assertSupportedImage,
  type CardImage,
  type CardRecognizer,
  type Recognition,
} from "./recognizer";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** USD par million de tokens (entrée, sortie). Barème au 2026-11 ; à tenir à jour, sert uniquement aux estimations. */
export const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

const SYSTEM_PROMPT = `You transcribe photos of Pokémon Trading Card Game cards for an inventory system.

Your output is matched against a card catalog by exact collector number and fuzzy name, so precise transcription matters more than completeness. A wrong value is worse than null: if a field is not clearly legible, set it to null and lower its legibility rating rather than guessing. Never infer the name from the artwork, and never complete a partially visible number from memory.

Where things are printed:
- Name: top left, next to the stage. Transcribe only the name (keep suffixes such as "V", "VMAX", "ex", "-GX" and accents), without HP.
- Collector number: bottom of the card. Modern cards print it bottom left, often after the set abbreviation (e.g. "PAR 136/182") and a boxed regulation mark letter (e.g. "G"); the regulation mark is not part of the set code. Older cards (1999–2003) print it bottom right (e.g. "4/102").
- 1st Edition stamp: a small black stamp at the left edge below the artwork, on vintage cards only.
- Finish: "holo" when only the artwork is foil, "reverse" when the card body outside the artwork is foil. Use "unknown" unless the photo clearly shows the foil.

Language: report the language of the card text (attacks, rules), not of the name alone.`;

/**
 * Vérifie, sans coût, que les identifiants sont résolus et que le modèle existe.
 * À appeler avant un lot (banc d'essai, import) pour échouer tôt.
 */
export async function checkClaudeAccess(model = DEFAULT_MODEL, client: Pick<Anthropic, "models"> = new Anthropic()) {
  await client.models.retrieve(model);
}

export interface ClaudeRecognizerOptions {
  client?: Pick<Anthropic, "beta">;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Lecture de carte par Claude (vision + sortie structurée).
 * Repli serveur activé (`fallbacks: "default"`) : si le modèle décline la requête, l'API la rejoue
 * sur le modèle de repli recommandé au lieu de renvoyer un refus.
 */
export function createClaudeRecognizer(opts: ClaudeRecognizerOptions = {}): CardRecognizer {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const effort = opts.effort ?? "medium";

  return {
    async recognize(image: CardImage): Promise<Recognition> {
      assertSupportedImage(image);
      const started = performance.now();

      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort, format: betaZodOutputFormat(CardReadingSchema) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: image.mediaType, data: image.data.toString("base64") },
              },
              { type: "text", text: "Transcribe this card." },
            ],
          },
        ],
      });

      const latencyMs = Math.round(performance.now() - started);
      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? "unknown";
        throw new RecognitionError("REFUSED", `model declined the request (category: ${category})`);
      }
      if (response.stop_reason === "max_tokens") {
        throw new RecognitionError("TRUNCATED", "response hit max_tokens before completing");
      }
      if (!response.parsed_output) {
        throw new RecognitionError("UNPARSEABLE", "response did not match the expected schema");
      }

      const inputTokens =
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0);
      const outputTokens = response.usage.output_tokens;
      const price = PRICING_USD_PER_MTOK[response.model];
      return {
        reading: response.parsed_output,
        model,
        servedBy: response.model,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null,
        },
        latencyMs,
      };
    },
  };
}
