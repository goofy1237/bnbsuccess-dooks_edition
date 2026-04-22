-- ============================================================================
-- BNB SUCCESS — CREATIVE ASSET LIBRARY
-- Supabase Migration for AI UGC Pipeline
-- ============================================================================
-- This schema gives Ava (the AI agent) a structured understanding of:
--   1. What content assets exist and where they live
--   2. What each production format requires as inputs
--   3. How to trigger and track production jobs
--   4. Brand guidelines and voice/face references
-- ============================================================================

-- UUID generation: use gen_random_uuid() (built-in on newer Supabase)

-- ============================================================================
-- 1. CREATIVE ASSETS — Master inventory of all content
-- ============================================================================
-- Every file Ava might need: source videos, audio clips, scripts, images,
-- screenshots, logos, face/voice references. Files stay in Google Drive;
-- this table is the smart index.

CREATE TABLE creative_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What is this asset?
  name            TEXT NOT NULL,                    -- Human-readable name
  description     TEXT,                             -- What's in this asset, context
  asset_type      TEXT NOT NULL CHECK (asset_type IN (
    'source_video',      -- Raw video of someone talking (Jordan, Ava, testimonials)
    'audio_clip',        -- Extracted or standalone audio
    'script',            -- Written script text (stored in script_text field)
    'image',             -- Photos, headshots, product shots
    'screenshot',        -- App screenshots, booking dashboards, income proof
    'logo',              -- Brand logos and marks
    'b_roll',            -- Supplementary footage (properties, lifestyle)
    'face_reference',    -- Face clone reference video for lip sync
    'voice_reference',   -- Voice clone reference audio for Fish Audio
    'finished_ad',       -- Completed ad output from the pipeline
    'template',          -- Editing template (ffmpeg, CapCut project)
    'other'
  )),

  -- Where does it live?
  storage_type    TEXT NOT NULL DEFAULT 'google_drive' CHECK (storage_type IN (
    'google_drive',      -- File in Google Drive (most common)
    'supabase_storage',  -- File in Supabase Storage bucket
    'local_mac_mini',    -- File on the Mac Mini filesystem
    'external_url'       -- External URL (CDN, S3, etc.)
  )),
  drive_file_id   TEXT,                             -- Google Drive file ID
  drive_folder_id TEXT,                             -- Google Drive parent folder ID
  storage_path    TEXT,                             -- Supabase Storage path or local path
  external_url    TEXT,                             -- Direct URL if externally hosted

  -- File metadata
  file_type       TEXT,                             -- 'mp4', 'mp3', 'wav', 'jpg', 'png', 'pdf', 'txt'
  file_size_mb    NUMERIC(10,2),
  duration_secs   INTEGER,                          -- For video/audio assets
  resolution      TEXT,                             -- '1080x1920', '1920x1080', etc.

  -- Content metadata
  speaker         TEXT,                             -- Who's in this? 'jordan', 'ava', 'student_testimonial'
  topic_tags      TEXT[],                           -- ['pricing', 'airbnb', 'passive_income', 'mentorship']
  emotion_tags    TEXT[],                           -- ['excited', 'calm', 'authoritative', 'casual']
  hook_type       TEXT,                             -- 'skeptic', 'curiosity', 'result_first', 'challenge'
  script_text     TEXT,                             -- Full script text (for script assets, or transcript of video)

  -- Quality & usage
  quality_score   INTEGER CHECK (quality_score BETWEEN 1 AND 10),  -- Manual rating
  usage_count     INTEGER DEFAULT 0,                -- How many times used in production
  last_used_at    TIMESTAMPTZ,
  is_approved     BOOLEAN DEFAULT false,            -- Approved for production use
  is_archived     BOOLEAN DEFAULT false,            -- Soft delete

  -- Performance (populated after ads run)
  performance     JSONB,                            -- { best_ctr, best_roas, avg_cpm, times_used_in_winners }

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Ava's common lookups
CREATE INDEX idx_assets_type ON creative_assets(asset_type) WHERE NOT is_archived;
CREATE INDEX idx_assets_speaker ON creative_assets(speaker) WHERE NOT is_archived;
CREATE INDEX idx_assets_approved ON creative_assets(is_approved) WHERE NOT is_archived;
CREATE INDEX idx_assets_topics ON creative_assets USING GIN(topic_tags) WHERE NOT is_archived;
CREATE INDEX idx_assets_emotions ON creative_assets USING GIN(emotion_tags) WHERE NOT is_archived;
CREATE INDEX idx_assets_drive ON creative_assets(drive_file_id) WHERE drive_file_id IS NOT NULL;

