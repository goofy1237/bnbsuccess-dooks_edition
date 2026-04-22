import { supabase, insertRow, fetchRows } from "../services/supabase.js";

async function main() {
  const advertiserMarker = "SMOKE_TEST_" + Date.now();
  let competitorAdId: string | undefined;
  let scriptId: string | undefined;

  try {
    const ad = await insertRow("competitor_ads", {
      advertiser: advertiserMarker,
      source: "tiktok_cc",
      hook_text: "Smoke test row — safe to delete",
      structure: "testimonial",
      duration_secs: 30,
    });
    competitorAdId = ad.id;
    console.log("Inserted competitor_ads row:", ad.id);

    const script = await insertRow("scripts", {
      angle: "SMOKE_TEST",
      hook_type: "skeptic",
      script_plain: "Test",
      script_tagged: "[excited] Test",
      word_count: 1,
      est_duration: 1,
      status: "draft",
    });
    scriptId = script.id;
    console.log("Inserted scripts row:", script.id);

    const ads = await fetchRows("competitor_ads", { advertiser: advertiserMarker });
    const scripts = await fetchRows("scripts", { angle: "SMOKE_TEST" });

    console.log("Fetched competitor_ads:", ads);
    console.log("Fetched scripts:", scripts);

    console.log("✓ Smoke test passed — DB read/write working");
  } catch (err) {
    console.error("✗ Smoke test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (competitorAdId) {
      const { error } = await supabase.from("competitor_ads").delete().eq("id", competitorAdId);
      if (error) console.error("Cleanup competitor_ads failed:", error.message);
      else console.log("Cleaned up competitor_ads row");
    }
    if (scriptId) {
      const { error } = await supabase.from("scripts").delete().eq("id", scriptId);
      if (error) console.error("Cleanup scripts failed:", error.message);
      else console.log("Cleaned up scripts row");
    }
  }
}

main();
