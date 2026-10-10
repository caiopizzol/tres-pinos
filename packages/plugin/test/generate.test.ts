import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/generate.ts";

const skills = join(import.meta.dir, "../fixtures/skills");
const out = () => join(mkdtempSync(join(tmpdir(), "plugin-")), "tres-pinos");
const read = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));

test("writes one MCP server per connector, and only the skills it can run", () => {
	const dir = out();
	const result = generate({ connectors: { whatsapp: "https://whatsapp.example.com/mcp" }, out: dir, skills });
	expect(result.skills).toEqual(["whatsapp-only"]);
	expect(existsSync(join(dir, "skills/needs-sicoob"))).toBe(false);
	expect(read(dir, "mcp.json").mcpServers).toEqual({ whatsapp: { type: "streamable-http", url: "https://whatsapp.example.com/mcp" } });
	expect(read(dir, "plugin.json").name).toBe("tres-pinos");
	expect(read(dir, ".agents/plugins/marketplace.json").plugins[0].source).toEqual({ source: "local", path: "./" });
});

test("accepts plain http only on this machine", () => {
	for (const url of ["http://127.0.0.1:3011/mcp", "http://localhost:3011/mcp"]) {
		expect(() => generate({ connectors: { whatsapp: url }, out: out(), skills })).not.toThrow();
	}
	expect(() => generate({ connectors: { whatsapp: "http://whatsapp.example.com/mcp" }, out: out(), skills })).toThrow(/https/);
});

test("refuses no connectors and unknown ones", () => {
	expect(() => generate({ connectors: {}, out: out(), skills })).toThrow(/at least one/);
	expect(() => generate({ connectors: { gmail: "https://gmail.example.com/mcp" }, out: out(), skills })).toThrow(/Unknown connector/);
});