-- Auto-update timestamp (separate function name to avoid conflict with pipeline's set_updated_at)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_assets_updated
  BEFORE UPDATE ON creative_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. CONTENT TYPES — Registry of ad formats Ava can produce
-- ============================================================================
-- Each row defines a production format: what it is, what inputs it needs,
-- and how it maps to the pipeline stages. When Ava gets a brief like
-- "make a testimonial ad about pricing," she looks up the content type
-- to know exactly what assets to gather and what pipeline to trigger.

CREATE TABLE content_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name            TEXT NOT NULL UNIQUE,              -- 'testimonial_30s', 'result_first_15s', etc.
  display_name    TEXT NOT NULL,                     -- 'Testimonial Ad (30s)'
  description     TEXT NOT NULL,                     -- What this format is and when to use it

  -- Structure
  target_duration INTEGER NOT NULL,                  -- Target seconds
  structure       JSONB NOT NULL,                    -- Ordered sections with timing
  -- Example: [
  --   {"section": "hook", "start_sec": 0, "end_sec": 3, "purpose": "Pattern interrupt"},
  --   {"section": "problem", "start_sec": 3, "end_sec": 8, "purpose": "Relatable pain"},
  --   {"section": "pivot", "start_sec": 8, "end_sec": 12, "purpose": "Introduce solution"},
  --   {"section": "proof", "start_sec": 12, "end_sec": 22, "purpose": "Specific results"},
  --   {"section": "cta", "start_sec": 22, "end_sec": 30, "purpose": "Direct ask"}
  -- ]

  -- What inputs does this format need?
  required_inputs JSONB NOT NULL,                    -- What Ava must gather
  -- Example: {
  --   "script": {"source": "generate", "emotion_tagged": true},
  --   "voice": {"source": "fish_audio", "voice_id": "ava_clone"},
  --   "face": {"source": "asset_lookup", "asset_type": "face_reference", "speaker": "ava"},
  --   "b_roll": {"source": "generate_or_lookup", "types": ["screenshot", "b_roll"], "count": 2},
  --   "music": {"source": "library", "mood": "lo_fi_ambient", "volume_db": -24}
  -- }

  -- Pipeline config
  ffmpeg_template TEXT,                              -- Which ffmpeg template to use
  aspect_ratios   TEXT[] DEFAULT ARRAY['9:16'],      -- Output formats
  platform_targets TEXT[] DEFAULT ARRAY['tiktok', 'meta_reels'],

  -- Usage
  is_active       BOOLEAN DEFAULT true,
  times_produced  INTEGER DEFAULT 0,
  avg_performance JSONB,                             -- Aggregated performance of ads using this type

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_content_types_updated
  BEFORE UPDATE ON content_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. PRODUCTION JOBS — What Ava triggers when asked to make content
-- ============================================================================
-- Each job tracks a single content production run from brief to delivery.
-- Ava creates a job, gathers assets, triggers the pipeline, monitors
-- progress, and delivers the finished output.

CREATE TABLE production_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Brief
  brief           TEXT NOT NULL,                     -- Original request ("make a testimonial ad about pricing")
  content_type_id UUID REFERENCES content_types(id),
  angle           TEXT,                              -- 'financial_freedom', 'pricing_strategy', 'passive_income'
  hook_type       TEXT,                              -- 'skeptic', 'curiosity', 'result_first'
  target_audience TEXT,                              -- 'aspiring_hosts', 'experienced_hosts', 'investors'

  -- Script
  script_plain    TEXT,                              -- Clean script without tags
  script_tagged   TEXT,                              -- Script with Fish Audio emotion tags
  script_source   TEXT CHECK (script_source IN (
    'generated',         -- Claude generated it
    'adapted',           -- Adapted from existing asset
    'manual'             -- Manually provided
  )),

  -- Pipeline status
  status          TEXT NOT NULL DEFAULT 'briefed' CHECK (status IN (
    'briefed',           -- Job created, brief parsed
    'scripted',          -- Script generated/selected
    'approved',          -- Script approved (if not auto-approve)
    'voice_generating',  -- Fish Audio processing
    'voice_done',        -- Audio file ready
    'lipsync_generating',-- Kling processing
    'lipsync_done',      -- Talking head video ready
    'broll_generating',  -- Seedance/Sora processing
    'broll_done',        -- B-roll clips ready
    'assembling',        -- ffmpeg stitching
    'qa_check',          -- Automated QA running
    'complete',          -- Finished, ready for delivery
    'delivered',         -- Sent back to requester
    'failed',            -- Something broke
    'cancelled'
  )),

  -- Asset references (populated as pipeline progresses)
  voice_asset_id    UUID REFERENCES creative_assets(id),   -- Fish Audio output
  lipsync_asset_id  UUID REFERENCES creative_assets(id),   -- Kling output
  broll_asset_ids   UUID[],                                -- B-roll clips used
  finished_asset_id UUID REFERENCES creative_assets(id),   -- Final assembled ad

  -- Source assets used (what Ava pulled from the library)
  source_asset_ids  UUID[],                          -- IDs of assets used as inputs/references

  -- Pipeline metadata
  pipeline_config   JSONB,                           -- Runtime config: voice_id, face_ref, ffmpeg_template
  error_log         TEXT,                            -- Error details if failed
  retry_count       INTEGER DEFAULT 0,

  -- Delivery
  requested_by      TEXT DEFAULT 'ava_telegram',     -- Who asked for this
  delivered_to      TEXT,                            -- Where it was sent ('telegram', 'slack', 'drive')
  delivered_at      TIMESTAMPTZ,

  -- Timing
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status ON production_jobs(status);
CREATE INDEX idx_jobs_content_type ON production_jobs(content_type_id);
CREATE INDEX idx_jobs_created ON production_jobs(created_at DESC);

CREATE TRIGGER trg_jobs_updated
  BEFORE UPDATE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 4. BRAND CONFIG — Brand guidelines Ava follows
-- ============================================================================
-- Single-row table with all brand configuration. Ava references this
-- for every production decision.

CREATE TABLE brand_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name      TEXT NOT NULL DEFAULT 'BNB Success',
  tagline         TEXT DEFAULT 'Your Airbnb Mentorship',

  -- Voice & tone
  brand_voice     JSONB NOT NULL DEFAULT '{
    "personality": ["approachable", "knowledgeable", "results-focused", "Australian"],
    "tone_spectrum": {"casual": 0.7, "professional": 0.3},
    "language_notes": "Australian English. Conversational, first-person. Use contractions. Avoid corporate jargon. Say things like a friend would over coffee.",
    "forbidden_phrases": ["revolutionary", "game-changing", "unlock your potential", "passive income made easy"],
    "preferred_phrases": ["here is exactly what I did", "let me show you", "this actually works", "real numbers"]
  }',

  -- Visual identity
  colours         JSONB DEFAULT '{
    "primary": "#1B2A4A",
    "secondary": "#D4A843",
    "accent": "#2A7B88",
    "background": "#F7F5F0"
  }',
  fonts           JSONB DEFAULT '{"heading": "Arial", "body": "Arial", "caption": "Arial Bold"}',

  -- Production defaults
  default_voice_id    TEXT,                          -- Fish Audio cloned voice ID
  default_face_ref_id UUID,                          -- Reference to face_reference asset
  default_music_mood  TEXT DEFAULT 'lo_fi_ambient',
  caption_style       JSONB DEFAULT '{
    "font": "Arial Bold",
    "size": 22,
    "colour": "#FFFFFF",
    "outline_colour": "#000000",
    "outline_width": 2,
    "position": "bottom_third",
    "style": "word_by_word"
  }',

  -- Targets
  target_platforms    TEXT[] DEFAULT ARRAY['tiktok', 'meta_reels', 'meta_feed', 'youtube_shorts'],
  target_audience     JSONB DEFAULT '{
    "primary": "Aspiring Airbnb hosts aged 25-45 who want passive income but dont know where to start",
    "secondary": "Existing hosts who want to optimise revenue and occupancy",
    "pain_points": ["dont know how to start", "scared of losing money", "overwhelmed by regulations", "cant get bookings", "pricing confusion"],
    "desires": ["passive income", "financial freedom", "quit 9-5", "location independence", "wealth building"]
  }',

  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_brand_updated
  BEFORE UPDATE ON brand_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 5. ASSET COLLECTIONS — Group related assets together
