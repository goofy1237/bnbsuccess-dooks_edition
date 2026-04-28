# BNB UGC Pipeline — Handoff Notes

Last updated: 2026-04-28

## Where this is at

Mid-Phase-1 of a 4-phase build (per BNB-Success-AI-UGC-Pipeline-Build-Spec.docx).
Technical pipeline works end-to-end; market validation hasn't happened yet. This
session added pre-flight duration validation to lip-sync (so Kling can no longer
silently truncate output to the shorter of audio/face) and fixed the related
`duration_secs: 0` write in the dashboard face upload handler.

## What works

- **Gate test** (`src/gate-test.ts`) — full pipeline run from script to lip-synced MP4
- **Script generation** with pause-tagged Australian English in Jordan's voice
  (`src/scripts/test-script-gen.ts`, also wrapped in dashboard)
- **Batch generation** (`src/scripts/batch-generate.ts`) — produces multiple ads in one run
- **A/B hook testing** (`src/scripts/ab-test-hooks.ts`) — 4 hook variants, same angle
- **Local dashboard** (`npm run dashboard`) — operator UI on http://localhost:3000
- **Supabase DB** — migrations 001-004 applied, smoke test passes, schema reachable
- **Face reference library** — `assets/face-reference/library.json` + helpers
- **Lip-sync pre-flight duration validation prevents silent truncation**

## What's broken / known issues

- `createVoiceClone()` in `src/services/fish-audio.ts` hits `/v1/voice/clone` (404).
  Use Fish Audio web UI to clone instead.
- Two Claude model IDs in repo: `claude-opus-4-6-20250219` (services) vs
  `claude-opus-4-7` (scripts/dashboard). Normalise to one.
- Cost docs in README/SETUP say `$3/clip` — actual is ~$0.50/clip. Fix needed.
- `batch-generate.ts` cost estimator constant is also $3 (same fix).

## Recently fixed

- **Kling silent truncation** — `runLipSync` now downloads audio + face to
  `os.tmpdir()`, ffprobes both, and throws before calling fal.subscribe if
  `face_duration < audio_duration - 0.5`. Temp files cleaned up in `finally`.
- **`duration_secs: 0` on face uploads** — dashboard upload handler now ffprobes
  the saved file and writes the real duration to `library.json`.

## What's deferred (not started or partial)

- Pipeline ↔ Supabase wiring — stages 3-4 don't read/write DB rows yet
- Schema reconciliation between 001 (pipeline tables) and 003 (creative library)
  — see `docs/schema-reconciliation.md`
- Stage 1 (competitor scrapers, Playwright)
- Stage 5 (Seedance B-roll generation)
- Stage 6 (ffmpeg assembly templates beyond stub)
- Stage 6 captions (Whisper integration)
- Phase 4 feedback loop (Meta + Hyros)
- Training corpus ingestion (folder scaffolded, empty)
- Production deployment (currently localhost only)

## Critical Phase 1 gaps (blocks MVP launch)

1. No real Ava/Jordan footage yet for face reference — currently using a horizontal
   30s clip from `wthisubndy_trimmed.mp4`. Want a deliberately-shot vertical
   reference for production ads.
2. Voice clone source is currently a VSL extract — works but a deliberate clean
   2-min recording would improve quality.
3. No CapCut-edited finished ads yet (raw talking heads only).
4. No paid Meta test ads run — no performance data exists.

## Current state — credentials / live values

- Supabase project ref: `zyiidveeixbbjpswruyn`
- Fish Audio voice_id: `2baf8ba2baf645d3b051c5cc8a8771e9` (Jordan, cloned from VSL)
- Face reference: horizontal 30s, fal.media URL in `.env`

## Repo orientation

- `README.md` — start here for project overview
- `SETUP.md` — environment + API keys
- `ARCHITECTURE.md` — service + stage breakdown
- `HANDOFF.md` — this file, current state
- `src/dashboard/` — local UI
- `src/scripts/` — CLI entry points (gate-test, batch-generate, ab-test-hooks, db-smoke,
  test-duration-validation)
- `src/services/` — external API wrappers
- `src/pipeline/` — stage runners (mostly DB-coupled, not all wired yet)
- `supabase/migrations/` — 4 migrations, all applied to remote
- `assets/face-reference/library.json` — face ref catalog

## Suggested next session priorities

In order, ranked by ROI:

1. **Get real Ava/Jordan content** — phone recording, 30s face + 2min voice.
   Cannot be done in code. Single biggest quality lever.
2. **Fix cost quotes in docs + estimator** (~5 min)
3. **Fix `createVoiceClone` endpoint** (~20 min)
4. **Normalise Claude model IDs** (~5 min)
5. **Read `docs/schema-reconciliation.md` and decide on a pattern** — unblocks
   wiring stages 3-4 to DB
6. **Wire stages 3-4 to DB** — actual Phase 2 milestone (~45-60 min)
7. **CapCut edit one finished ad and launch on Meta** — actual Phase 1 milestone

## How to work effectively in this repo

- Use Claude Code (`claude --dangerously-skip-permissions`) from the repo root
  for code changes. Keep tasks scoped to one thing per session.
- Use the dashboard for ad generation runs once you trust it.
- Commit between Claude Code sessions; never let work pile up uncommitted.
- Real generations cost real money (~$0.50/clip, $0.05 for script-only). Don't
  spam the generate button.

## How NOT to work in this repo

- Don't use Claude Code for things you can do in one terminal command.
- Don't run migrations against the remote Supabase without checking remote state
  first (`supabase migration list`).
- Don't touch `.env` outside the dashboard's allowlisted fields without
  understanding what each var does.
- Don't expand scope mid-task. If a task balloons, cut and document, don't push through.
