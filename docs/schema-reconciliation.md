# Schema Reconciliation

Migrations 001 and 003 describe two overlapping worldviews of the same pipeline. This doc maps the overlap and proposes how to resolve it. No SQL is written here.

## 1. Table purpose (one line each)

**Migration 001 — pipeline-stage outputs**
- `competitor_ads` — scraped TikTok/Meta ads for angle/hook inspiration.
- `scripts` — AI-generated ad scripts with status, emotion tags, and lineage.
- `voice_assets` — Fish Audio MP3 render, FK to `scripts`.
- `video_assets` — Kling/LipDub lip-sync MP4, FK to `scripts` + `voice_assets`.
- `broll_assets` — generated B-roll clips, FK to `scripts`.
- `finished_ads` — assembled MP4 variants (9:16/1:1/16:9), FK to `scripts` + `video_assets`.
- `ad_performance` — Hyros/Meta metrics per finished ad.
- `prompt_library` — few-shot script examples ranked by performance.
- `creative_briefs` — weekly Claude-generated angle/hook briefs.

**Migration 003 — agent-facing library**
- `creative_assets` — master file index (Drive/Supabase/local) with `asset_type` discriminator covering scripts, audio, video, images, finished ads, references.
- `content_types` — registry of ad formats (structure, required inputs, ffmpeg template).
- `production_jobs` — Ava-triggered job from brief → delivery; references `creative_assets` rows for voice/lipsync/broll/finished.
- `brand_config` — single-row brand voice/visual/target config.
- `asset_collections` — named bundles of `creative_assets`.
- `drive_sync_log` — Google Drive indexing ledger.

## 2. Overlap map

| Artifact | 001 location | 003 location | Redundant? |
|---|---|---|---|
| Generated script text | `scripts.script_tagged`/`script_plain` | `creative_assets` where `asset_type='script'` + `script_text`; also `production_jobs.script_tagged` | Yes — three possible homes |
| Fish Audio MP3 | `voice_assets` | `creative_assets` where `asset_type='audio_clip'`, pointed to by `production_jobs.voice_asset_id` | Yes |
| Kling lip-sync MP4 | `video_assets` | `creative_assets` (`asset_type='source_video'` or new type), pointed to by `production_jobs.lipsync_asset_id` | Yes |
| B-roll clip | `broll_assets` | `creative_assets` where `asset_type='b_roll'`, IDs held in `production_jobs.broll_asset_ids[]` | Yes |
| Finished ad | `finished_ads` (per aspect-ratio) | `creative_assets` where `asset_type='finished_ad'`, pointed to by `production_jobs.finished_asset_id` | Yes, and 001 supports multi-variant while 003 assumes one |
| Face/voice reference | — | `creative_assets` (`face_reference`/`voice_reference`) | Only in 003 (correct) |
| Ad performance | `ad_performance` | `creative_assets.performance` JSONB | Partial — 001 is structured/time-series, 003 is rollup only |

Every pipeline-produced artifact has two legal homes today. `production_jobs` further duplicates `scripts` (script text, hook_type, angle, status).

## 3. Three patterns

### Pattern A — 001 canonical for outputs, 003 for library
Pipeline keeps writing to `scripts`/`voice_assets`/`video_assets`/`broll_assets`/`finished_ads`. `creative_assets` holds only things that aren't pipeline outputs: Drive-indexed source videos, face/voice references, brand images, screenshots. `production_jobs` orchestrates and stores FKs that point at 001 tables (not `creative_assets`).
- Pros: zero code changes in `stage3`–`stage6`; typed columns with CHECK constraints survive; per-variant `finished_ads` preserved; `ad_performance` time series intact.
- Cons: requires adding FKs from `production_jobs` to 001 tables (schema change later); two asset worlds remain; Ava still has to query multiple tables to see "all content."

### Pattern B — 003 canonical, deprecate 001 output tables
Pipeline stops writing `voice_assets`/`video_assets`/`broll_assets`/`finished_ads` and writes each render as a `creative_assets` row, linking it via `production_jobs`. `scripts` either collapses into `creative_assets` (`asset_type='script'`) or stays as a lightweight metadata table.
- Pros: one inventory table; Ava's library queries trivially cover everything produced; fewer joins.
- Cons: large rewrite of all six stage files + `supabase.ts` helpers; loss of typed columns (`provider`, `broll_type`, `aspect_ratio`, `template`) unless re-added; `finished_ads`'s multi-aspect rows become awkward; `ad_performance` loses its structured FK; migration of existing rows required before cutover.

### Pattern C — parallel (ephemeral vs long-lived)
Pipeline writes transient working state to 001 tables, then "promotes" successful renders into `creative_assets` at the end of each stage. Both exist permanently.
- Pros: clean conceptual split; `creative_assets` becomes a curated library of what's usable.
- Cons: double writes everywhere; two sources of truth drift; every stage needs a promotion step with its own failure mode; doubles storage of metadata.

## 4. Recommendation — Pattern A

001 was written around the pipeline's actual shape (status state machine, per-aspect finished ads, structured performance FK); rewriting it to fit 003's generic discriminator throws away working constraints for no runtime benefit. 003's value is the *library* (Drive sync, brand config, content-type registry, jobs) — that value doesn't require absorbing pipeline outputs. Make `production_jobs` the bridge: it references 001 rows for what the pipeline produced and `creative_assets` rows for what it consumed.

## 5. File-level changes required

- `supabase/migrations/004_*.sql` (new, out of scope here): retype `production_jobs.voice_asset_id` → FK to `voice_assets(id)`; `lipsync_asset_id` → `video_assets(id)`; `finished_asset_id` → `finished_ads(id)`; `broll_asset_ids UUID[]` documented as `broll_assets(id)`. Keep `source_asset_ids` pointing at `creative_assets`.
- `src/pipeline/stage3-voice.ts` — no write changes. Add: when invoked under a `production_jobs` row, update that job's `status='voice_done'` and `voice_asset_id` to the newly-inserted `voice_assets.id`.
- `src/pipeline/stage4-lipsync.ts` — same pattern: on success, set job `lipsync_asset_id` → `video_assets.id`, `status='lipsync_done'`.
- `src/pipeline/stage5-broll.ts` — append inserted `broll_assets.id` values to `production_jobs.broll_asset_ids`, set `status='broll_done'`.
- `src/pipeline/stage6-assembly.ts` — per finished ad, set `production_jobs.finished_asset_id` to one representative variant (likely 9:16) and `status='complete'`; leave multi-variant rows in `finished_ads`.
- `src/services/supabase.ts` — add a `getOrCreateJob(scriptId)` helper so stages can look up the active job without each stage duplicating the query; add a `linkJobAsset(jobId, field, assetId)` helper to centralise the job-side writes above. No changes to existing `insertRow`/`updateRow`/`fetchRows`/`uploadFile`.
- `src/pipeline/stage1-ideation.ts` / `stage2-script.ts` (not in read scope, flagged): these are where a `production_jobs` row should be *created* so downstream stages have a job to update; verify before implementing.
