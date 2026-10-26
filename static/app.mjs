import { pcm16, PhraseDetector } from "/audio.mjs";

const $ = id => document.getElementById(id);
const record = $("record"), text = $("text"), draft = $("draft");
const entries = new Map();
let base = "", ready = false, token = "", recording = false, starting = false, stopping = false;
let stream, context, source, worklet, mute, detector, stopAck;
let jobs = [], preview = null, working = false, startedAt = 0, timer;
let level = 0, ticks = new Array(45).fill(0), lastTick = 0;
const number = new Intl.NumberFormat("fa-IR");
if (/Mac/i.test(navigator.userAgentData?.platform || navigator.platform)) {
  $("shortcut-modifier").textContent = "⌘";
}

try { text.value = localStorage.getItem("voice-pad-text") || ""; } catch { /* Storage can be disabled. */ }
base = text.value;

function save() {
  try { localStorage.setItem("voice-pad-text", text.value); } catch { /* Text remains copyable. */ }
}
function error(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
}
function pendingCount() {
  return [...entries.values()].filter(e => e.finalRequested && !e.done && !e.failed).length;
}
function failedCount() { return [...entries.values()].filter(e => e.failed).length; }
function combined() { return [text.value.trim(), draft.hidden ? "" : draft.textContent.trim()].filter(Boolean).join(" "); }

function render() {
  const all = [...entries.values()];
  if (all.length) {
    const firstPending = all.findIndex(e => !e.done);
    const committed = firstPending < 0 ? all : all.slice(0, firstPending);
    const provisional = firstPending < 0 ? [] : all.slice(firstPending);
    text.value = [base.trim(), ...committed.map(e => e.text)].filter(Boolean).join(" ");
    draft.textContent = provisional.filter(e => e.text).map(e => e.text).join(" ");
    draft.hidden = !draft.textContent;
    save();
  }
  const count = combined().split(/\s+/u).filter(Boolean).length;
  $("word-count").textContent = `${number.format(count)} کلمه`;
  $("copy").disabled = count === 0;
  const pending = pendingCount(), failed = failedCount();
  text.readOnly = recording || starting || stopping || working || !!pending || !!failed;
  $("language").disabled = text.readOnly;
  $("microphone").disabled = text.readOnly;
  $("clear").disabled = recording || starting || stopping || working || !!pending || (!count && !failed);
  $("retry-row").hidden = !failed;
  $("retry").disabled = working;
  record.disabled = !ready || starting || stopping || (!recording && (working || pending > 0 || failed > 0));
  record.classList.toggle("recording", recording);
  record.setAttribute("aria-pressed", String(recording));
  record.setAttribute("aria-label", recording ? "توقف ضبط" : "شروع ضبط");
  $("mic-icon").toggleAttribute("hidden", recording);
  document.querySelector(".stop-icon").hidden = !recording;
  $("record-label").textContent = starting ? "اجازهٔ میکروفون را بده…" : stopping ? "در حال پایان ضبط…" : recording ? "دارم گوش می‌کنم…" : pending || working ? "در حال تکمیل متن…" : ready ? "برای شروع، میکروفون را بزن" : "در حال آماده‌شدن…";
  if (recording) $("status").textContent = pending > 1 ? `${number.format(pending)} بخش در صف تبدیل؛ صدایت دریافت می‌شود.` : "صحبت کن؛ متن با چند ثانیه تأخیر ظاهر می‌شود.";
  else if (pending || working) $("status").textContent = "آخرین بخش‌های صدایت در حال تبدیل است. کمی صبر کن.";
  else if (failed) $("status").textContent = "بخشی از صدا منتظر تلاش دوباره است.";
  else if (ready) $("status").textContent = "آمادهٔ شنیدن؛ ضبط فقط با دکمهٔ شروع فعال می‌شود.";
  $("text-hint").textContent = text.readOnly ? "متن کم‌رنگ، پیش‌نویس زنده است." : "می‌توانی متن را ویرایش و کپی کنی.";
}

