// Turns media from any sender into forms an agent can use: images it can see, audio as text,
// video as a few frames, and PDFs as text and page images.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command, args, input, { maxBuffer, timeout, what }) {
  return new Promise((resolve, reject) => {
    const fail = (stderr = "") => reject(Object.assign(new Error(`Could not convert the ${what}`), { stderr: String(stderr) }));
    const options = { encoding: "buffer", maxBuffer, timeout, killSignal: "SIGKILL" };
    const child = execFile(command, args, options, (error, stdout, stderr) => (error ? fail(stderr) : resolve(stdout)));
    // If the tool exits early, writing to its stdin errors; without a listener that would crash the process.
    child.stdin.on("error", () => fail());
    child.stdin.end(input);
  });
}

// Clients can't see AVIF, HEIC, BMP or SVG, so every image becomes a JPEG small enough to send.
// "[0]" keeps the first frame of animations. policy.xml limits which formats decode and how big.
export function toJpeg(bytes) {
  const args = ["-[0]", "-auto-orient", "-resize", "1568x1568>", "-strip", "-quality", "85", "jpeg:-"];
  return run("magick", args, bytes, { maxBuffer: 20e6, timeout: 15_000, what: "image" });
}

// Some formats (CAF, MP4) need a seekable input, so ffmpeg reads from a file.
async function withFile(bytes, use) {
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  try {
    const path = join(dir, "in");
    await writeFile(path, bytes);
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Media comes from any sender, so only real audio and video containers open: a file posing as
// a playlist or concat list could otherwise make ffmpeg read other files.
const CONTAINERS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,ogg,mp3,aac,amr,caf,flac,wav,avi,asf,mpeg,mpegts,flv";
const open = (path) => ["-format_whitelist", CONTAINERS, "-protocol_whitelist", "file", "-i", path];
const ffmpeg = (args, limits) => run("ffmpeg", ["-nostdin", "-loglevel", "error", ...args], "", limits);

// Groq rejects AAC, AMR and CAF, and WhatsApp's ".oga" name, so every audio becomes 16 kHz mono Opus,
// the format Groq resamples to anyway.
export function toOpus(bytes) {
  const out = ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", "-f", "ogg", "pipe:1"];
  return withFile(bytes, (path) => ffmpeg([...open(path), ...out], { maxBuffer: 50e6, timeout: 60_000, what: "audio" }));
}

// Frames as PNG, at the given times, or spread evenly from the start to half a second before the end,
// where videos often fade out, at least a second apart. Times past the end are rejected, not moved.
// Also reports whether there is sound to transcribe: WhatsApp sends GIFs as silent videos.
export function videoFrames(bytes, { count = 5, times } = {}) {
  return withFile(bytes, async (path) => {
    const limits = { maxBuffer: 20e6, timeout: 30_000, what: "video" };
    const probe = ["-v", "error", ...open(path), "-show_entries", "format=duration,format_name:stream=codec_type", "-of", "json"];
    const { format, streams } = JSON.parse(await run("ffprobe", probe, "", limits));
    const duration = Number(format?.duration);
    if (!(duration > 0)) throw new Error("Could not convert the video");
    let rejected = [];
    if (times) {
      const chosen = [...new Set(times.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b);
      rejected = chosen.filter((t) => t > duration - 0.1);
      times = chosen.filter((t) => t <= duration - 0.1);
    } else {
      const last = Math.max(0, duration - 0.5);
      const n = Math.min(count, Math.floor(last) + 1);
      times = n === 1 ? [duration / 2] : Array.from({ length: n }, (_, i) => (i * last) / (n - 1));
    }
    // MP4, MOV and Matroska keep an index, so seeking before opening jumps straight to the frame.
    // In FLV, MPEG-PS and MPEG-TS that can land on nothing, so decode up to the time instead: slower, but exact.
    const indexed = /^(mov|matroska)/.test(format.format_name);
    const frames = [];
    for (const t of times) {
      const at = t.toFixed(2);
      const seek = indexed ? ["-ss", at, ...open(path)] : [...open(path), "-ss", at];
      const png = await ffmpeg([...seek, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], limits);
      if (png.length) frames.push({ seconds: Math.round(t * 10) / 10, png });
    }
    return { duration: Math.round(duration * 10) / 10, sound: streams.some((s) => s.codec_type === "audio"), frames, rejected };
  });
}

// Poppler reads the PDF: pdfinfo for the page count, pdftotext for the text layer, pdftoppm for page
// images. Scanned PDFs have no text layer, so the agent needs the images to read them. A PDF locked with
// a user password opens only with it; one with just an owner password (no copy or print) opens without.
const PDF_LIMITS = { maxBuffer: 20e6, timeout: 30_000, what: "PDF" };
export function readPdf(bytes, { pages, password } = {}) {
  return withFile(bytes, async (locked) => {
    const path = await unlock(locked, password);
    const info = await run("pdfinfo", [path], "", PDF_LIMITS);
    const count = Number(String(info).match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!(count > 0)) throw new Error("Could not convert the PDF");
    const wanted = [...new Set(pages ?? [1])].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
    const text = String(await run("pdftotext", ["-layout", path, "-"], "", PDF_LIMITS));
    // pdftotext ends every page with a form feed.
    const byPage = text.split("\f").slice(0, count).map((t) => t.trim());
    const images = [];
    for (const p of wanted) {
      images.push({ page: p, png: await run("pdftoppm", ["-f", String(p), "-l", String(p), "-scale-to", "1568", "-png", path], "", PDF_LIMITS) });
    }
    return { pages: count, text: byPage, images };
  });
}

// qpdf decrypts an encrypted PDF next to it, with the password on stdin: other processes on the machine
// can read command arguments. It tries no password first, because a PDF with only an owner password
// opens without one but not with a wrong one. A PDF that isn't encrypted is read as it is.
async function unlock(path, password) {
  const encrypted = await run("qpdf", ["--is-encrypted", path], "", PDF_LIMITS).then(() => true, () => false);
  if (!encrypted) return path;
  const open = `${path}.open`;
  for (const attempt of new Set(["", password ?? ""])) {
    const opened = await run("qpdf", ["--password-file=-", "--decrypt", "--warning-exit-0", path, open], attempt, PDF_LIMITS).then(
      () => true,
      (e) => {
        // qpdf ends its rejection with ": invalid password"; the path it names can't contain the phrase.
        if (!/: invalid password\s*$/.test(e.stderr)) throw e;
        return false;
      },
    );
    if (opened) return open;
  }
  throw new Error(password ? "Wrong PDF password" : "This PDF needs a password");
}

// Only the text goes on to the agent; the audio itself goes no further than Groq.
export async function transcribe(bytes, apiKey) {
  const form = new FormData();
  form.append("file", new Blob([await toOpus(bytes)]), "audio.ogg");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  // Segment times mark the start of a 30-second window, often well before the words are spoken.
  // Word times are where the speech is, so each segment starts at its first word.
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Could not transcribe the audio (${res.status})`);
  const { text, language, segments = [], words = [] } = await res.json();
  const timed = segments.map((s) => {
    const first = words.find((w) => w.start >= s.start && w.start < s.end);
    return { start: Math.round((first?.start ?? s.start) * 10) / 10, text: s.text.trim() };
  });
  return { text: text.trim(), language, segments: timed };
}