-- ============================================================================
-- Allows Ava to grab a whole set of related assets at once.
-- E.g., "Jordan pricing series" = 5 videos + 3 scripts about pricing.

CREATE TABLE asset_collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                     -- 'Jordan pricing series', 'Student testimonials batch 1'
  description     TEXT,
  topic_tags      TEXT[],
  asset_ids       UUID[],                            -- References to creative_assets
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collections_topics ON asset_collections USING GIN(topic_tags);

-- ============================================================================
-- 6. DRIVE SYNC LOG — Track what's been indexed from Google Drive
-- ============================================================================
-- Prevents re-indexing the same files and tracks sync status.

CREATE TABLE drive_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_file_id   TEXT NOT NULL UNIQUE,
  drive_file_name TEXT NOT NULL,
  drive_folder_id TEXT,
  drive_folder_path TEXT,                            -- '/UGC Content/Raw Videos/Jordan'
  mime_type       TEXT,
  file_size_bytes BIGINT,

  -- Processing status
  sync_status     TEXT DEFAULT 'indexed' CHECK (sync_status IN (
    'indexed',           -- File found and logged
    'transcribed',       -- Audio/video transcribed via Whisper
    'tagged',            -- Tags generated by Claude
    'asset_created',     -- creative_assets row created
    'skipped',           -- Not relevant, skipped
    'error'              -- Processing failed
  )),
  asset_id        UUID REFERENCES creative_assets(id),  -- Link to created asset
  transcript      TEXT,                              -- Whisper transcript if applicable
  error_message   TEXT,

  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX idx_sync_drive_id ON drive_sync_log(drive_file_id);
