/**
 * Verification: runLipSync pre-flight rejects face shorter than audio
 * BEFORE making any Kling API call.
 *
 * Strategy:
 *  1. ffmpeg-generate a 2s silent face video and a 10s tone audio in os.tmpdir().
 *  2. Stub fal.subscribe to throw if invoked — proves we never reach the API.
 *  3. Serve fixtures over a localhost HTTP server (fal.subscribe never sees these URLs).
 *  4. Call runLipSync; expect the truncation-prevention Error.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";
import { createReadStream, statSync } from "fs";
import { createServer } from "http";
import { fal } from "@fal-ai/client";
import { runLipSync } from "../services/kling-lipsync.js";

const execFileAsync = promisify(execFile);

async function makeFace(path: string, durationSecs: number) {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi",
    "-i", `color=c=black:s=320x240:d=${durationSecs}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-t", String(durationSecs), path,
  ]);
}

async function makeAudio(path: string, durationSecs: number) {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi",
    "-i", `sine=frequency=440:duration=${durationSecs}`,
    "-c:a", "libmp3lame", path,
  ]);
}

function startServer(faceFile: string, audioFile: string) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = createServer((req, res) => {
      const file =
        req.url === "/face.mp4" ? faceFile :
        req.url === "/audio.mp3" ? audioFile : null;
      if (!file) { res.statusCode = 404; res.end(); return; }
      const size = statSync(file).size;
      res.setHeader("Content-Length", String(size));
      res.setHeader("Content-Type", file.endsWith(".mp4") ? "video/mp4" : "audio/mpeg");
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

async function main() {
  const faceFile = join(tmpdir(), `test_face_${Date.now()}.mp4`);
  const audioFile = join(tmpdir(), `test_audio_${Date.now()}.mp3`);

  console.log("[test] Generating fixtures (face=2s, audio=10s)...");
  await makeFace(faceFile, 2);
  await makeAudio(audioFile, 10);

  const server = await startServer(faceFile, audioFile);

  // Stub fal.subscribe to fail loudly if validation lets the call through.
  let falCalled = false;
  (fal as unknown as { subscribe: unknown }).subscribe = async () => {
    falCalled = true;
    throw new Error("[test] fal.subscribe was called — validation did not block!");
  };

  let threw = false;
  let message = "";
  try {
    await runLipSync({
      videoUrl: `${server.url}/face.mp4`,
      audioUrl: `${server.url}/audio.mp3`,
    });
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  } finally {
    server.close();
    await unlink(faceFile).catch(() => {});
    await unlink(audioFile).catch(() => {});
  }

  if (falCalled) {
    console.error("FAIL: fal.subscribe was invoked despite short face.");
    process.exit(1);
  }
  if (!threw) {
    console.error("FAIL: runLipSync did not throw on short face.");
    process.exit(1);
  }
  if (!/too short/i.test(message) || !/face=/.test(message) || !/audio=/.test(message)) {
    console.error(`FAIL: error message missing expected content. Got: ${message}`);
    process.exit(1);
  }

  console.log("PASS: validation rejected short face before any Kling call.");
  console.log(`       message: ${message}`);
}

main().catch((err) => {
  console.error("UNEXPECTED:", err);
  process.exit(1);
});
