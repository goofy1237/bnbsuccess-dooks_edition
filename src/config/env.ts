import 'dotenv/config';

export interface Config {
  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;

  // Fish Audio (TTS)
  fishAudioApiKey: string;
  fishAudioVoiceId: string;

  // fal.ai (video generation)
  falKey: string;

  // Anthropic
  anthropicApiKey: string;

  // OpenAI
  openaiApiKey: string;

  // Slack notifications
  slackWebhookUrl: string;
  slackChannel: string;

  // Telegram notifications
  telegramBotToken: string;
  telegramChatId: string;

  // Meta Ads
  metaAccessToken: string;
  metaAdAccountId: string;

  // Hyros
  hyrosApiKey: string;

  // Assets
  faceReferenceUrl: string;

  // Voice defaults
  defaultVoiceSpeed: number;
  defaultVoiceTemp: number;
  targetWpm: number;
}

function env(key: string, fallback?: string): string {
  return process.env[key] ?? fallback ?? '';
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number, got "${raw}"`);
  }
  return parsed;
}

export const config: Config = {
  // Supabase
  supabaseUrl: env('SUPABASE_URL'),
  supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),

  // Fish Audio
  fishAudioApiKey: env('FISH_AUDIO_API_KEY'),
  fishAudioVoiceId: env('FISH_AUDIO_VOICE_ID'),

  // fal.ai
  falKey: env('FAL_KEY'),

  // Anthropic
  anthropicApiKey: env('ANTHROPIC_API_KEY'),

  // OpenAI
  openaiApiKey: env('OPENAI_API_KEY'),

  // Slack
  slackWebhookUrl: env('SLACK_WEBHOOK_URL'),
  slackChannel: env('SLACK_CHANNEL', '#ugc-pipeline'),

  // Telegram
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  telegramChatId: env('TELEGRAM_CHAT_ID'),

  // Meta
  metaAccessToken: env('META_ACCESS_TOKEN'),
  metaAdAccountId: env('META_AD_ACCOUNT_ID'),

  // Hyros
  hyrosApiKey: env('HYROS_API_KEY'),

  // Assets
  faceReferenceUrl: env('FACE_REFERENCE_URL'),

  // Voice defaults
  defaultVoiceSpeed: envNumber('DEFAULT_VOICE_SPEED', 0.95),
  defaultVoiceTemp: envNumber('DEFAULT_VOICE_TEMP', 0.8),
  targetWpm: envNumber('TARGET_WPM', 140),
};

/**
 * Validates that all required environment variables are set.
 * Call this at application startup to fail fast with clear errors.
 */
export function validateConfig(): void {
  const required: Array<{ key: string; value: string; label: string }> = [
    { key: 'SUPABASE_URL', value: config.supabaseUrl, label: 'Supabase URL' },
    { key: 'SUPABASE_ANON_KEY', value: config.supabaseAnonKey, label: 'Supabase anon key' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', value: config.supabaseServiceRoleKey, label: 'Supabase service role key' },
    { key: 'FISH_AUDIO_API_KEY', value: config.fishAudioApiKey, label: 'Fish Audio API key' },
    { key: 'FISH_AUDIO_VOICE_ID', value: config.fishAudioVoiceId, label: 'Fish Audio voice ID' },
    { key: 'FAL_KEY', value: config.falKey, label: 'fal.ai API key' },
    { key: 'ANTHROPIC_API_KEY', value: config.anthropicApiKey, label: 'Anthropic API key' },
    { key: 'OPENAI_API_KEY', value: config.openaiApiKey, label: 'OpenAI API key' },
    { key: 'FACE_REFERENCE_URL', value: config.faceReferenceUrl, label: 'Face reference URL' },
  ];

  const missing = required.filter((r) => !r.value);

  if (missing.length > 0) {
    const details = missing
      .map((r) => `  - ${r.key} (${r.label})`)
      .join('\n');
    throw new Error(
      `Missing required environment variables:\n${details}\n\nAdd them to your .env file or export them before running the pipeline.`,
    );
  }
}