CREATE INDEX idx_sync_status ON drive_sync_log(sync_status);

-- ============================================================================
-- SEED DATA: Content Types
-- ============================================================================

INSERT INTO content_types (name, display_name, description, target_duration, structure, required_inputs, ffmpeg_template, aspect_ratios, platform_targets) VALUES

('testimonial_30s', 'Testimonial Ad (30s)',
 'Classic UGC testimonial: skeptic turned believer sharing their journey and results. Best for warm audiences and retargeting.',
 30,
 '[
   {"section": "hook", "start_sec": 0, "end_sec": 3, "purpose": "Pattern interrupt — skepticism or surprising result"},
   {"section": "problem", "start_sec": 3, "end_sec": 8, "purpose": "Relatable pain point the audience feels"},
   {"section": "pivot", "start_sec": 8, "end_sec": 12, "purpose": "Discovery of the solution"},
   {"section": "proof", "start_sec": 12, "end_sec": 22, "purpose": "Specific, tangible results with numbers"},
   {"section": "cta", "start_sec": 22, "end_sec": 30, "purpose": "Clear, direct call to action"}
 ]'::jsonb,
 '{
   "script": {"source": "generate", "emotion_tagged": true, "word_count_target": 85},
   "voice": {"source": "fish_audio", "clone_id": "default"},
   "face": {"source": "asset_lookup", "asset_type": "face_reference"},
   "b_roll": {"source": "generate_or_lookup", "types": ["screenshot", "b_roll"], "count": 2, "insert_at": ["proof"]},
   "captions": {"source": "auto_whisper", "style": "word_by_word"},
   "music": {"source": "library", "mood": "lo_fi_ambient", "volume_db": -24}
 }'::jsonb,
 'testimonial_30s',
 ARRAY['9:16', '1:1'],
 ARRAY['tiktok', 'meta_reels', 'meta_feed']
),

