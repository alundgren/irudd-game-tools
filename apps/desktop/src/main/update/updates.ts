// Source updates for the installed app, following Scope's model: check the
// pinned branch, build the new commit on this computer beside the running
// version, then wait for the person to restart. A failed or canceled build
// leaves the running version and its links untouched; a retry starts over.

import path from "node:path";
import type { UpdateAction, UpdateStatus } from "../../shared/api.js";
import {
  buildDirectory,
  prune,
  readState,
  rollback,
  validateBuild,
  type Installation,
} from "./installation.js";
import { activateBuild, prepareBuild, relaunch, remoteHead } from "./process.js";

export interface UpdaterOptions {
  /** The running app's resources\app directory. */
  readonly appDirectory: string;
  readonly installation: Installation | undefined;
  readonly onChange: (status: UpdateStatus) => void;
  /** Arguments for the reopened app, computed when the person restarts. */
  readonly relaunchArgs: () => ReadonlyArray<string>;
  /** Quit this app after the new one has been asked to start. */
  readonly quit: () => void;
}

const short = (commit: string | undefined): string => (commit ? commit.slice(0, 12) : "");

export class Updater {
  private value: UpdateStatus;
  private controller: AbortController | undefined;
  private pending: Promise<void> | undefined;

  private readonly options: UpdaterOptions;

  constructor(options: UpdaterOptions) {
    this.options = options;
    const installation = options.installation;
    this.value = installation
      ? {
          phase: "idle",
          message: "Updates are checked when the app opens.",
          current: installation.commit,
          ...this.previousField(installation),
        }
      : {
          phase: "unmanaged",
          message: "Development build: no automatic updates. The installed app updates itself.",
        };
  }

  status(): UpdateStatus {
    return this.value;
  }

  private previousField(installation: Installation): { previous?: string } {
    try {
      const previous = readState(installation.root).previous;
      return !previous || previous === installation.commit ? {} : { previous };
    } catch {
      return {};
    }
  }

  private change(next: Partial<UpdateStatus>, replace = false): void {
    const merged: UpdateStatus = replace
      ? { phase: this.value.phase, message: this.value.message, ...next }
      : { ...this.value, ...next };
    this.value = merged;
    this.options.onChange(merged);
  }

  async act(action: UpdateAction): Promise<UpdateStatus> {
    switch (action) {
      case "status":
        break;
      case "check":
        void this.check();
        break;
      case "cancel":
        await this.cancel();
        break;
      case "restart":
        await this.restart();
        break;
      case "rollback":
        await this.rollback();
        break;
    }
    return this.value;
  }

  /** Check the branch and build a newer commit. Idempotent while a check runs. */
  check(): Promise<void> {
    const installation = this.options.installation;
    if (!installation || this.value.phase === "ready") return Promise.resolve();
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    this.change({ phase: "checking", message: `Checking ${installation.branch} for updates…` });
    this.pending = this.prepare(installation, controller.signal)
      .catch((error: unknown) => {
        const canceled = controller.signal.aborted;
        this.change(
          {
            current: installation.commit,
            ...this.previousField(installation),
            phase: canceled ? "idle" : "error",
            message: canceled
              ? "Build canceled. This version is still in use."
              : "Could not prepare the update. This version is still in use.",
            ...(canceled
              ? {}
              : { output: error instanceof Error ? error.message.slice(-8_000) : String(error) }),
          },
          true,
        );
      })
      .finally(() => {
        this.pending = undefined;
        this.controller = undefined;
      });
    return this.pending;
  }

  private async prepare(installation: Installation, signal: AbortSignal): Promise<void> {
    const { root } = installation;
    const source = path.join(root, "source");
    const commit = await remoteHead(source, installation.branch, signal);
    if (commit === installation.commit) {
      this.change(
        {
          phase: "idle",
          message: "This is the latest version.",
          current: installation.commit,
          ...this.previousField(installation),
        },
        true,
      );
      return;
    }
    const build = buildDirectory(root, commit);
    if (readState(root).prepared !== commit) {
      this.change({
        phase: "building",
        message: `Building ${short(commit)} on this computer. Keep working; the app restarts only when you choose.`,
        next: commit,
      });
      await prepareBuild(
        path.join(this.options.appDirectory, "install.ps1"),
        commit,
        {
          IRUDD_INSTALL_ROOT: root,
          IRUDD_REPOSITORY: installation.origin,
          IRUDD_BRANCH: installation.branch,
          IRUDD_VP: installation.vp,
        },
        root,
        signal,
        (output) => this.change({ output }),
      );
    }
    if (readState(root).prepared !== commit)
      throw new Error("The installer did not record the prepared build.");
    validateBuild(root, build);
    this.change(
      {
        phase: "ready",
        message: `Version ${short(commit)} is ready. Restart when you are ready.`,
        current: installation.commit,
        next: commit,
        ...this.previousField(installation),
      },
      true,
    );
  }

  async cancel(): Promise<void> {
    this.controller?.abort();
    await this.pending;
  }

  private reopen(): void {
    const installation = this.options.installation;
    if (!installation) return;
    relaunch(path.join(installation.root, "Irudd Workshop.exe"), this.options.relaunchArgs());
    this.options.quit();
  }

  /** Make the prepared build current and reopen the app on it. */
  async restart(): Promise<void> {
    const installation = this.options.installation;
    if (!installation || this.value.phase !== "ready" || !this.value.next)
      throw new Error("No update is ready.");
    try {
      const build = buildDirectory(installation.root, this.value.next);
      validateBuild(installation.root, build);
      await activateBuild(build, installation.root);
    } catch (error) {
      this.change({
        phase: "error",
        message:
          "The updater stopped during restart. Reopen Workshop from its launcher to use the active build.",
        output: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.reopen();
  }

  /** Return to the previous build and reopen the app on it. */
  async rollback(): Promise<void> {
    const installation = this.options.installation;
    if (!installation) throw new Error("Rollback is available in the installed app.");
    if (this.pending) throw new Error("Cancel the running build first.");
    try {
      await rollback(installation.root);
    } catch (error) {
      this.change({
        phase: "error",
        message: "Could not return to the earlier version.",
        output: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.reopen();
  }

  /** Remove builds no link or running process uses. */
  /**
   * Complete what a killed update step left and remove builds no role or
   * running process uses. Skipped while another step holds the installation.
   */
  async prune(): Promise<void> {
    const installation = this.options.installation;
    if (!installation) return;
    try {
      await prune(installation.root, [path.resolve(this.options.appDirectory, "..", "..", "..")]);
    } catch {
      // Housekeeping; a later start retries.
    }
  }
}
