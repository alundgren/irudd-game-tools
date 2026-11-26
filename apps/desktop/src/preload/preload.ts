// The sandboxed preload: exposes `window.workshop`, one function per bridge
// method, and nothing else. It forwards arguments to main, which validates
// them, and hands replies to the page as unknown values for the page to check.
// No Node API, no generic IPC and no event objects reach the page.

import { contextBridge, ipcRenderer } from "electron";
import { channels, type PreloadApi } from "../shared/api.js";

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const reply: unknown = await ipcRenderer.invoke(channel, ...args);
  return reply;
}

const api: PreloadApi = {
  app: () => invoke(channels.app),
  projectState: () => invoke(channels.projectState),
  openProject: (directory) => invoke(channels.openProject, directory),
  createProject: (kind) => invoke(channels.createProject, kind),
  call: (method, params) => invoke(channels.call, method, params),
  onCommit(listener) {
    const forward = (_event: unknown, notice: unknown): void => listener(notice);
    ipcRenderer.on(channels.commit, forward);
    return () => {
      ipcRenderer.removeListener(channels.commit, forward);
    };
  },
  onSteer(listener) {
    const forward = (_event: unknown, notice: unknown): void => listener(notice);
    ipcRenderer.on(channels.steer, forward);
    return () => {
      ipcRenderer.removeListener(channels.steer, forward);
    };
  },
  library: () => invoke(channels.library),
  humanPack: (file) => invoke(channels.humanPack, file),
  readLibrary: (id) => invoke(channels.readLibrary, id),
  openGlb: () => invoke(channels.openGlb),
  saveExport: (request) => invoke(channels.saveExport, request),
  saveInspection: (request) => invoke(channels.saveInspection, request),
  saveCharacter: (documentId) => invoke(channels.saveCharacter, documentId),
  openCharacter: () => invoke(channels.openCharacter),
  update: (action) => invoke(channels.update, action),
  onUpdate(listener) {
    const forward = (_event: unknown, status: unknown): void => listener(status);
    ipcRenderer.on(channels.updateStatus, forward);
    return () => {
      ipcRenderer.removeListener(channels.updateStatus, forward);
    };
  },
};

contextBridge.exposeInMainWorld("workshop", api);