('result_first_15s', 'Result-First Hook (15s)',
 'Lead with the result to stop the scroll, then quickly explain how. Best for cold audiences and prospecting.',
 15,
 '[
   {"section": "result", "start_sec": 0, "end_sec": 5, "purpose": "Lead with the money shot — specific impressive result"},
   {"section": "how", "start_sec": 5, "end_sec": 11, "purpose": "Quick explanation of how it happened"},
   {"section": "cta", "start_sec": 11, "end_sec": 15, "purpose": "Urgent call to action"}
 ]'::jsonb,
 '{
   "script": {"source": "generate", "emotion_tagged": true, "word_count_target": 40},
   "voice": {"source": "fish_audio", "clone_id": "default"},
   "face": {"source": "asset_lookup", "asset_type": "face_reference"},
   "b_roll": {"source": "generate_or_lookup", "types": ["screenshot"], "count": 1, "insert_at": ["result"]},
   "captions": {"source": "auto_whisper", "style": "word_by_word"},
   "music": {"source": "library", "mood": "upbeat_energy", "volume_db": -24}
 }'::jsonb,
 'result_first_15s',
 ARRAY['9:16'],
 ARRAY['tiktok', 'meta_reels']
),

('storytime_45s', 'Story Time Ad (45s)',
 'Longer narrative format: personal story arc with emotional journey. Best for building connection and trust.',
 45,
 '[
   {"section": "hook", "start_sec": 0, "end_sec": 4, "purpose": "Curiosity hook that starts the story"},
   {"section": "backstory", "start_sec": 4, "end_sec": 12, "purpose": "Where you were before — struggle, doubt"},
   {"section": "turning_point", "start_sec": 12, "end_sec": 20, "purpose": "The moment everything changed"},
   {"section": "transformation", "start_sec": 20, "end_sec": 32, "purpose": "Results and how life is different now"},
   {"section": "lesson", "start_sec": 32, "end_sec": 38, "purpose": "Key takeaway for the viewer"},
   {"section": "cta", "start_sec": 38, "end_sec": 45, "purpose": "Invitation to take the same path"}
 ]'::jsonb,
 '{
   "script": {"source": "generate", "emotion_tagged": true, "word_count_target": 130},
   "voice": {"source": "fish_audio", "clone_id": "default"},
   "face": {"source": "asset_lookup", "asset_type": "face_reference"},
   "b_roll": {"source": "generate_or_lookup", "types": ["b_roll", "screenshot"], "count": 3, "insert_at": ["backstory", "transformation"]},
   "captions": {"source": "auto_whisper", "style": "word_by_word"},
   "music": {"source": "library", "mood": "emotional_build", "volume_db": -22}
 }'::jsonb,
 'storytime_45s',
 ARRAY['9:16', '1:1'],
 ARRAY['tiktok', 'meta_reels', 'meta_feed']
),

('listicle_30s', 'Listicle Ad (30s)',
 'Three-point format: hook + 3 quick tips/reasons + CTA. Best for educational content and value-first prospecting.',
 30,
 '[
   {"section": "hook", "start_sec": 0, "end_sec": 4, "purpose": "Curiosity hook with a number — 3 things, 3 mistakes, etc."},
   {"section": "point_1", "start_sec": 4, "end_sec": 10, "purpose": "First point with quick proof"},
   {"section": "point_2", "start_sec": 10, "end_sec": 16, "purpose": "Second point with quick proof"},
   {"section": "point_3", "start_sec": 16, "end_sec": 24, "purpose": "Third point — strongest, most compelling"},
   {"section": "cta", "start_sec": 24, "end_sec": 30, "purpose": "Call to action tied to the list theme"}
 ]'::jsonb,
 '{
   "script": {"source": "generate", "emotion_tagged": true, "word_count_target": 85},
   "voice": {"source": "fish_audio", "clone_id": "default"},
   "face": {"source": "asset_lookup", "asset_type": "face_reference"},
   "b_roll": {"source": "generate_or_lookup", "types": ["screenshot", "b_roll"], "count": 3, "insert_at": ["point_1", "point_2", "point_3"]},
   "captions": {"source": "auto_whisper", "style": "word_by_word"},
   "music": {"source": "library", "mood": "lo_fi_ambient", "volume_db": -24}
 }'::jsonb,
 'listicle_30s',
 ARRAY['9:16'],
 ARRAY['tiktok', 'meta_reels']
),

