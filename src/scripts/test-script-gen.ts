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
- Specific numbers over vague claims ("eight thousand four hundred dollars" not "a lot of money").
- Proactively handle objections inside the script before the viewer raises them.
- Light self-deprecation; never arrogant.

STRUCTURAL FRAMEWORK (30-second ad)
- Hook (0-3s): stop the scroll.
- Problem (3-8s): name the pain the viewer feels right now.
- Pivot (8-12s): introduce rental arbitrage / the alternative path.
- Proof (12-22s): concrete numbers, timeline, or mechanism.
- CTA (22-30s): free training, link in bio, no catch.

FISH AUDIO EMOTION TAGS
Insert inline, lowercase, in square brackets, before the clause they modify. Available tags: [excited], [serious], [warm], [confident], [casual], [whisper], [laugh], [sigh]. Use them naturally — not every sentence needs one.

SPOKEN DELIVERY RULES
- Write for the ear, not the page. Short declarative sentences and fragments beat long compound sentences.
- Use [pause] tags to add breath points and emphasis beats. Aim for 1 pause per 8-15 words. More at emotional pivots.
- Use em-dashes (—) for dramatic before-and-after pauses. Use commas for small breaths. Periods for harder stops.
- Sentence fragments are encouraged: "Not own. Rent." reads more naturally spoken than "I don't own it; I rent it."
- Avoid subordinate clauses that force the listener to hold multiple ideas at once. Break them into separate sentences.
- Emotion tags at section boundaries; pause tags at rhythmic beats. They serve different purposes.

PACING
- Base rate: 140 words per minute (Fish Audio S2 Pro). Each [pause] adds ~0.3s of dead air on top.
- est_duration_secs = (word_count / 140 * 60) + (pause_count * 0.3), rounded to 1 decimal.
- 15-second ad: 25-35 words, 2-4 pauses.
- 30-second ad: 55-65 words, 5-8 pauses (pauses eat duration — don't pack more words).
- 45-second ad: 85-95 words, 8-12 pauses.
- word_count refers to script_plain, excluding emotion and pause tags.

OUTPUT FORMAT
Return a JSON array of script objects. Each object has exactly these fields:
{
  "angle": string,
  "hook_type": string,
  "script_tagged": string,        // full script WITH [emotion] and [pause] tags inline
  "script_plain": string,         // same script, all tags stripped
  "word_count": number,           // word count of script_plain
  "est_duration_secs": number,    // (word_count / 140 * 60) + (pause_count * 0.3), 1 decimal
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

const USER_PROMPT = `Generate 3 script variations for angle: 'pricing mistakes that cost hosts bookings'. Hook style: curiosity. Target: 30 seconds. Return a JSON array of 3 scripts.`;

function stripJsonFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return s.trim();
}

interface Section {
  name: string;
  start_sec: number;
  end_sec: number;
  text: string;
}
interface Script {
  angle: string;
  hook_type: string;
  script_tagged: string;
  script_plain: string;
  word_count: number;
  est_duration_secs: number;
  sections: Section[];
}

function countPauses(tagged: string): number {
  return (tagged.match(/\[pause\]/gi) || []).length;
}

async function main() {
  if (!config.anthropicApiKey || config.anthropicApiKey.startsWith("PLACEHOLDER")) {
    console.error("ANTHROPIC_API_KEY is not set in .env (currently placeholder).");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  console.log(`Calling ${MODEL}...`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_PROMPT }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text block in response");
  }
  const raw = textBlock.text;
  const cleaned = stripJsonFences(raw);

  let scripts: Script[];
  try {
    scripts = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse JSON. Raw output:\n", raw);
    throw e;
  }

  if (!Array.isArray(scripts)) {
    throw new Error("Expected JSON array, got: " + typeof scripts);
  }

  scripts.forEach((s, i) => {
    const pauses = countPauses(s.script_tagged);
    const baseDur = (s.word_count / 140) * 60;
    const pauseDur = pauses * 0.3;
    const computedDur = Math.round((baseDur + pauseDur) * 10) / 10;
    console.log(`\n${"=".repeat(72)}`);
    console.log(`SCRIPT ${i + 1} — angle: ${s.angle} | hook_type: ${s.hook_type}`);
    console.log(
      `word_count: ${s.word_count} | pauses: ${pauses} | ` +
      `base: ${baseDur.toFixed(1)}s + pauses: ${pauseDur.toFixed(1)}s = ${computedDur}s ` +
      `(model reported: ${s.est_duration_secs}s)`
    );
    console.log("-".repeat(72));
    console.log(s.script_tagged);
  });

  const avgWords = scripts.reduce((a, s) => a + s.word_count, 0) / scripts.length;
  const allInRange = scripts.every(
    (s) => s.est_duration_secs >= 27 && s.est_duration_secs <= 33
  );

  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `${scripts.length} scripts generated, avg word count ${avgWords.toFixed(1)}, all within target duration: ${allInRange ? "YES" : "NO"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
