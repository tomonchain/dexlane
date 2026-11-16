import { describe, expect, it, vi } from "vitest";
import { RecognitionError, createClaudeRecognizer, type CardReadingRaw } from "../src";

const reading: CardReadingRaw = {
  card_detected: true, name: "Fouinar", collector_number: "136/189", set_code: "DAA", language: "fr",
  finish_hint: "reverse", first_edition_stamp: false, name_legibility: "clear", number_legibility: "clear", notes: null,
};

function fakeClient(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    stop_details: null,
    parsed_output: reading,
    usage: { input_tokens: 1500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...response,
  });
  return { client: { beta: { messages: { parse } } } as never, parse };
}

const image = { data: Buffer.from("fake-jpeg"), mediaType: "image/jpeg" as const };

describe("createClaudeRecognizer", () => {
  it("sends the image with structured output, adaptive defaults and server-side fallbacks", async () => {
    const { client, parse } = fakeClient({});
    await createClaudeRecognizer({ client }).recognize(image);

    const req = parse.mock.calls[0]![0];
    expect(req).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
    });
    expect(req.thinking).toBeUndefined(); // toujours actif sur Opus 5.5 ; le désactiver renvoie une 400
    expect(req.output_config.format).toBeDefined();
    const [img, text] = req.messages[0].content;
    expect(img).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.data.toString("base64") } });
    expect(text.type).toBe("text");
  });

  it("returns the reading with usage and estimated cost", async () => {
    const { client } = fakeClient({});
    const r = await createClaudeRecognizer({ client }).recognize(image);
    expect(r.reading).toEqual(reading);
    expect(r.usage).toEqual({ inputTokens: 1500, outputTokens: 300, costUsd: (1500 * 4 + 300 * 20) / 1e6 });
    expect(r.servedBy).toBe("claude-opus-5-5");
  });

  it("reports which model served the request after a fallback", async () => {
    const { client } = fakeClient({ model: "claude-opus-4-8" });
    const r = await createClaudeRecognizer({ client }).recognize(image);
    expect(r).toMatchObject({ model: "claude-opus-5-5", servedBy: "claude-opus-4-8" });
  });

  it.each([
    [{ stop_reason: "refusal", stop_details: { category: "cyber" } }, "REFUSED"],
    [{ stop_reason: "max_tokens" }, "TRUNCATED"],
    [{ parsed_output: null }, "UNPARSEABLE"],
  ])("raises a typed error (%j)", async (response, code) => {
    const { client } = fakeClient(response);
    await expect(createClaudeRecognizer({ client }).recognize(image)).rejects.toMatchObject({ code });
  });

  it("rejects oversized or unsupported images before calling the API", async () => {
    const { client, parse } = fakeClient({});
    const rec = createClaudeRecognizer({ client });
    await expect(rec.recognize({ data: Buffer.alloc(6 * 1024 * 1024), mediaType: "image/jpeg" })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    await expect(rec.recognize({ data: Buffer.from("x"), mediaType: "image/heic" as never })).rejects.toBeInstanceOf(RecognitionError);
    expect(parse).not.toHaveBeenCalled();
  });
});
