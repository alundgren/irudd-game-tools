import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  connectT3,
  disconnectT3,
  findT3Server,
  grantInfo,
  readT3Grant,
  t3GrantPath,
  usableGrant,
} from "@irudd/workshop/endpoint";
import { exit } from "./commands.js";

export const t3Usage = `Usage: irudd t3 <connect|status|disconnect> [--json] [--state-dir <dir>]

Let steering reach a running T3 Code turn ("irudd route <agent> --t3-thread <id> --mid-turn").

  connect      Register irudd with the running T3 Code server and print a page to open.
               Approve it there and pick an access level at least as broad as the
               threads you steer: T3 refuses to send to a thread that runs with broader
               modes than irudd was approved for. The grant lasts 30 days.
  status       Show the stored grant (never its token) and whether it is usable now.
  disconnect   Revoke the grant at T3 Code and delete it.

Without a grant, T3 routes still work: messages are queued as the thread's next turn.
`;

const t3Home = () => process.env["T3CODE_HOME"] ?? path.join(os.homedir(), ".t3");

export async function runT3(
  argv: ReadonlyArray<string>,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        "state-dir": { type: "string" },
        "timeout-min": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    err(`irudd t3: ${error instanceof Error ? error.message : String(error)}\n\n${t3Usage}`);
    return exit.usage;
  }
  const { values, positionals } = parsed;
  const action = positionals[0];
  if (values.help || action === undefined) {
    out(t3Usage);
    return action === undefined && !values.help ? exit.usage : exit.ok;
  }
  const stateDir = values["state-dir"];
  const grantFile = t3GrantPath(stateDir === undefined ? {} : { stateDir });
  const home = t3Home();
  const show = (value: unknown, line: string) => out(values.json ? JSON.stringify(value) : line);
  switch (action) {
    case "connect": {
      const minutes = Number(values["timeout-min"] ?? "10");
      try {
        const info = await connectT3({
          home,
          grantFile,
          timeoutMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60_000,
          onAuthorizeUrl: (url: string) =>
            err(
              `Open this page and approve irudd in T3 Code:\n\n  ${url}\n\nWaiting for approval…`,
            ),
        });
        show(
          { connected: true, ...info, grantFile },
          `Connected to T3 Code at ${info.origin} until ${new Date(info.expiresAt).toISOString()}. The grant is in ${grantFile}.`,
        );
        return exit.ok;
      } catch (error) {
        err(`irudd t3 connect: ${error instanceof Error ? error.message : String(error)}`);
        return exit.unavailable;
      }
    }
    case "status": {
      const grant = readT3Grant(grantFile);
      const server = findT3Server(home);
      const usable = usableGrant(grant, server);
      const value = {
        connected: grant !== undefined,
        usable,
        server: server ? { origin: server.origin, version: server.version ?? null } : null,
        grant: grant ? grantInfo(grant) : null,
        grantFile,
      };
      show(
        value,
        !grant
          ? `Not connected. T3 routes queue for the next turn. Run "irudd t3 connect" for mid-turn delivery.`
          : usable
            ? `Connected to T3 Code at ${grant.origin} until ${new Date(grant.expiresAt).toISOString()}.`
            : `A grant is stored but not usable now (${!server ? "T3 Code is not running" : grant.origin !== server.origin ? `it is for ${grant.origin}, T3 runs at ${server.origin}` : "it expired or belongs to another T3 install"}). Run "irudd t3 connect".`,
      );
      return exit.ok;
    }
    case "disconnect": {
      const done = await disconnectT3(home, grantFile);
      show(
        done,
        done.removed
          ? `Disconnected${done.revoked ? " and revoked at T3 Code" : " (T3 Code was not reachable to revoke it; it expires on its own)"}.`
          : "Not connected.",
      );
      return exit.ok;
    }
    default:
      err(`irudd t3: unknown action ${action}.\n\n${t3Usage}`);
      return exit.usage;
  }
}
