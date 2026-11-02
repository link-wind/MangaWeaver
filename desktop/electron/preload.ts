import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, EngineEvent } from "../src/lib/types";
const api: DesktopAPI = {
  materials: () => ipcRenderer.invoke("materials"),
  importMaterial: () => ipcRenderer.invoke("import-material"),
  selectMaterial: (id) => ipcRenderer.invoke("select-material",id),
  settings: () => ipcRenderer.invoke("settings"),
  createSimulation: () => ipcRenderer.invoke("create-simulation"),
  configure: () => ipcRenderer.invoke("configure"),
  project: (action) => ipcRenderer.invoke("project", action),
  openRunProject: (path) => ipcRenderer.invoke('open-run-project',path),
  attach: () => ipcRenderer.invoke("attach"),
  scanRuns: (chooseDirectory = false) => ipcRenderer.invoke("scan-runs", chooseDirectory),
  choosePage: () => ipcRenderer.invoke("choose-page"),
  importPage: () => ipcRenderer.invoke("import-page"),
  importSource: () => ipcRenderer.invoke("import-source"),
  newRun: () => ipcRenderer.invoke("new-run"),
  run: (command, params) => ipcRenderer.invoke("engine", command, params),
  stop: () => ipcRenderer.invoke("stop"),
  media: (path) => ipcRenderer.invoke("media", path),
  exportFile: (path) => ipcRenderer.invoke("export-file", path),
  onEvent: (callback) => {
    const handler = (_: unknown, event: EngineEvent) => callback(event);
    ipcRenderer.on("engine-event", handler);
    return () => ipcRenderer.removeListener("engine-event", handler);
  },
};
contextBridge.exposeInMainWorld("manga", api);