function entryFor(phrase) {
  if (!entries.has(phrase.id)) entries.set(phrase.id, { text: "", done: false, failed: false });
  return entries.get(phrase.id);
}
function onPreview(phrase) {
  const entry = entryFor(phrase);
  if (!entry.finalRequested) preview = { phrase, entry, language: $("language").value, final: false };
  pump();
}
function onFinal(phrase) {
  const entry = entryFor(phrase);
  entry.finalRequested = true;
  const job = { phrase, entry, language: $("language").value, final: true };
  entry.job = job;
  jobs.push(job);
  if (preview?.entry === entry) preview = null;
  render();
  pump();
  if (pendingCount() + failedCount() >= 24 && recording && !stopping) {
    error("تبدیل از ضبط عقب افتاد؛ ضبط متوقف شد تا همهٔ بخش‌ها پردازش شوند.");
    stopRecording();
  }
}

async function transcribe(job) {
  const body = pcm16(job.phrase.chunks, job.phrase.rate);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`/api/transcribe?language=${encodeURIComponent(job.language)}&final=${job.final ? 1 : 0}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Voice-Token": token },
      body, signal: AbortSignal.timeout(120000),
    });
    const result = await response.json();
    if (response.status === 429 && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(result.error || "تبدیل صدا انجام نشد.");
    return result;
  }
}

async function pump() {
  if (working) return;
  working = true;
  while (jobs.length || preview) {
    const job = jobs.length ? jobs.shift() : preview;
    if (!job.final) preview = null;
    render();
    try {
      const result = await transcribe(job);
      job.entry.text = result.text;
      if (job.final) {
        job.entry.done = true;
        job.entry.failed = false;
        job.entry.job = null;
        // Audio is no longer referenced once a final transcription succeeds.
        job.phrase.chunks = [];
      }
    } catch (cause) {
      if (job.final) {
        job.entry.failed = true;
        error(`${cause.name === "TimeoutError" ? "زمان تبدیل طولانی شد." : cause.message} صدا موقتاً در حافظه مانده؛ «تلاش دوباره» را بزن.`);
      }
    }
    render();
  }
  working = false;
  render();
}

async function microphones() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const selected = $("microphone").value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    $("microphone").replaceChildren(new Option("پیش‌فرض سیستم", ""));
    for (const device of devices) {
      if (device.deviceId && device.deviceId !== "default") {
        $("microphone").add(new Option(device.label || `میکروفون ${$("microphone").length}`, device.deviceId));
      }
    }
    if ([...$("microphone").options].some(o => o.value === selected)) $("microphone").value = selected;
  } catch { /* Device list is optional before microphone permission. */ }
}

async function startRecording() {
  if (!ready || recording || starting || stopping || working || pendingCount() || failedCount()) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    error("ضبط صدا در این مرورگر در دسترس نیست. صفحه را با Chrome یا Firefox روی آدرس localhost باز کن.");
    return;
  }
  starting = true;
  error("");
  render();
  try {
    const deviceId = $("microphone").value;
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
    context = new AudioContext();
    await context.resume();
    await context.audioWorklet.addModule("/recorder.js");
    base = text.value;
    entries.clear();
    draft.hidden = true;
    detector = new PhraseDetector(context.sampleRate, onPreview, onFinal);
    worklet = new AudioWorkletNode(context, "voice-recorder");
    worklet.port.onmessage = ({ data }) => {
      if (data === "stopped") { stopAck?.(); return; }
      level = detector.push(data);
    };
    source = context.createMediaStreamSource(stream);
    mute = context.createGain();
    mute.gain.value = 0;
    source.connect(worklet).connect(mute).connect(context.destination);
    recording = true;
    startedAt = Date.now();
    $("timer").textContent = "00:00";
    timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 250);
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => {
      if (recording && !stopping) { error("ارتباط میکروفون قطع شد؛ صدای دریافت‌شده در حال تبدیل است."); stopRecording(); }
    });
    context.addEventListener("statechange", () => {
      if (recording && !stopping && context?.state === "suspended") {
        error("ضبط به‌علت تعلیق صدا متوقف شد. برای ادامه دوباره شروع را بزن."); stopRecording();
      }
    });
    await microphones();
  } catch (cause) {
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") await context.close();
    const messages = {
      NotAllowedError: "اجازهٔ میکروفون داده نشد. از کنار نوار آدرس مرورگر، دسترسی میکروفون را فعال کن.",
      NotFoundError: "میکروفونی پیدا نشد. اتصال میکروفون را بررسی کن.",
      NotReadableError: "میکروفون در دسترس نیست؛ تنظیمات صدای لینوکس را بررسی کن.",
      OverconstrainedError: "میکروفون انتخاب‌شده موجود نیست. پیش‌فرض سیستم را انتخاب کن.",
    };
    error(messages[cause.name] || "شروع ضبط انجام نشد. صفحه را در Chrome یا Firefox دوباره باز کن.");
  } finally {
    starting = false;
    render();
  }
}

async function stopRecording() {
  if (!recording || stopping) return;
  stopping = true;
  render();
  clearInterval(timer);
  // The worklet acknowledges after sending its last, partially filled buffer.
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 1500);
    stopAck = () => { clearTimeout(timeout); resolve(); };
    worklet.port.postMessage("stop");
  });
  stopAck = null;
  source?.disconnect();
  worklet?.disconnect();
  mute?.disconnect();
  stream?.getTracks().forEach(track => track.stop());
  detector.flush();
  if (context && context.state !== "closed") await context.close();
  context = null;
  recording = false;
  stopping = false;
  level = 0;
  // A pending preview is superseded by the final job for that phrase.
  render();
  pump();
}

record.addEventListener("click", () => recording ? stopRecording() : startRecording());
$("copy").addEventListener("click", async () => {
  const value = combined();
  try {
    await navigator.clipboard.writeText(value);
    $("copy").querySelector("span").textContent = "کپی شد!";
    setTimeout(() => { $("copy").querySelector("span").textContent = "کپی متن"; }, 1800);
  } catch {
    // Local browser policies can disable the async clipboard API.
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) { text.focus(); text.select(); error("متن انتخاب شد؛ با Ctrl+C آن را کپی کن."); }
  }
});
$("clear").addEventListener("click", () => {
  base = ""; text.value = ""; draft.textContent = ""; draft.hidden = true;
  entries.clear(); error(""); save(); render();
});
$("retry").addEventListener("click", () => {
  for (const entry of entries.values()) if (entry.failed && entry.job) {
    entry.failed = false; jobs.push(entry.job);
  }
  error(""); pump();
});
text.addEventListener("input", () => {
  // Release completed phrase objects before a user edits the final transcript.
  entries.clear(); base = text.value; draft.textContent = ""; draft.hidden = true;
  save(); render();
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "Space") {
    event.preventDefault(); if (!record.disabled) record.click();
  }
});
window.addEventListener("beforeunload", event => {
  if (recording || working || pendingCount() || failedCount()) { event.preventDefault(); event.returnValue = ""; }
});
navigator.mediaDevices?.addEventListener("devicechange", microphones);

function draw(now) {
  const canvas = $("wave"), ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (now - lastTick > 85) { ticks.shift(); ticks.push(recording ? Math.min(1, level * 8) : 0); lastTick = now; }
  ticks.forEach((value, index) => {
    const h = 3 + value * (height - 9);
    ctx.fillStyle = recording ? "#b87962" : "#cfdbc9";
    ctx.beginPath(); ctx.roundRect(index * width / ticks.length, (height - h) / 2, 2.5, h, 2); ctx.fill();
  });
  requestAnimationFrame(draw);
}

async function checkReady() {
  try {
    const response = await fetch("/api/status", { signal: AbortSignal.timeout(5000) });
    const info = await response.json();
    if (info.app !== "voice-pad") throw new Error("wrong_server");
    token = info.token;
    ready = info.ready;
    $("model-label").textContent = `Whisper ${info.model} · offline`;
    if (info.error) { error(info.error); $("status").textContent = "مدل آماده نیست؛ راهنمای اجرا را بررسی کن."; }
    else if (!ready) setTimeout(checkReady, 1200);
  } catch {
    error("ارتباط با برنامه برقرار نشد. برنامه را دوباره اجرا کن.");
    setTimeout(checkReady, 3000);
  }
  render();
}
render();
microphones();
requestAnimationFrame(draw);
checkReady();
