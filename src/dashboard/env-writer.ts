import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const ENV_PATH = join(process.cwd(), ".env");

const ALLOWED_KEYS = new Set([
  "FISH_AUDIO_VOICE_ID",
  "FACE_REFERENCE_URL",
  "DEFAULT_VOICE_SPEED",
  "DEFAULT_VOICE_TEMP",
]);

export async function readEnv(): Promise<Record<string, string>> {
  const raw = await readFile(ENV_PATH, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

export async function writeEnvFields(updates: Record<string, string>): Promise<void> {
  for (const k of Object.keys(updates)) {
    if (!ALLOWED_KEYS.has(k)) {
      throw new Error(`Refusing to write disallowed env key: ${k}`);
    }
  }
  const raw = await readFile(ENV_PATH, "utf8");
  const lines = raw.split(/\r?\n/);
  const remaining = new Set(Object.keys(updates));

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      remaining.delete(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const key of remaining) {
    newLines.push(`${key}=${updates[key]}`);
  }

  await writeFile(ENV_PATH, newLines.join("\n"), "utf8");

  // Update in-memory process.env so subsequent service calls see it
  for (const [k, v] of Object.entries(updates)) {
    process.env[k] = v;
  }
}

export function redactedEnv(env: Record<string, string>): Record<string, string> {
  const redactKeys = [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FISH_AUDIO_API_KEY",
    "FAL_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "SLACK_WEBHOOK_URL",
    "TELEGRAM_BOT_TOKEN",
    "META_ACCESS_TOKEN",
    "HYROS_API_KEY",
  ];
  const out = { ...env };
  for (const k of redactKeys) {
    if (out[k]) {
      const v = out[k];
      out[k] = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "***";
    }
  }
  return out;
}
