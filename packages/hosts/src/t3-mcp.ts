import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export interface T3Server {
  readonly origin: string;
  readonly pid: number;
  readonly ownerId?: string;
  readonly version?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

function loopbackOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "EPERM";
  }
}

export function findT3Server(home: string): T3Server | undefined {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(path.join(home, "userdata", "server-runtime.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const origin = loopbackOrigin(str(value, "origin") ?? "");
  const pid = value["pid"];
  if (!origin || typeof pid !== "number" || !alive(pid)) return undefined;
  const ownerId = str(value, "ownerId");
  const version = str(value, "serverVersion");
  return {
    origin,
    pid,
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(version === undefined ? {} : { version }),
  };
}

export interface T3Grant {
  readonly format: "irudd.t3-grant";
  readonly version: 1;
  readonly origin: string;
  readonly ownerId?: string;
  readonly clientId: string;
  readonly accessToken: string;
  readonly scope: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export interface T3GrantInfo {
  readonly origin: string;
  readonly ownerId?: string;
  readonly clientId: string;
  readonly scope: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export function readT3Grant(file: string): T3Grant | undefined {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value["format"] !== "irudd.t3-grant" || value["version"] !== 1)
    return undefined;
  const origin = str(value, "origin");
  const clientId = str(value, "clientId");
  const accessToken = str(value, "accessToken");
  const scope = str(value, "scope") ?? "";
  const grantedAt = value["grantedAt"];
  const expiresAt = value["expiresAt"];
  if (!origin || !clientId || !accessToken) return undefined;
  if (typeof grantedAt !== "number" || typeof expiresAt !== "number") return undefined;
  const ownerId = str(value, "ownerId");
  return {
    format: "irudd.t3-grant",
    version: 1,
    origin,
    ...(ownerId === undefined ? {} : { ownerId }),
    clientId,
    accessToken,
    scope,
    grantedAt,
    expiresAt,
  };
}

export function grantInfo(grant: T3Grant): T3GrantInfo {
  return {
    origin: grant.origin,
    ...(grant.ownerId === undefined ? {} : { ownerId: grant.ownerId }),
    clientId: grant.clientId,
    scope: grant.scope,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
  };
}

function writeT3Grant(file: string, grant: T3Grant): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function usableGrant(
  grant: T3Grant | undefined,
  server: T3Server | undefined,
  now = Date.now(),
): boolean {
  if (!grant || !server) return false;
  if (grant.origin !== server.origin) return false;
  if (
    grant.ownerId !== undefined &&
    server.ownerId !== undefined &&
    grant.ownerId !== server.ownerId
  )
    return false;
  return grant.expiresAt > now + 60_000;
}

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

async function request(
  url: string,
  init: RequestInit & { readonly timeoutMs: number },
): Promise<Reply> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(init.timeoutMs),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface ConnectT3Options {
  readonly home: string;
  readonly grantFile: string;
  readonly clientName?: string;
  readonly onAuthorizeUrl: (url: string) => void;
  readonly timeoutMs?: number;
}

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

export async function connectT3(options: ConnectT3Options): Promise<T3GrantInfo> {
  const server = findT3Server(options.home);
  if (!server) throw new Error(`No running T3 Code server records itself under ${options.home}.`);
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const resource = new URL("/mcp", server.origin).href;
  const metadata = json(
    (
      await request(new URL("/.well-known/oauth-authorization-server", server.origin).href, {
        timeoutMs: 15_000,
      })
    ).text,
  );
  if (!isRecord(metadata)) throw new Error("T3 Code published no authorization metadata.");
  const issuer = str(metadata, "issuer");
  const authorize = str(metadata, "authorization_endpoint");
  const token = str(metadata, "token_endpoint");
  const register = str(metadata, "registration_endpoint");
  if (!issuer || !authorize || !token || !register)
    throw new Error("T3 Code's authorization metadata is incomplete.");
  for (const endpoint of [authorize, token, register])
    if (new URL(endpoint).origin !== server.origin)
      throw new Error(`T3 Code named an endpoint outside ${server.origin}: ${endpoint}`);

  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  let finish: (value: URLSearchParams) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const callback = new Promise<URLSearchParams>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const listener = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.get("state") === state;
    res
      .writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" })
      .end(
        ok
          ? "irudd: T3 Code answered. You can close this tab."
          : "irudd: this answer does not match the request.",
      );
    if (ok) finish(url.searchParams);
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const redirectUri = `http://127.0.0.1:${String(port)}/callback`;
  const timer = setTimeout(() => fail(new Error("T3 Code was not approved in time.")), timeoutMs);
  try {
    const registered = json(
      (
        await request(register, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            client_name: options.clientName ?? "irudd workshop steering",
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none",
          }),
          timeoutMs: 15_000,
        })
      ).text,
    );
    const clientId = isRecord(registered) ? str(registered, "client_id") : undefined;
    if (!clientId) throw new Error("T3 Code refused to register irudd as an MCP client.");
    const url = new URL(authorize);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("resource", resource);
    url.searchParams.set("scope", "orchestration:read orchestration:operate");
    options.onAuthorizeUrl(url.href);

    const answer = await callback;
    const error = answer.get("error");
    if (error)
      throw new Error(
        `T3 Code did not approve: ${error}${answer.get("error_description") ? ` (${answer.get("error_description") ?? ""})` : ""}`,
      );
    const iss = answer.get("iss");
    if (iss !== null && iss !== issuer)
      throw new Error("The approval came from another authorization server.");
    const code = answer.get("code");
    if (!code) throw new Error("T3 Code's answer carried no authorization code.");
    const exchanged = await request(token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }).toString(),
      timeoutMs: 15_000,
    });
    const issued = json(exchanged.text);
    const accessToken = isRecord(issued) ? str(issued, "access_token") : undefined;
    const expiresIn = isRecord(issued) ? issued["expires_in"] : undefined;
    if (!accessToken || typeof expiresIn !== "number")
      throw new Error(`T3 Code refused the token exchange (HTTP ${String(exchanged.status)}).`);
    const now = Date.now();
    const grant: T3Grant = {
      format: "irudd.t3-grant",
      version: 1,
      origin: server.origin,
      ...(server.ownerId === undefined ? {} : { ownerId: server.ownerId }),
      clientId,
      accessToken,
      scope: (isRecord(issued) ? str(issued, "scope") : undefined) ?? "",
      grantedAt: now,
      expiresAt: now + expiresIn * 1000,
    };
    writeT3Grant(options.grantFile, grant);
    return grantInfo(grant);
  } finally {
    clearTimeout(timer);
    listener.close();
  }
}