('webinar_promo_30s', 'Webinar Registration Ad (30s)',
 'Drives webinar sign-ups. Urgency-focused with clear value prop and registration CTA.',
 30,
 '[
   {"section": "hook", "start_sec": 0, "end_sec": 4, "purpose": "Attention grab — what they will learn"},
   {"section": "value_prop", "start_sec": 4, "end_sec": 14, "purpose": "What the webinar covers and why it matters"},
   {"section": "social_proof", "start_sec": 14, "end_sec": 20, "purpose": "Past results, attendee count, testimonial"},
   {"section": "urgency_cta", "start_sec": 20, "end_sec": 30, "purpose": "Limited spots, date, register now"}
 ]'::jsonb,
 '{
   "script": {"source": "generate", "emotion_tagged": true, "word_count_target": 85},
   "voice": {"source": "fish_audio", "clone_id": "default"},
   "face": {"source": "asset_lookup", "asset_type": "face_reference"},
   "b_roll": {"source": "generate_or_lookup", "types": ["screenshot"], "count": 1, "insert_at": ["social_proof"]},
   "captions": {"source": "auto_whisper", "style": "word_by_word"},
   "music": {"source": "library", "mood": "upbeat_energy", "volume_db": -22}
 }'::jsonb,
 'webinar_promo_30s',
 ARRAY['9:16', '1:1'],
 ARRAY['tiktok', 'meta_reels', 'meta_feed']
);

-- ============================================================================
-- SEED DATA: Brand Config (single row)
-- ============================================================================

INSERT INTO brand_config (brand_name, tagline) VALUES ('BNB Success', 'Your Short-Term Rental Mentorship');

-- ============================================================================
-- SEED DATA: Example source assets from Jordan's Drive folder
-- ============================================================================
-- These are placeholder rows — the Drive ingestion process will populate
-- real entries with actual Drive file IDs and transcripts.

INSERT INTO creative_assets (name, asset_type, storage_type, drive_folder_id, speaker, topic_tags, is_approved, description) VALUES
('Jordan - Premade Content Folder', 'source_video', 'google_drive', '1bVEUjzHKPq40ez7KOB7-EzlrkuQce_8S', 'jordan',
 ARRAY['general', 'mentorship', 'airbnb'], true,
 'Master folder of premade Jordan content — videos with audio of Jordan delivering scripts and talking points relevant to BNB Success marketing.');

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE creative_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_sync_log ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for Ava / pipeline)
CREATE POLICY "Service role full access" ON creative_assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON content_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON production_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON brand_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON asset_collections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON drive_sync_log FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- HELPER VIEWS — Common queries Ava will run
-- ============================================================================

-- All approved, non-archived assets with their key info
CREATE VIEW v_available_assets AS
SELECT id, name, asset_type, speaker, topic_tags, emotion_tags, hook_type,
       duration_secs, quality_score, usage_count, drive_file_id, storage_path,
       external_url, file_type, description
FROM creative_assets
WHERE is_approved = true AND is_archived = false;

-- Active production jobs with content type info
CREATE VIEW v_active_jobs AS
SELECT j.*, ct.display_name as content_type_name, ct.target_duration,
       ct.ffmpeg_template, ct.required_inputs
FROM production_jobs j
LEFT JOIN content_types ct ON j.content_type_id = ct.id
WHERE j.status NOT IN ('complete', 'delivered', 'failed', 'cancelled')
ORDER BY j.created_at DESC;

-- Asset search by topic (what Ava uses most)
CREATE OR REPLACE FUNCTION search_assets(
  p_asset_type TEXT DEFAULT NULL,
  p_speaker TEXT DEFAULT NULL,
  p_topics TEXT[] DEFAULT NULL,
  p_emotions TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF creative_assets AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM creative_assets
  WHERE is_approved = true
    AND is_archived = false
    AND (p_asset_type IS NULL OR asset_type = p_asset_type)
    AND (p_speaker IS NULL OR speaker = p_speaker)
    AND (p_topics IS NULL OR topic_tags && p_topics)
    AND (p_emotions IS NULL OR emotion_tags && p_emotions)
  ORDER BY quality_score DESC NULLS LAST, usage_count ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
