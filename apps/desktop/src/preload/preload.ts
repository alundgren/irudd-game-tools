import { contextBridge, ipcRenderer } from "electron";
import { channels, type PreloadApi } from "../shared/api.js";

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const reply: unknown = await ipcRenderer.invoke(channel, ...args);
  return reply;
}

const api: PreloadApi = {
  copyDirection: (code) => invoke(channels.copyDirection, code),
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
  bundledImage: (digest) => invoke(channels.bundledImage, digest),
  humanPack: (file) => invoke(channels.humanPack, file),
  readLibrary: (id) => invoke(channels.readLibrary, id),
  openGlb: () => invoke(channels.openGlb),
  saveExport: (request) => invoke(channels.saveExport, request),
  saveInspection: (request) => invoke(channels.saveInspection, request),
  saveCharacter: (documentId) => invoke(channels.saveCharacter, documentId),
  openCharacter: (donor) => invoke(channels.openCharacter, donor),
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
