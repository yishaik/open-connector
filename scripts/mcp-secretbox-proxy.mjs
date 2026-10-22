import { createInterface } from "node:readline";

const endpoint = process.env.OPENCONNECTOR_MCP_URL;
const token = process.env.OPENCONNECTOR_MCP_TOKEN;

if (!endpoint || !token) {
  console.error("OPENCONNECTOR_MCP_URL and OPENCONNECTOR_MCP_TOKEN are required");
  process.exit(1);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    continue;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: line,
    });

    const body = await response.text();
    if (!body) continue;

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for (const eventLine of body.split(/\r?\n/)) {
        if (!eventLine.startsWith("data:")) continue;
        const data = eventLine.slice(5).trim();
        if (data && data !== "[DONE]") process.stdout.write(`${data}\n`);
      }
    } else {
      process.stdout.write(`${body.trim()}\n`);
    }
  } catch (error) {
    if (request.id !== undefined) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        })}\n`,
      );
    }
  }
}
