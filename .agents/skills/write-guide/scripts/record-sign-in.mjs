// Records a connector's sign-in page as a GIF, with fictional data: an AI app sends the owner there, they enter the
// key and allow it. The connector is its real server.mjs, so the page in the GIF is the one people see.
//
//   node record-sign-in.mjs <connector> <out.gif>
//
// Needs Playwright with Chromium, and ffmpeg.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const [connector, out] = process.argv.slice(2);
if (!connector || !out) throw new Error("Usage: node record-sign-in.mjs <connector> <out.gif>");
const NAME = connector.toUpperCase();
const KEY = "k".repeat(32);
const work = mkdtempSync(join(tmpdir(), "record-sign-in-"));

// A fictional certificate and key, which every connector checks before it starts. The settings it needs besides them
// get fictional values too; nothing here reaches a real service.
const PASSWORD = "senha-ficticia";
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-days",
    "1",
    "-subj",
    "/CN=EMPRESA FICTICIA LTDA",
    "-passout",
    `pass:${PASSWORD}`,
    "-keyout",
    join(work, "c.key"),
    "-out",
    join(work, "c.crt"),
  ],
  { stdio: "ignore" },
);
// Two free ports: the connector's, and the AI app's return address, which the connector accepts on any loopback port.
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
const PORT = await freePort();
const URL_ = `http://127.0.0.1:${PORT}`;
const app = createServer((_, res) =>
  res
    .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    .end(
      `<body style="font:16px/1.5 system-ui;color:#1D1D1F;background:#F6F5F1;display:grid;place-items:center;height:90vh;margin:0"><p><b>${connector}</b> conectado ✓</p>`,
    ),
);
await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
const CALLBACK = `http://127.0.0.1:${app.address().port}/callback`;

const env = {
  ...process.env,
  PORT: String(PORT),
  PUBLIC_URL: URL_,
  DATA_DIR: join(work, "data"),
  [`${NAME}_KEY`]: KEY,
  [`${NAME}_CERT_PATH`]: join(work, "c.crt"),
  [`${NAME}_CERT_KEY_PATH`]: join(work, "c.key"),
  [`${NAME}_CERT_PASSWORD`]: PASSWORD,
  [`${NAME}_CLIENT_ID`]: "client-id",
  [`${NAME}_CLIENT_SECRET`]: "client-secret",
  [`${NAME}_ACCOUNT`]: "1234567",
};
const server = spawn(process.execPath, [`connectors/${connector}/src/server.mjs`], {
  env,
  stdio: "inherit",
});

let browser;
try {
  for (let i = 0; ; i++) {
    if (
      await fetch(`${URL_}/mcp`, { method: "POST" }).then(
        () => true,
        () => false,
      )
    )
      break;
    if (i > 100 || server.exitCode !== null) throw new Error(`${connector} did not start`);
    await new Promise((r) => setTimeout(r, 100));
  }

  // What an AI app does before opening the page: register, then send the owner to /authorize.
  const registered = await fetch(`${URL_}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }),
  });
  if (registered.status !== 201)
    throw new Error(
      `${connector} has no sign-in page: its server.mjs doesn't pass PUBLIC_URL to serve()`,
    );
  const client = await registered.json();
  const authorize = new URL(`${URL_}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "s",
    resource: `${URL_}/mcp`,
  });

  browser = await chromium.launch();
  const size = { width: 640, height: 420 };
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: work, size } });
  const page = await context.newPage();
  await page.goto(authorize.href);
  await page.waitForTimeout(1200);
  const field = page.getByLabel("Chave do conector");
  await field.pressSequentially(KEY.slice(0, 20), { delay: 40 });
  await field.fill(KEY);
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Permitir" }).click();
  await page.waitForURL((u) => u.href.startsWith(`${CALLBACK}?code=`));
  await page.waitForTimeout(1200);
  const video = await page.video().path();
  await context.close();

  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    video,
    "-loop",
    "0",
    "-vf",
    "fps=12,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    out,
  ]);
  console.log(out);
} finally {
  await browser?.close();
  server.kill();
  app.close();
  rmSync(work, { recursive: true, force: true });
}
