// Checks the media converters on fixtures in every format. Each audio fixture speaks its token.
// Each video speaks its token, except the silent GIF, and shows a numbered card per second for
// checking by eye which moments the frames come from. Each PDF shows its tokens on its pages.
import childProcess from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { readBill } from "../src/bills.mjs";
import { readPdf, toJpeg, transcribe, videoFrames } from "../src/media.mjs";

const fixture = (path) => new URL(`../fixtures/${path}`, import.meta.url).pathname;
const AUDIO = fixture("audio");
const TOKENS = {
  "fixture-aac.aac": "53", "fixture-amr.amr": "71", "fixture-caf.caf": "73", "fixture-flac.flac": "61",
  "fixture-m4a.m4a": "47", "fixture-mp3.mp3": "41", "fixture-ogg-opus.ogg": "31",
  "fixture-voice-note.oga": "37", "fixture-wav.wav": "59", "fixture-webm.webm": "67",
};
const VIDEO = fixture("video");
const VIDEOS = {
  "fixture-3gp.3gp": { frames: 5, token: "54" },
  "fixture-av1.mp4": { frames: 5, token: "66" },
  "fixture-avi.avi": { frames: 5, token: "12" },
  "fixture-flv.flv": { frames: 5, token: "38" },
  "fixture-gif.mp4": { frames: 3, token: null },
  "fixture-hevc-portrait.mov": { frames: 5, token: "97" },
  "fixture-mkv.mkv": { frames: 5, token: "46" },
  "fixture-mov.mov": { frames: 5, token: "29" },
  "fixture-mp4.mp4": { frames: 5, token: "43" },
  "fixture-mpeg2.mpg": { frames: 5, token: "23" },
  "fixture-ts.ts": { frames: 5, token: "34" },
  "fixture-webm.webm": { frames: 5, token: "83" },
  "fixture-wmv.wmv": { frames: 5, token: "18" },
};

let failed = 0;
const report = (ok, line) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
};
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8;

