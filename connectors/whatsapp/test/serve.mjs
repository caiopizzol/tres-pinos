// Runs the tools in a child process for tools.test.mjs, answering its requests through an MCP client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/tools.mjs";

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await buildServer().connect(serverSide);
const client = new Client({ name: "test", version: "0" });
await client.connect(clientSide);

process.on("message", async ({ id, tools, name, args }) => {
  try {
    if (tools) return process.send({ id, result: (await client.listTools()).tools.map((t) => t.name) });
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) return process.send({ id, error: r.content[0].text });
    const [first] = r.content;
    process.send({ id, result: first.type !== "text" ? first : first.text.startsWith("Sent") ? first.text : JSON.parse(first.text) });
  } catch (e) {
    process.send({ id, error: e.message });
  }
});
