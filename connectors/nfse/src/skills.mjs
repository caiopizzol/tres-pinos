// The skills that come with this connector, so an agent that has it also has the instructions that use it. The agent
// reads them with read_skill: each skill's SKILL.md and the files in its references/, nothing else.
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

const NAMES = ["emitir-nfse", "estimar-impostos"];

// Read once, when the connector starts: the address an agent asks for, such as skill://emitir-nfse/SKILL.md, and
// its text. Only these addresses are answered, so no path an agent makes up reaches another file.
const files = new Map();
const skills = NAMES.map((name) => {
  const dir = new URL(`../../../skills/${name}/`, import.meta.url);
  const skill = readFileSync(new URL("SKILL.md", dir), "utf8");
  files.set(`skill://${name}/SKILL.md`, skill);
  for (const file of readdirSync(new URL("references/", dir)))
    files.set(
      `skill://${name}/references/${file}`,
      readFileSync(new URL(`references/${file}`, dir), "utf8"),
    );
  return { name, description: /^description: (.+)$/m.exec(skill)[1] };
});

export function offerSkills(server) {
  server.registerTool(
    "read_skill",
    {
      description: `Reads a skill that comes with this connector: the instructions for a job done with its tools. Before doing a skill's job, read its SKILL.md, then each file it links to, relative to the skill, such as skill://emitir-nfse/references/exportacao.md. The skills:\n${skills.map((s) => `- skill://${s.name}/SKILL.md: ${s.description}`).join("\n")}`,
      inputSchema: { uri: z.string().max(200).describe("Such as skill://emitir-nfse/SKILL.md") },
      annotations: { readOnlyHint: true },
    },
    ({ uri }) =>
      files.has(uri)
        ? { content: [{ type: "text", text: files.get(uri) }] }
        : { isError: true, content: [{ type: "text", text: "No such skill file" }] },
  );
}
