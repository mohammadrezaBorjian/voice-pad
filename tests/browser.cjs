/* End-to-end test with real AudioWorklet capture and real local Whisper. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const wav = process.env.VOICE_PAD_TEST_WAV;
  assert.ok(wav && fs.existsSync(wav), "Set VOICE_PAD_TEST_WAV to a speech WAV fixture");
  const output = path.resolve(__dirname, "../test-results");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    headless: true,
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1150 }, permissions: ["microphone", "clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.VOICE_PAD_TEST_URL || "http://127.0.0.1:8791");
    await page.locator("#record").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.getElementById("record").disabled, { timeout: 60000 });
    await page.screenshot({ path: path.join(output, "ready.png"), fullPage: true });
    await page.selectOption("#language", "en");
    let requests = 0, finals = 0, hadPreview = false;
    page.on("request", request => {
      if (request.url().includes("/api/transcribe")) {
        requests++;
        if (request.url().includes("final=1")) finals++;
        else hadPreview = true;
      }
    });
    await page.click("#record");
    await page.waitForFunction(() => document.getElementById("record").getAttribute("aria-pressed") === "true");
    assert.equal(await page.locator("#mic-icon").isVisible(), false);
    assert.equal(await page.locator(".stop-icon").isVisible(), true);
    await page.waitForFunction(() => {
      const final = document.getElementById("text").value;
      const draft = document.getElementById("draft").textContent;
      return /fellow|americans|country/i.test(final + draft);
    }, { timeout: 120000 });
    await page.screenshot({ path: path.join(output, "recording.png"), fullPage: true });
    // Capture enough of the fixture to exercise previews AND silence finalization.
    await page.waitForTimeout(6500);
    await page.click("#record");
    await page.waitForFunction(() => !document.getElementById("text").readOnly, { timeout: 180000 });
    const transcript = await page.inputValue("#text");
    assert.match(transcript, /fellow|americans|country/i);
    assert.ok(hadPreview, "Live speech must request at least one preview");
    assert.ok(finals > 0, "Stop or silence must request a final transcription");
    await page.click("#copy");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, transcript);
    await page.screenshot({ path: path.join(output, "complete.png"), fullPage: true });
    await page.reload();
    assert.equal(await page.inputValue("#text"), transcript, "Final text must survive reopening");
    await page.waitForFunction(() => !document.getElementById("record").disabled);
    await page.fill("#text", "این یک متن فارسی برای بررسی ویرایش و کپی است.");
    await page.click("#copy");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "این یک متن فارسی برای بررسی ویرایش و کپی است.");
    await page.screenshot({ path: path.join(output, "persian.png"), fullPage: true });
    await page.click("#clear");
    assert.equal(await page.inputValue("#text"), "");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(JSON.stringify({ ok: true, requests, finals, hadPreview, transcript, screenshots: output }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
