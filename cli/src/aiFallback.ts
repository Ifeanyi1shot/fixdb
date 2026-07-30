import Anthropic from "@anthropic-ai/sdk";

export interface AIDiagnosis {
  cause: string;
  fix: string;
  confirmed: false;
}

/**
 * Called only when no knowledge base match is found (see PRD FR-6).
 * Requires ANTHROPIC_API_KEY to be set in the environment.
 */
export async function getAIDiagnosis(
  rawError: string,
  tool: string
): Promise<AIDiagnosis> {
  const client = new Anthropic();

  const prompt = `You are helping a DevOps engineer diagnose an infrastructure error.

Tool: ${tool}
Raw error:
"""
${rawError}
"""

Respond ONLY with a JSON object in this exact shape, no markdown fences, no preamble:
{"cause": "plain-language root cause, 1-3 sentences", "fix": "plain-language fix, include exact commands if applicable"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";

  return parseDiagnosisResponse(raw);
}

const UNPARSEABLE_DIAGNOSIS: AIDiagnosis = {
  cause: "Unable to parse an AI diagnosis for this error.",
  fix: "Try searching the error text manually, or open an issue on the fixdb repo.",
  confirmed: false,
};

/**
 * Parses the raw text response from the AI fallback call into a diagnosis.
 * Pulled out as a pure function so the parsing/fallback behavior can be
 * verified without making a live API call.
 */
export function parseDiagnosisResponse(raw: string): AIDiagnosis {
  try {
    const parsed = JSON.parse(raw.trim());
    if (!parsed.cause || !parsed.fix) {
      return UNPARSEABLE_DIAGNOSIS;
    }
    return { cause: parsed.cause, fix: parsed.fix, confirmed: false };
  } catch {
    return UNPARSEABLE_DIAGNOSIS;
  }
}
