import { stagePicture } from "../art-files.js";
import type { PanelContext } from "./context.js";

export async function agentTraceMap(
  ctx: PanelContext,
  agent: string,
  direction: string,
  height: number,
  views: readonly HTMLCanvasElement[],
  sheet: string,
  current: () => boolean,
) {
  const view = ctx.view;
  if (!view || !agent) throw new Error("Choose a connected workshop agent.");
  const attachments = await Promise.all(
    views.map(async (canvas, i) => {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Could not read the trace view."))),
          "image/png",
        ),
      );
      const image = await stagePicture(ctx.host, new Uint8Array(await blob.arrayBuffer()));
      return { role: i === 0 ? ("front" as const) : ("side" as const), digest: image.digest };
    }),
  );
  if (!current()) return;
  const request = await ctx.host.call("art.request", {
    agent,
    requestId: "trace-" + crypto.randomUUID(),
    brief: {
      format: "irudd.art-brief",
      version: 1,
      kind: "trace",
      intent: "character",
      height,
      documentId: view.documentId,
      revision: view.revision,
      direction: direction.trim() || "Identify and articulate the pictured character or item.",
      attachments: [...attachments, { role: "source-sheet", digest: sheet }],
    },
  });
  while (current()) {
    const update = await ctx.host.call("art.get", { artId: request.artId });
    if (update.state === "cancelled" || update.stale) break;
    const submission = [...update.submissions]
      .reverse()
      .find((s) => s.state !== "rejected" && s.reply.kind === "trace");
    if (submission?.reply.kind === "trace" && current()) return submission.reply.traceMap;
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  }
  await ctx.host.call("art.cancel", { artId: request.artId });
  return undefined;
}
