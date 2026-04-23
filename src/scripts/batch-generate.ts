import { mkdir, writeFile, copyFile } from "fs/promises";
import { join } from "path";
import { fal } from "@fal-ai/client";
import { config } from "../config/env.js";
import { generateSpeech, estimateDuration } from "../services/fish-audio.js";
import { runLipSync } from "../services/kling-lipsync.js";

fal.config({ credentials: config.falKey });

interface BatchScript {
  n: number;
  words: number;
  tagged: string;
}

const SCRIPTS: BatchScript[] = [
  {
    n: 1,
    words: 76,
    tagged: `[confident] There's a pricing mistake ninety percent of Airbnb hosts make, and it's costing them thousands. [serious] They set one nightly rate and leave it. Weekends, weekdays, school holidays — same price. [warm] Meanwhile the place next door is using dynamic pricing and earning forty percent more. [casual] I fixed this on one property and went from four grand a month to six thousand seven hundred. [excited] Free training in my bio shows you the exact tool I use. No catch.`,
  },
  {
    n: 2,
    words: 75,
    tagged: `[casual] Want to know why your Airbnb sits empty while the one down the road is booked out? [serious] You're priced twenty dollars too high on weeknights. That's it. [warm] Airbnb's algorithm drops you in search when you don't get clicks, and nobody clicks an overpriced Tuesday. [confident] I dropped one listing's midweek rate by fifteen bucks and bookings jumped sixty-two percent the next month. [excited] I'll show you how in my free training. Link's in the bio.`,
  },
  {
    n: 3,
    words: 75,
    tagged: `[excited] The most expensive mistake I made as a host? [laugh] Raising my prices. [serious] I thought higher nightly rate means more money. Wrong. My occupancy tanked from eighty-two percent to forty-one. [warm] Turns out in short-term rentals, a booked cheap night beats an empty expensive one every single time. [confident] I dropped rates back, added a weekly discount, and cleared eight thousand four hundred dollars that month. [casual] Free training in my bio. Walks through the whole pricing formula.`,
  },
];

interface RowResult {
  n: number;
  words: number;
  audioPath: string;
  videoPath: string;
  durationSecs: number | null;
  status: string;
}

async function processScript(
  script: BatchScript,
  audioDir: string,
  videoDir: string
): Promise<RowResult> {
  const row: RowResult = {
    n: script.n,
    words: script.words,
    audioPath: "—",
    videoPath: "—",
    durationSecs: null,
    status: "PENDING",
  };

  try {
    console.log(`\n[script ${script.n}] generating TTS...`);
    const tts = await generateSpeech({ text: script.tagged });

    const audioPath = join(audioDir, `script_${script.n}.mp3`);
    await writeFile(audioPath, tts.audioBuffer);
    row.audioPath = audioPath;
    console.log(`[script ${script.n}] audio → ${audioPath}`);

    console.log(`[script ${script.n}] uploading audio to fal storage...`);
    const blob = new Blob([new Uint8Array(tts.audioBuffer)], { type: "audio/mpeg" });
    const file = new File([blob], `script_${script.n}.mp3`, { type: "audio/mpeg" });
    const audioUrl = await fal.storage.upload(file);
    console.log(`[script ${script.n}] audio url: ${audioUrl}`);

    console.log(`[script ${script.n}] running Kling lip-sync...`);
    const lip = await runLipSync({
      videoUrl: config.faceReferenceUrl,
      audioUrl,
    });

    const videoPath = join(videoDir, `script_${script.n}.mp4`);
    await copyFile(lip.filePath, videoPath);
    row.videoPath = videoPath;
    row.durationSecs = lip.durationSecs;
    row.status = "✓";
    console.log(`[script ${script.n}] video → ${videoPath} (${lip.durationSecs}s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    row.status = `FAILED: ${msg}`;
    console.error(`[script ${script.n}] FAILED: ${msg}`);
  }

  return row;
}

function renderTable(rows: RowResult[]): string {
  const header = "Script | Words | Audio Path                                    | Video Path                                    | Duration | Status";
  const sep =    "-------+-------+-----------------------------------------------+-----------------------------------------------+----------+----------------------------------------";
  const lines = [header, sep];
  for (const r of rows) {
    const dur = r.durationSecs == null ? "—" : `${r.durationSecs}s`;
    lines.push(
      `${String(r.n).padEnd(6)} | ${String(r.words).padEnd(5)} | ${r.audioPath.padEnd(45).slice(0, 45)} | ${r.videoPath.padEnd(45).slice(0, 45)} | ${dur.padEnd(8)} | ${r.status}`
    );
  }
  return lines.join("\n");
}

async function main() {
  if (config.faceReferenceUrl.includes("KX_3E7I9w5hyK4OvjHNq1")) {
    console.error("STOP: FACE_REFERENCE_URL points to the AI portrait, not Jordan's real footage.");
    process.exit(1);
  }

  const audioDir = join(process.cwd(), "assets", "audio", "batch-01");
  const videoDir = join(process.cwd(), "assets", "video", "batch-01");
  await mkdir(audioDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });

  const startMs = Date.now();
  const results: RowResult[] = [];

  for (const script of SCRIPTS) {
    const row = await processScript(script, audioDir, videoDir);
    results.push(row);
  }

  const minutes = (Date.now() - startMs) / 60000;
  const succeeded = results.filter((r) => r.status === "✓").length;

  // Rough cost estimate: Fish Audio ~$0.015 per 1000 chars + Kling lipsync ~$3/clip
  const chars = SCRIPTS.reduce((a, s) => a + s.tagged.length, 0);
  const ttsCost = (chars / 1000) * 0.015;
  const klingCost = succeeded * 3.0;
  const totalCost = ttsCost + klingCost;

  console.log("\n" + "=".repeat(72));
  console.log(renderTable(results));
  console.log("=".repeat(72));
  console.log(
    `Batch complete: ${succeeded}/3 succeeded in ${minutes.toFixed(1)} minutes, ~$${totalCost.toFixed(2)} spent.`
  );
}

main().catch((err) => {
  console.error("Batch aborted:", err);
  process.exit(1);
});
