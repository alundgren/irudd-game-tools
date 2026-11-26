import path from "node:path";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ChannelBridge, channelCapability, newChannelInstance } from "./channel.js";
import { HostConnection, localAgent } from "./connection.js";
import { registerReviewTools } from "./review.js";
import { registerArtTools } from "./art.js";
import { registerTools } from "./tools.js";
import { buildId } from "./build.js";

const usage = `Usage: irudd mcp [--credential <file> | --project <dir>] [--agent <id>] [--channel [--server <name>]]

Run the workshop MCP server on stdin/stdout.

Without a credential the server looks for the running Irudd Workshop on every
tool call and pairs itself as this agent: claude for Claude Code, codex for
Codex. It needs no setup; "irudd agents connect" registers it with both. While
the workshop is closed, tool calls say so, and the first call after it opens
works.

Options:
  --credential <file>   Act as the agent of this credential from "irudd pair"
                        (default: $IRUDD_AGENT_CREDENTIAL).
  --project <dir>       Use the host for this project instead of the running
                        desktop workshop (default: $IRUDD_PROJECT).
  --agent <id>          Pair under this agent ID instead of one taken from the
                        MCP client's name.
  --channel             Offer a Claude Code channel: the person's steering
                        messages are pushed into the session that started this
                        server. Start that session with
                        --dangerously-load-development-channels server:<name>.
  --server <name>       This server's name in the session's MCP config
                        (default irudd), shown to the person when binding.
  -h, --help            Show this help.
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      credential: { type: "string" },
      project: { type: "string" },
      agent: { type: "string" },
      channel: { type: "boolean" },
      server: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (error) {
  process.stderr.write(
    `irudd mcp: ${error instanceof Error ? error.message : String(error)}\n\n${usage}`,
  );
  process.exit(2);
}
if (values.help) {
  process.stdout.write(usage);
  process.exit(0);
}
const credential = values.credential ?? process.env["IRUDD_AGENT_CREDENTIAL"];
const project = values.project ?? process.env["IRUDD_PROJECT"];
if (values.agent !== undefined && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(values.agent)) {
  process.stderr.write(`irudd mcp: use a short lowercase agent ID such as claude.\n\n${usage}`);
  process.exit(2);
}

const log = (line: string) => process.stderr.write(`[irudd mcp] ${line}\n`);
let server: McpServer;
const host = new HostConnection(
  credential
    ? { kind: "credential", file: credential }
    : {
        kind: "auto",
        project: project ? path.resolve(project) : undefined,
        agent: () => localAgent(server.server.getClientVersion()?.name, values.agent),
      },
  process.env["IRUDD_STATE_DIR"],
);
server = new McpServer(
  { name: "irudd-workshop", version: buildId() },
  {
    instructions:
      'Tools for Irudd Workshop, a desktop app for shaping 3D game characters. They act on the project open in the running app; if it is closed, a call says so and you can ask the person to open it. When the person mentions the workshop, a character in it, or something they sent from it, call read_inbox first: requests and art briefs they send from the app wait there. Read a document before changing it and pass its revision as baseRevision. Give every change a requestId and reuse it when retrying. You propose changes; a person accepts them. Use read_changes with by=human to see a person\'s manual edits and build on them. The person steers you with messages: read_inbox lists them, ack_steering acknowledges one, and report_applied links the request you committed for it. With the channel enabled, messages also arrive in this conversation as <channel source="irudd" message_id="…"> events: treat each as the person\'s instruction, acknowledge it once, and treat a repeated message_id as already handled. Art briefs from the person arrive the same way: read one with art_brief, make the artwork yourself in this conversation, and answer with art_submit; the workshop never generates images. To see a character, use inspect_character: it exports a committed revision and renders the actual GLB off screen, returning images bound to that revision; never capture the person\'s screen.',
  },
);
registerTools(server, host);
registerReviewTools(server, host);
registerArtTools(server, host);
const transport = new StdioServerTransport();

let bridge: ChannelBridge | undefined;
if (values.channel) {
  const instance = newChannelInstance();
  server.server.registerCapabilities({ experimental: { [channelCapability]: {} } });
  const channel = new ChannelBridge({
    host,
    instance,
    server: values.server ?? "irudd",
    client: () => server.server.getClientVersion(),
    notify: (content, meta) =>
      transport.send({
        jsonrpc: "2.0",
        method: "notifications/claude/channel",
        params: { content, meta },
      }),
    log,
  });
  bridge = channel;
  server.server.oninitialized = () => {
    log(
      `channel instance ${instance}: a person binds it with "irudd route <agent> --claude-channel ${instance}"`,
    );
    void channel.run();
  };
}
await server.connect(transport);
log("ready on stdio");

const stop = () => {
  bridge?.stop();
  host.close();
  void server.close().finally(() => process.exit(0));
};
process.stdin.on("end", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