export async function disconnectT3(
  home: string,
  grantFile: string,
): Promise<{ readonly removed: boolean; readonly revoked: boolean }> {
  const grant = readT3Grant(grantFile);
  if (!grant) {
    fs.rmSync(grantFile, { force: true });
    return { removed: false, revoked: false };
  }
  let revoked = false;
  const server = findT3Server(home);
  if (server && server.origin === grant.origin) {
    try {
      const reply = await request(new URL("/oauth/mcp/revoke", server.origin).href, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: grant.accessToken,
          token_type_hint: "access_token",
        }).toString(),
        timeoutMs: 15_000,
      });
      revoked = reply.status === 200;
    } catch {
      revoked = false;
    }
  }
  fs.rmSync(grantFile, { force: true });
  return { removed: true, revoked };
}

export type ToolCallResult =
  | {
      readonly kind: "answered";
      readonly isError: boolean;
      readonly structured: unknown;
      readonly text: string;
    }
  | { readonly kind: "unauthorized"; readonly detail: string }
  | { readonly kind: "not-sent"; readonly detail: string }
  | { readonly kind: "unknown"; readonly detail: string };

const protocolVersion = "2025-06-18";

function rpcResponse(reply: Reply, id: number): Record<string, unknown> | undefined {
  const type = reply.headers.get("content-type") ?? "";
  const candidates: unknown[] = [];
  if (type.includes("text/event-stream")) {
    for (const event of reply.text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) candidates.push(json(data));
    }
  } else candidates.push(json(reply.text));
  for (const candidate of candidates.flat())
    if (isRecord(candidate) && candidate["id"] === id) return candidate;
  return undefined;
}

export async function callT3Tool(
  origin: string,
  accessToken: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<ToolCallResult> {
  const endpoint = new URL("/mcp", origin).href;
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  let initialized: Reply;
  try {
    initialized = await request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "irudd-steering", version: "1" },
        },
      }),
      timeoutMs: 15_000,
    });
  } catch (error) {
    return { kind: "not-sent", detail: `T3 Code's MCP endpoint did not answer: ${String(error)}` };
  }
  if (initialized.status === 401 || initialized.status === 403)
    return {
      kind: "unauthorized",
      detail: `T3 Code refused irudd's authorization (HTTP ${String(initialized.status)}). Run "irudd t3 connect" again.`,
    };
  const init = rpcResponse(initialized, 1);
  if (initialized.status >= 300 || !init || init["error"] !== undefined)
    return {
      kind: "not-sent",
      detail: `T3 Code's MCP endpoint refused the session (HTTP ${String(initialized.status)}).`,
    };
  const session = initialized.headers.get("mcp-session-id");
  const negotiated = isRecord(init["result"]) ? str(init["result"], "protocolVersion") : undefined;
  const sessionHeaders: Record<string, string> = {
    ...headers,
    "mcp-protocol-version": negotiated ?? protocolVersion,
    ...(session ? { "mcp-session-id": session } : {}),
  };
  try {
    await request(endpoint, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      timeoutMs: 15_000,
    });
  } catch (error) {
    return { kind: "not-sent", detail: `T3 Code's MCP session did not start: ${String(error)}` };
  }
  let called: Reply;
  try {
    called = await request(endpoint, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      timeoutMs,
    });
  } catch (error) {
    return { kind: "unknown", detail: `No answer from ${tool}: ${String(error)}` };
  } finally {
    if (session)
      void request(endpoint, { method: "DELETE", headers: sessionHeaders, timeoutMs: 5_000 }).catch(
        () => undefined,
      );
  }
  if (called.status === 401 || called.status === 403)
    return {
      kind: "unauthorized",
      detail: `T3 Code refused irudd's authorization (HTTP ${String(called.status)}). Run "irudd t3 connect" again.`,
    };
  const response = rpcResponse(called, 2);
  if (!response)
    return {
      kind: "unknown",
      detail: `${tool} answered HTTP ${String(called.status)} with no result.`,
    };
  const error = response["error"];
  if (isRecord(error))
    return {
      kind: "answered",
      isError: true,
      structured: undefined,
      text: (str(error, "message") ?? "error").slice(0, 400),
    };
  const result = response["result"];
  if (!isRecord(result)) return { kind: "unknown", detail: `${tool} returned no result.` };
  const content = Array.isArray(result["content"]) ? result["content"] : [];
  const text = content
    .map((part: unknown) => (isRecord(part) ? (str(part, "text") ?? "") : ""))
    .join("\n")
    .slice(0, 400);
  return {
    kind: "answered",
    isError: result["isError"] === true,
    structured: result["structuredContent"],
    text,
  };
}