// Groq's free tier allows 20 transcriptions a minute, and this check makes 14, so a second run
// right after the first waits for the limit instead of failing.
async function speech(bytes) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transcribe(bytes, process.env.GROQ_API_KEY);
    } catch (e) {
      if (!e.message.includes("(429)") || attempt === 3) return { text: e.message };
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

for (const file of readdirSync(AUDIO).sort()) {
  const { text, language } = await speech(readFileSync(`${AUDIO}/${file}`));
  report(text.includes(TOKENS[file]), `${file.padEnd(26)} ${language ?? ""}: ${text}`);
}

for (const file of ["image.svg", "sticker-animated.webp"]) {
  const jpeg = await toJpeg(readFileSync(fixture(file))).catch(() => Buffer.alloc(0));
  report(isJpeg(jpeg), `${file} → JPEG ${jpeg.length} bytes`);
}

for (const file of readdirSync(VIDEO).sort()) {
  const bytes = readFileSync(`${VIDEO}/${file}`);
  const want = VIDEOS[file];
  const v = await videoFrames(bytes).catch((e) => ({ error: e.message }));
  if (v.error) {
    report(false, `${file.padEnd(26)} ${v.error}`);
    continue;
  }
  const jpegs = await Promise.all(v.frames.map((f) => toJpeg(f.png).catch(() => Buffer.alloc(0))));
  const framesOk = v.frames.length === want.frames && jpegs.every(isJpeg) && v.sound === Boolean(want.token);
  const { text = "" } = want.token ? await speech(bytes) : {};
  const speechOk = !want.token || text.includes(want.token);
  report(framesOk && speechOk, `${file.padEnd(26)} ${v.duration}s, frames at ${v.frames.map((f) => f.seconds).join(", ")}, sound=${v.sound}${want.token ? `: ${text}` : ""}`);
}

// Exact times: sorted, deduplicated, and rejected past the end instead of moved.
const exact = await videoFrames(readFileSync(`${VIDEO}/fixture-mp4.mp4`), { times: [4.5, 0.5, 0.5, 10] });
const seconds = exact.frames.map((f) => f.seconds).join(", ");
report(seconds === "0.5, 4.5" && exact.rejected.join() === "10", `fixture-mp4.mp4 times      frames at ${seconds}, rejected ${exact.rejected.join(", ")}`);

// Each PDF either returns its tokens in the text of the right pages, or fails with the expected error.
// The scanned PDF has no text layer, so only its page image can show the token.
const PDF = fixture("pdf");
const PDFS = [
  ["fixture-text.pdf", {}, { pages: 2, text: { 1: "Invoice token 41", 2: "Second page token 52" } }],
  ["fixture-accents.pdf", {}, { pages: 1, text: { 1: "Cotação nº 63: açúcar e café" } }],
  ["fixture-scanned.pdf", {}, { pages: 1, text: { 1: "" } }],
  ["fixture-rotated.pdf", {}, { pages: 2, text: { 1: "Invoice token 41" } }],
  ["fixture-30-pages.pdf", { pages: [30, 15, 15, 99] }, { pages: 30, text: { 15: "Page 15 token 115", 30: "Page 30 token 130" }, images: [15, 30] }],
  ["fixture-owner-only.pdf", {}, { pages: 2, text: { 1: "Invoice token 41" } }],
  ["fixture-owner-only.pdf", { password: "wrong" }, { pages: 2, text: { 1: "Invoice token 41" } }],
  ["fixture-password-aes256.pdf", {}, { error: "This PDF needs a password" }],
  ["fixture-password-aes256.pdf", { password: "wrong" }, { error: "Wrong PDF password" }],
  ["fixture-password-aes256.pdf", { password: "secret" }, { pages: 2, text: { 2: "Second page token 52" } }],
  ["fixture-password-rc4.pdf", { password: "1234" }, { pages: 2, text: { 1: "Invoice token 41" } }],
  ["fixture-truncated.pdf", {}, { error: "Could not convert the PDF" }],
  ["fixture-not-a-pdf.pdf", {}, { error: "Could not convert the PDF" }],
];
for (const [file, options, want] of PDFS) {
  const label = `${file}${options.password ? ` (password ${options.password})` : ""}`.padEnd(40);
  const r = await readPdf(readFileSync(`${PDF}/${file}`), options).catch((e) => ({ error: e.message }));
  if (want.error || r.error) {
    report(r.error === want.error, `${label} ${r.error ?? `opened, expected "${want.error}"`}`);
    continue;
  }
  const textOk = Object.entries(want.text).every(([page, t]) => (t ? r.text[page - 1].includes(t) : r.text[page - 1] === ""));
  const jpegs = await Promise.all(r.images.map((i) => toJpeg(i.png).catch(() => Buffer.alloc(0))));
  const imagesOk = r.images.map((i) => i.page).join() === (want.images ?? [1]).join() && jpegs.every(isJpeg);
  report(r.pages === want.pages && textOk && imagesOk, `${label} ${r.pages} pages, images of ${r.images.map((i) => i.page).join(", ")}`);
}

// Other processes can read command arguments, so a PDF password must never be one.
const commands = [];
const execFile = childProcess.execFile;
childProcess.execFile = (file, args, ...rest) => {
  commands.push([file, ...args].join(" "));
  return execFile(file, args, ...rest);
};
syncBuiltinESMExports();
await readPdf(readFileSync(`${PDF}/fixture-password-aes256.pdf`), { password: "secret" });
await readPdf(readFileSync(`${PDF}/fixture-password-aes256.pdf`), { password: "wrong" }).catch(() => {});
childProcess.execFile = execFile;
syncBuiltinESMExports();
const leaked = commands.filter((c) => /secret|wrong/.test(c)).length;
report(commands.length > 0 && leaked === 0, `PDF password in a command line: ${leaked} of ${commands.length} commands`);

// packages/boleto's fixtures: a bill with a boleto and a Pix code, the same bill locked with 1234,
// and a PDF with no code. Each read runs the reader as its own process.
const BILL = new URL("../../../packages/boleto/fixtures", import.meta.url).pathname;
const BILLS = [
  ["boleto.pdf", undefined, "pdf unlocked boleto:confirmed pix:confirmed"],
  ["locked.pdf", undefined, "pdf locked"],
  ["locked.pdf", "nope", "pdf locked"],
  ["locked.pdf", "1234", "pdf unlocked boleto:confirmed pix:confirmed"],
  ["no-codes.pdf", undefined, "pdf unlocked"],
];
for (const [file, password, want] of BILLS) {
  const label = `bill ${file}${password ? ` (password ${password})` : ""}`.padEnd(40);
  const r = await readBill(readFileSync(`${BILL}/${file}`), password).catch((e) => ({ error: e.message }));
  const got = r.error ?? [r.type, r.locked ? "locked" : "unlocked", ...r.codes.map((c) => `${c.kind}:${c.status}`)].join(" ");
  report(got === want, `${label} ${got}`);
}

process.exit(failed ? 1 : 0);
