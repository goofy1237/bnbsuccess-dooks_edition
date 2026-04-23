import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { readFile, writeFile } from "fs/promises";
import { createReadStream, existsSync, statSync } from "fs";
import { join, basename, extname, resolve } from "path";
import { fal } from "@fal-ai/client";
import { generateSpeech } from "../services/fish-audio.js";
import { runLipSync } from "../services/kling-lipsync.js";
import { readEnv, writeEnvFields, redactedEnv } from "./env-writer.js";
import { generateScripts } from "./script-gen.js";

fal.config({ credentials: process.env.FAL_KEY });

const app = new Hono();
const ROOT = process.cwd();
const LIBRARY_PATH = join(ROOT, "assets", "face-reference", "library.json");

app.get("/", async (c) => {
  const html = await readFile(join(ROOT, "src", "dashboard", "index.html"), "utf8");
  return c.html(html);
});

app.get("/api/config", async (c) => {
  const env = await readEnv();
  return c.json(redactedEnv(env));
});

app.post("/api/config", async (c) => {
  const body = await c.req.json<Record<string, string>>();
  await writeEnvFields(body);
  return c.json({ ok: true });
});

app.get("/api/face-library", async (c) => {
  const raw = await readFile(LIBRARY_PATH, "utf8");
  return c.json(JSON.parse(raw));
});

app.post("/api/upload-face", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const tags = (form.get("tags") as string | null) ?? "";
  const notes = (form.get("notes") as string | null) ?? "";
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name || `face_${Date.now()}.mp4`;
  const ext = extname(name).toLowerCase();
  const contentType =
    ext === ".mp4" ? "video/mp4" :
    ext === ".mov" ? "video/quicktime" :
    "application/octet-stream";

  const localPath = join("assets", "face-reference", `${Date.now()}_${basename(name)}`);
  await writeFile(join(ROOT, localPath), buf);

  const falFile = new File([buf], name, { type: contentType });
  const url = await fal.storage.upload(falFile);

  const libraryRaw = await readFile(LIBRARY_PATH, "utf8");
  const library = JSON.parse(libraryRaw) as { references: any[] };
  const entry = {
    id: `ref_${Date.now()}`,
    url,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    duration_secs: 0,
    source: name,
    local_path: localPath,
    notes: notes || "Uploaded via dashboard",
  };
  library.references.push(entry);
  await writeFile(LIBRARY_PATH, JSON.stringify(library, null, 2), "utf8");

  return c.json({ entry });
});

app.post("/api/generate-script", async (c) => {
  const body = await c.req.json<{ angle: string; hookType: string; durationSecs: number; variations: number }>();
  try {
    const scripts = await generateScripts(body);
    return c.json({ scripts });
  } catch (err: any) {
    return c.json({ error: err.message ?? String(err) }, 500);
  }
});

app.post("/api/generate", async (c) => {
  const body = await c.req.json<{
    script: string;
    voiceId?: string;
    speed?: number;
    temperature?: number;
    faceUrl?: string;
  }>();

  return streamSSE(c, async (stream) => {
    const send = async (event: string, data: Record<string, unknown>) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };

    try {
      const voiceId = body.voiceId || process.env.FISH_AUDIO_VOICE_ID || "";
      const faceUrl = body.faceUrl || process.env.FACE_REFERENCE_URL || "";
      if (!voiceId) throw new Error("No FISH_AUDIO_VOICE_ID set. Configure a voice first.");
      if (!faceUrl) throw new Error("No FACE_REFERENCE_URL set. Configure a face first.");
      if (!body.script?.trim()) throw new Error("Script is empty.");

      await send("progress", { stage: "audio", message: "Generating audio via Fish Audio..." });
      const audio = await generateSpeech({
        text: body.script,
        voiceId,
        speed: body.speed,
        temperature: body.temperature,
      });
      const audioRel = audio.filePath.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "");
      await send("progress", {
        stage: "audio_done",
        message: `Audio generated (~${audio.durationEstimate}s)`,
        audioPath: audioRel,
      });

      await send("progress", { stage: "upload", message: "Uploading audio to fal.ai..." });
      const audioFile = new File([new Uint8Array(audio.audioBuffer)], basename(audio.filePath), {
        type: "audio/mpeg",
      });
      const audioUrl = await fal.storage.upload(audioFile);
      await send("progress", { stage: "upload_done", message: "Audio uploaded" });

      await send("progress", {
        stage: "lipsync",
        message: "Running Kling lip-sync (2-5 min)...",
        startedAt: Date.now(),
      });
      const result = await runLipSync({ videoUrl: faceUrl, audioUrl });
      const videoRel = result.filePath.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "");
      await send("progress", { stage: "lipsync_done", message: "Lip-sync complete" });

      await send("done", {
        audioPath: audioRel,
        videoPath: videoRel,
        videoUrl: result.videoUrl,
        durationSecs: result.durationSecs,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      let suggestion = "";
      if (/422/.test(msg)) suggestion = " — Kling usually returns 422 when the face video is outside 2-60s or the audio is too long. Check source durations.";
      else if (/401|403/.test(msg)) suggestion = " — Check your API keys in .env.";
      else if (/FISH_AUDIO_VOICE_ID/.test(msg)) suggestion = " — Set a voice ID in Section 1.";
      else if (/FACE_REFERENCE_URL/.test(msg)) suggestion = " — Select or upload a face reference in Section 2.";
      await send("error", { message: msg + suggestion });
    } finally {
      await stream.close();
    }
  });
});

app.get("/api/assets/*", async (c) => {
  const url = new URL(c.req.url);
  const relPath = decodeURIComponent(url.pathname.replace(/^\/api\/assets\//, ""));
  const full = resolve(ROOT, "assets", relPath);
  if (!full.startsWith(resolve(ROOT, "assets"))) return c.text("Forbidden", 403);
  if (!existsSync(full)) return c.text("Not found", 404);

  const ext = extname(full).toLowerCase();
  const type =
    ext === ".mp4" ? "video/mp4" :
    ext === ".mov" ? "video/quicktime" :
    ext === ".mp3" ? "audio/mpeg" :
    ext === ".wav" ? "audio/wav" :
    ext === ".json" ? "application/json" :
    "application/octet-stream";

  const stat = statSync(full);
  const stream = createReadStream(full);
  return new Response(stream as any, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
});

const port = Number(process.env.DASHBOARD_PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  BNB UGC dashboard → http://localhost:${info.port}\n`);
});
