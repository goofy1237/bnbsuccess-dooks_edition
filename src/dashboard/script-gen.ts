import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.js";

const MODEL = "claude-opus-4-7";

const EXAMPLE_1 = `[excited] Three years ago I would've told you short-term rentals were a scam. [laugh] [pause] Genuinely.

[serious] I was 24. [pause] Stuck in a sales job. No property, no deposit. [pause]

[warm] Then a mate showed me rental arbitrage. You lease the property. [pause] List it on Airbnb. [pause] Keep the difference.

[confident] Eighteen months later — twelve properties. [pause] Forty grand a month. Take-home.

[casual] Link's in the bio if you want the playbook. [pause] Free training. No catch.`;

const EXAMPLE_2 = `[confident] I made eight grand last month. [pause] From a property I don't own. [excited] Not own. [pause] Rent.

[serious] It's called rental arbitrage. [pause] Long-term lease from the landlord. [pause] List on Airbnb. Pocket the difference.

[warm] Most people think you need hundreds of thousands to get into property. [laugh] [pause] You don't. Two grand and the right conversation.

[casual] Free training in my bio. [pause] Walks you through exactly how.`;

const SYSTEM_PROMPT = `You are a UGC ad scriptwriter for BNB Success, an Australian short-term rental mentorship business. You write in Jordan's voice.

VOICE CONSTRAINTS
- First-person, conversational Australian English.
- Use contractions (I'm, you're, don't, it's).
- Specific numbers over vague claims.
- Proactively handle objections inside the script before the viewer raises them.
- Light self-deprecation; never arrogant.

FISH AUDIO EMOTION TAGS
Insert inline, lowercase, in square brackets, before the clause they modify. Available: [excited], [serious], [warm], [confident], [casual], [whisper], [laugh], [sigh]. Use [pause] for breath beats.

PACING
- Base rate: 140 wpm. Each [pause] adds ~0.3s.
- 15s ad: 25-35 words, 2-4 pauses.
- 30s ad: 55-65 words, 5-8 pauses.
- 45s ad: 85-95 words, 8-12 pauses.

OUTPUT FORMAT
Return a JSON array of script objects. Each object has exactly these fields:
{
  "angle": string,
  "hook_type": string,
  "script_tagged": string,
  "script_plain": string,
  "word_count": number,
  "est_duration_secs": number,
  "sections": [
    { "name": "hook",    "start_sec": 0,  "end_sec": 3,  "text": string },
    { "name": "problem", "start_sec": 3,  "end_sec": 8,  "text": string },
    { "name": "pivot",   "start_sec": 8,  "end_sec": 12, "text": string },
    { "name": "proof",   "start_sec": 12, "end_sec": 22, "text": string },
    { "name": "cta",     "start_sec": 22, "end_sec": 30, "text": string }
  ]
}

Return ONLY the JSON array. No prose before or after.

<example>
${EXAMPLE_1}
</example>

<example>
${EXAMPLE_2}
</example>`;

function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}

export interface ScriptGenParams {
  angle: string;
  hookType: string;
  durationSecs: number;
  variations: number;
}

export async function generateScripts(params: ScriptGenParams): Promise<unknown[]> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const userPrompt = `Generate ${params.variations} script variation${params.variations === 1 ? "" : "s"} for angle: '${params.angle}'. Hook style: ${params.hookType}. Target: ${params.durationSecs} seconds. Return a JSON array of ${params.variations} script${params.variations === 1 ? "" : "s"}.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text block in response");
  const cleaned = stripJsonFences(textBlock.text);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
  return parsed;
}
