import { stdin, stdout } from "node:process";

let buffer = Buffer.alloc(0);

stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainFrames();
});

function drainFrames() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
    if (!Number.isFinite(length)) {
      throw new Error("Missing Content-Length");
    }

    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) {
      return;
    }

    const request = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.slice(bodyEnd);
    handleRequest(request);
  }
}

function handleRequest(request) {
  if (request.method === "initialize") {
    writeResponse(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "ore-code-fake-mcp", version: "0.1.0" }
    });
    return;
  }

  if (request.method === "tools/list") {
    writeResponse(request.id, {
      tools: [
        {
          name: "read_context",
          description: "Read fake project context",
          inputSchema: {
            type: "object",
            properties: { topic: { type: "string" } },
            additionalProperties: false
          },
          annotations: { readOnlyHint: true }
        },
        {
          name: "write_note",
          description: "Write a fake project note",
          inputSchema: {
            type: "object",
            properties: { note: { type: "string" } },
            required: ["note"],
            additionalProperties: false
          }
        }
      ]
    });
    return;
  }

  if (request.method === "tools/call") {
    const { name, arguments: args = {} } = request.params ?? {};
    if (name === "read_context") {
      writeResponse(request.id, {
        content: [{ type: "text", text: `context:${args.topic ?? "general"}` }],
        isError: false
      });
      return;
    }
    if (name === "write_note") {
      writeResponse(request.id, {
        content: [{ type: "text", text: `stored:${args.note}` }],
        isError: false
      });
      return;
    }
  }

  writeError(request.id, -32601, `Unsupported method or tool: ${request.method}`);
}

function writeResponse(id, result) {
  writeFrame({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeFrame({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeFrame(response) {
  const body = Buffer.from(JSON.stringify(response), "utf8");
  stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  stdout.write(body);
}
