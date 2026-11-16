import { z } from "zod";

export const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export interface CardImage {
  data: Buffer;
  mediaType: ImageMediaType;
}

/** Limite de l'API pour une image envoyée en base64. Les photos doivent être réduites avant envoi (PWA : canvas → JPEG). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Ce que le modèle lit sur la photo. Uniquement de la transcription : le rapprochement avec le
 * catalogue est fait ensuite par `findCandidates`, de façon déterministe et auditable.
 */
export const CardReadingSchema = z.object({
  card_detected: z.boolean().describe("A single Pokémon TCG card is visible in the photo."),
  name: z.string().nullable().describe("Card name exactly as printed, without HP or stage. null if unreadable."),
  collector_number: z
    .string()
    .nullable()
    .describe('Collector number exactly as printed, including the total if present, e.g. "136/189", "TG05/TG30", "SWSH050". null if unreadable.'),
  set_code: z
    .string()
    .nullable()
    .describe('Printed set abbreviation next to the collector number, e.g. "PAR", "DAA". Not the regulation mark letter. null if absent or unreadable.'),
  language: z
    .enum(["fr", "en", "de", "it", "es", "pt", "nl", "ja", "ko", "zh", "other"])
    .nullable()
    .describe("Language of the card text. null if it cannot be determined."),
  finish_hint: z
    .enum(["normal", "holo", "reverse", "unknown"])
    .describe("holo: foil artwork only; reverse: foil card body outside the artwork; unknown if the photo does not show it reliably."),
  first_edition_stamp: z.boolean().describe('A "1st Edition" / "Édition 1" stamp is visible.'),
  name_legibility: z.enum(["clear", "partial", "unreadable"]),
  number_legibility: z.enum(["clear", "partial", "unreadable"]),
  notes: z.string().nullable().describe("Anything that makes the reading doubtful (glare, sleeve, crop, damage, not a card). null otherwise."),
});

export type CardReadingRaw = z.infer<typeof CardReadingSchema>;

export interface RecognitionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Estimation à partir du barème configuré ; null si le modèle n'y figure pas. */
  costUsd: number | null;
}

export interface Recognition {
  reading: CardReadingRaw;
  model: string;
  /** Modèle ayant effectivement répondu (différent de `model` si un repli serveur a eu lieu). */
  servedBy: string;
  usage: RecognitionUsage;
  latencyMs: number;
}

export interface CardRecognizer {
  recognize(image: CardImage): Promise<Recognition>;
}

export class RecognitionError extends Error {
  constructor(
    public readonly code: "IMAGE_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "REFUSED" | "TRUNCATED" | "UNPARSEABLE",
    message: string,
  ) {
    super(message);
    this.name = "RecognitionError";
  }
}

export function assertSupportedImage(image: CardImage): void {
  if (!SUPPORTED_MEDIA_TYPES.includes(image.mediaType)) {
    throw new RecognitionError("UNSUPPORTED_MEDIA_TYPE", `unsupported media type ${image.mediaType}`);
  }
  if (image.data.byteLength > MAX_IMAGE_BYTES) {
    throw new RecognitionError(
      "IMAGE_TOO_LARGE",
      `image is ${(image.data.byteLength / 1024 / 1024).toFixed(1)} MB; resize to under 5 MB before scanning`,
    );
  }
}

export function mediaTypeFromPath(path: string): ImageMediaType | null {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return null;
  }
}
