// Writes an Agent Plugins package (https://agent-plugins.org) for one deployment: an MCP server per connector, the
// skills whose connectors are all enabled, and a marketplace file so Codex can install it from the folder.
// Run from the repository root: bun run plugin whatsapp=https://whatsapp.example.com/mcp
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPEC = "https://agent-plugins.org/schemas/1.0.0";
const ROOT = join(import.meta.dir, "../../..");
const NAME = "tres-pinos";

type Options = { connectors: Record<string, string>; out: string; skills?: string };

// A skill names the connectors it needs in its frontmatter: `metadata: connectors: whatsapp sicoob`.
function connectorsOf(skill: string): string[] {
	const frontmatter = readFileSync(join(skill, "SKILL.md"), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!frontmatter) throw new Error(`${skill}/SKILL.md has no frontmatter`);
	const { metadata } = Bun.YAML.parse(frontmatter) as { metadata?: { connectors?: string } };
	return metadata?.connectors?.split(/\s+/).filter(Boolean) ?? [];
}

// Plain http only reaches this machine; anything else needs https, as Agent Plugins requires.
function checkUrl(connector: string, url: string) {
	const { protocol, hostname } = new URL(url);
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
	if (protocol !== "https:" && !(protocol === "http:" && local)) throw new Error(`${connector} needs an https URL`);
}

const json = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

export function generate({ connectors, out, skills = join(ROOT, "skills") }: Options) {
	const enabled = Object.keys(connectors);
	if (enabled.length === 0) throw new Error("Name at least one connector, such as whatsapp=https://…/mcp");
	for (const [connector, url] of Object.entries(connectors)) {
		if (!existsSync(join(ROOT, "connectors", connector))) throw new Error(`Unknown connector: ${connector}`);
		checkUrl(connector, url);
	}

	rmSync(out, { recursive: true, force: true });
	mkdirSync(join(out, ".agents/plugins"), { recursive: true });
	json(join(out, "plugin.json"), {
		$schema: `${SPEC}/plugin.schema.json`,
		name: NAME,
		description: "Ligue seu agente de IA no Brasil.",
		license: "MIT",
	});
	json(join(out, "mcp.json"), {
		$schema: `${SPEC}/mcp.schema.json`,
		mcpServers: Object.fromEntries(enabled.map((c) => [c, { type: "streamable-http", url: connectors[c] }])),
	});
	json(join(out, ".agents/plugins/marketplace.json"), {
		name: NAME,
		interface: { displayName: "Três Pinos" },
		plugins: [{ name: NAME, source: { source: "local", path: "./" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }],
	});

	const included = readdirSync(skills).filter((s) => connectorsOf(join(skills, s)).every((c) => enabled.includes(c)));
	for (const s of included) cpSync(join(skills, s), join(out, "skills", s), { recursive: true });
	return { connectors: enabled, skills: included };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const pairs = args.map((arg) => arg.match(/^([a-z0-9-]+)=(.+)$/)?.slice(1) as [string, string] | undefined);
	if (args.length === 0 || pairs.some((p) => !p)) throw new Error("Usage: bun run plugin <connector>=<url> …");
	const out = join(ROOT, "plugins", NAME);
	const { skills } = generate({ connectors: Object.fromEntries(pairs as [string, string][]), out });
	console.log(`Plugin in plugins/${NAME}, with skills: ${skills.join(", ") || "none"}.`);
	console.log(`Codex: codex plugin marketplace add ./plugins/${NAME} && codex plugin add ${NAME}@${NAME}`);
}
