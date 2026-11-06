import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, EngineEvent } from "../src/lib/types";
const api: DesktopAPI = {
  materials: () => ipcRenderer.invoke("materials"),
  importMaterial: () => ipcRenderer.invoke("import-material"),
  selectMaterial: (id) => ipcRenderer.invoke("select-material",id),
  appVersion: () => ipcRenderer.invoke("app-version"),
  settings: () => ipcRenderer.invoke("settings"),
  createSimulation: () => ipcRenderer.invoke("create-simulation"),
  configure: (field) => ipcRenderer.invoke("configure",field),
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
  releaseMedia: (lease) => ipcRenderer.invoke("release-media", lease),
  exportFile: (path) => ipcRenderer.invoke("export-file", path),
  onCloseRequested: (callback) => {
    const handler=()=>{void callback().then(saved=>ipcRenderer.invoke('close-ready',saved));};
    ipcRenderer.on('flush-before-close',handler);
    return()=>ipcRenderer.removeListener('flush-before-close',handler);
  },
  onEvent: (callback) => {
    const handler = (_: unknown, event: EngineEvent) => callback(event);
    ipcRenderer.on("engine-event", handler);
    return () => ipcRenderer.removeListener("engine-event", handler);
  },
};
contextBridge.exposeInMainWorld("manga", api);
