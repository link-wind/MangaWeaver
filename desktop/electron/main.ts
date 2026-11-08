import {
  nativeTheme,
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
} from "electron";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  realpath,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, dirname, basename, extname } from "node:path";
import { Engine } from "./engine";
import { scanLocalRuns } from "./library";
import { projectForRun } from './projects';
import { authorizedPath, MediaFiles } from "./media";
import type { Project, Settings, RunData, MangaMaterial } from "../src/lib/types";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "manga-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let window: BrowserWindow,
  settings: Settings,
  project: Project | undefined,
  closing = false;
const libraryRoots = new Set<string>();
const roots = new Set<string>(),
  files = new Set<string>(),
  media = new MediaFiles();
const engine = new Engine(
  () => settings,
  (event) => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    try { window.webContents.send("engine-event", event); }
    catch { console.error("客户端事件未送达，运行结果继续保留在本地"); }
  },
);
const settingsPath = () => join(app.getPath("userData"), "settings.json");
const inside = (path: string, root: string) => {
  const rel = relative(root, path);
  return !rel.startsWith("..") && !rel.startsWith("/");
};
async function authorize(path: string) {
  const real = await realpath(path);
  files.add(real);
  if (
    [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".srt"].includes(
      extname(real).toLowerCase(),
    )
  )
    await media.allow(real);
  return real;
}
async function check(path: unknown) {
  if (typeof path !== "string") throw new Error("缺少有效文件路径");
  return authorizedPath(path, roots, files);
}
async function saveProject() {
  if (!project) return;
  const { path, ...data } = project;
  await writeFile(join(path, "project.json"), JSON.stringify(data, null, 2));
}
async function choose(
  properties: ("openFile" | "openDirectory" | "createDirectory")[],
  filters?: Electron.FileFilter[],
  title = "选择文件或目录",
) {
  const result = await dialog.showOpenDialog(window, {
    // 保留虚拟环境的 python 符号链接；解析到系统解释器会丢失项目依赖。
    properties: [...properties, "showHiddenFiles", "noResolveAliases"],
    filters,
    title,
  });
  return result.canceled ? null : result.filePaths[0];
}
async function hydrateRun(data: RunData) {
  const allowReference = async (path:string) => authorize(await check(path));
  if (data.original_page) await allowReference(data.original_page);
  for (const path of data.media) await allowReference(path);
  for (const record of data.records) {
    if (
      record.file === "canvas.json" &&
      record.data?.page &&
      existsSync(record.data.page)
    )
      await allowReference(record.data.page);
    const value = record.data;
    const source =
      value?.source ||
      (record.file.endsWith("manifest.json") ||
      record.file.endsWith("prepared.json")
        ? value
        : undefined);
    for (const item of [...(source?.panels || []), ...(value?.assets || [])]) {
      if (typeof item.image !== "string") continue;
      const path = resolve(
        dirname(join(data.directory, record.file)),
        item.image,
      );
      if (existsSync(path)) await allowReference(path);
    }
  }
  return data;
}
app.whenReady().then(async () => {
  nativeTheme.themeSource = "light";
  const root = resolve(__dirname, "../..");
  settings = {
    root,
    python: join(root, ".venv/bin/python"),
    ffmpeg: "/opt/homebrew/bin",
    env_file: join(root, ".env"),
  };
  try {
    settings = {
      ...settings,
      ...JSON.parse(await readFile(settingsPath(), "utf8")),
    };
  } catch {}
  protocol.handle("manga-media", (request) =>
    media
      .response(request)
      .catch(() => new Response("Not found", { status: 404 })),
  );
  window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1080,
    minHeight: 720,
    title: "MangaWeaver",
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("did-start-loading", () => media.releaseAll());
  window.webContents.on("destroyed", () => media.releaseAll());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let requestingClose=false, rendererGone=false;
  let closeTimer:ReturnType<typeof setTimeout>|undefined;
  const finishClose=()=>{
    if(closing)return;
    closing=true;
    clearTimeout(closeTimer);
    if(!window.isDestroyed())window.close();
  };
  window.webContents.on("render-process-gone",()=>{
    rendererGone=true;
    if(requestingClose)void engine.stop().finally(finishClose);
  });
  window.webContents.on("did-finish-load",()=>{rendererGone=false;});
  app.on("before-quit",event=>{
    if(closing)return;
    event.preventDefault();
    if(!window.isDestroyed())window.close();
    else{closing=true;app.quit();}
  });
  window.on("close", event => {
    if(closing)return;
    event.preventDefault();
    if(requestingClose)return;
    requestingClose=true;
    void (async()=>{
      if(engine.active.size){
        const {response}=await dialog.showMessageBox(window,{type:'question',message:'本地任务仍在执行',detail:'停止本地执行后退出，远端视频可能继续生成，可稍后恢复查询。',buttons:['继续运行','停止后退出'],cancelId:0});
        if(response!==1){requestingClose=false;return;}
        await engine.stop();
      }
      if(rendererGone||window.webContents.isDestroyed()){finishClose();return;}
      closeTimer=setTimeout(finishClose,3000);
      window.webContents.send('flush-before-close');
    })().catch(()=>{
      console.error("关闭前保存未完成，保留已有本地产物后退出");
      finishClose();
    });
  });
  function handle(name: string, fn: (...args: any[]) => any) {
    ipcMain.handle(name, (event, ...args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("无效页面来源");
      return fn(...args);
    });
  }
  handle('close-ready',(saved:boolean)=>{
    if(!requestingClose)return;
    clearTimeout(closeTimer);
    requestingClose=false;
    if(saved===true)finishClose();
  });
  const materialRoot=()=>join(app.getPath("userData"),"materials");
  async function materialList():Promise<MangaMaterial[]> {
    const index=join(materialRoot(),"index.json");
    if(!existsSync(index))return [];
    const records=JSON.parse(await readFile(index,"utf8")) as MangaMaterial[];
    for(const item of records)if(existsSync(item.cover))await authorize(item.cover);
    return records;
  }
  handle("materials", materialList);
  handle("import-material", async()=>{
    if(engine.active.size)throw new Error("请先等待或停止当前任务");
    const source=await choose(["openFile"],[{name:"漫画素材",extensions:["mobi","pdf","cbz","png","jpg","jpeg","webp"]}],"导入漫画到素材库");
    if(!source)return null;
    const folder=materialRoot();await mkdir(folder,{recursive:true});
    const book=await engine.run("import_material",{project:folder,source});
    const list=await materialList();
    const existing=list.find(item=>item.id===book.id);
    if(existing)return existing;
    const item:MangaMaterial={id:book.id,name:book.name,source:book.original,cover:book.pages[0].thumbnail,format:book.format,pages:book.page_count,imported:new Date().toISOString()};
    await authorize(item.cover);
    await writeFile(join(folder,"index.json"),JSON.stringify([item,...list],null,2));
    return item;
  });
  handle("select-material",async(id:string)=>{
    const item=(await materialList()).find(item=>item.id===id);
    if(!item)throw new Error("素材不存在，请重新打开素材库");
    if(!existsSync(item.source))throw new Error("素材文件缺失，请重新导入原文件");
    return authorize(item.source);
  });
  handle("settings", () => settings);
  handle("create-simulation", async () => {
    const path = join(settings.root, "results", "simulations", crypto.randomUUID());
    await mkdir(path, {recursive:true});
    roots.add(await realpath(path));
    await engine.run("create_simulation", {run_dir:path,creative:true});
    return path;
  });
  handle("configure", async (field?:string) => {
    if (engine.active.size) throw new Error("请先停止活动任务");
    if(field!==undefined){
      if(!['root','python','ffmpeg','env_file'].includes(field))throw new Error('未知设置字段');
      const labels:Record<string,string>={root:'选择 MangaWeaver 引擎项目根目录',python:'选择 Python 可执行文件',ffmpeg:'选择 FFmpeg 可执行文件',env_file:'选择本地 .env 凭据文件'};
      const value=await choose(field==='root'?['openDirectory']:['openFile'],undefined,labels[field]);
      if(!value)return null;
      const updated={...settings,[field]:field==='ffmpeg'?dirname(value):value};
      await writeFile(settingsPath(),JSON.stringify(updated,null,2));
      settings=updated;
      return settings;
    }
    const root = await choose(
      ["openDirectory"],
      undefined,
      "选择 MangaWeaver 引擎项目根目录",
    );
    if (!root) return null;
    const python = await choose(
      ["openFile"],
      undefined,
      "选择 Python 可执行文件（例如 .venv/bin/python）",
    );
    if (!python) return null;
    const ffmpeg = await choose(
      ["openFile"],
      undefined,
      "选择 FFmpeg 可执行文件",
    );
    if (!ffmpeg) return null;
    const env = await choose(["openFile"], undefined, "选择本地 .env 凭据文件");
    if (!env) return null;
    settings = { root, python, ffmpeg: dirname(ffmpeg), env_file: env };
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
    return settings;
  });
  handle("project", async (action: string) => {
    if (!["create", "open"].includes(action)) throw new Error("未知项目操作");
    const path = await choose(["openDirectory", "createDirectory"]);
    if (!path) return null;
    if (action === "create") {
      if (existsSync(join(path, "project.json")))
        throw new Error("项目已存在，请选择打开");
      project = {
        path,
        name: basename(path),
        version: 1,
        sources: [],
        runs: [],
        pages: [],
      };
      await mkdir(join(path, "sources"), { recursive: true });
      await mkdir(join(path, "runs"), { recursive: true });
      await saveProject();
    } else {
      const data = JSON.parse(
        await readFile(join(path, "project.json"), "utf8"),
      );
      if (
        data.version !== 1 ||
        !Array.isArray(data.runs) ||
        !Array.isArray(data.sources)
      )
        throw new Error("项目格式无效");
      project = {
        path,
        name: String(data.name),
        version: 1,
        runs: data.runs,
        sources: data.sources,
        pages: data.pages || [],
      };
    }
    roots.add(await realpath(path));
    for (const ref of [...project.runs, ...project.sources, ...project.pages]) {
      if (typeof ref !== "string") throw new Error("项目引用无效");
      const target = resolve(path, ref);
      if (existsSync(target)) {
        if ((await stat(target)).isDirectory())
          roots.add(await realpath(target));
        else await authorize(target);
      }
    }
    return project;
  });
  handle('open-run-project',async(path:string)=>{
    if(engine.active.size)throw new Error('请先停止活动任务');
    const directory=await check(path);
    const opened=await projectForRun(directory);
    roots.add(await realpath(opened.path));
    for(const ref of [...opened.runs,...opened.sources,...opened.pages]){
      const target=resolve(opened.path,ref);
      if(existsSync(target)){
        if((await stat(target)).isDirectory())roots.add(await realpath(target));
        else await authorize(target);
      }
    }
    project=opened;
    return project;
  });
  handle("scan-runs", async (chooseDirectory = false) => {
    const scanRoots = [join(settings.root, "results"), ...libraryRoots];
    if (project) scanRoots.push(join(project.path, "runs"), ...project.runs.map(ref => resolve(project!.path, ref)));
    if (chooseDirectory === true) {
      const path = await choose(["openDirectory"], undefined, "扫描本地生成目录");
      if (!path) return [];
      libraryRoots.add(path);
      scanRoots.push(path);
    }
    const previews = await scanLocalRuns(scanRoots);
    for (const preview of previews) {
      roots.add(preview.directory);
      if (preview.cover) await authorize(preview.cover);
      if (preview.video) await authorize(preview.video);
    }
    return previews;
  });
  handle("attach", async () => {
    const path = await choose(["openDirectory"]);
    if (!path) return null;
    roots.add(await realpath(path));
    libraryRoots.add(path);
    if (project && !project.runs.includes(path)) {
      project.runs.push(path);
      await saveProject();
    }
    return path;
  });
  handle("choose-page", async () => {
    const path = await choose(
      ["openFile"],
      [{ name: "漫画页", extensions: ["png", "jpg", "jpeg", "webp", "mobi", "pdf", "cbz"] }],
    );
    return path ? authorize(path) : null;
  });
  handle("import-page", async () => {
    if (!project) throw new Error("请先创建或打开项目");
    const path = await choose(
      ["openFile"],
      [{ name: "漫画页", extensions: ["png", "jpg", "jpeg", "webp"] }],
    );
    if (!path) return null;
    const target = join(
      project.path,
      "sources",
      `${crypto.randomUUID().slice(0, 8)}-${basename(path)}`,
    );
    await copyFile(path, target);
    await authorize(target);
    project.pages.push(relative(project.path, target));
    await saveProject();
    return target;
  });
  handle("import-source", async () => {
    const path = await choose(
      ["openFile"],
      [{ name: "来源清单", extensions: ["json"] }],
    );
    if (!path) return null;
    await authorize(path);
    if (project) {
      project.sources.push(relative(project.path, path));
      await saveProject();
    }
    return path;
  });
  handle("new-run", async () => {
    if (!project) throw new Error("请先打开项目");
    const path = join(
      project.path,
      "runs",
      new Date().toISOString().replace(/[:.]/g, "-"),
    );
    await mkdir(path, { recursive: true });
    roots.add(await realpath(path));
    project.runs.push(relative(project.path, path));
    await saveProject();
    return path;
  });
  handle(
    "engine",
    async (command: string, params: Record<string, unknown> = {}) => {
      if (
        ![
          "capture_references", "submit_message", "withdraw_message", "simulate", "submit_revision", "withdraw_revision", "interrupt_workflow",
          "agent_answer", "agent_compact", "agent_fork", "agent_switch_branch", "agent_follow_up", "agent_resume_task", "agent_next_batch", "agent_message", "agent_continue", "agent_select_page", "agent_open_pages", "agent_run_stage", "load_book_pages", "read_session", "save_book_view",
          "environment", "read_agent_harness", "read_model_settings", "check_model_settings", "test_model_settings", "save_model_settings",
          "read_run", "read_candidates", "adopt_candidate", "preview_canvas_delete", "delete_canvas_nodes",
          "start_canvas",
          "fork_canvas",
          "save_canvas",
          "read_source",
          "save_source",
          "preprocess",
          "plan",
          "generate",
          "resume",
        ].includes(command)
      )
        throw new Error("命令未授权");
      const input: Record<string, unknown> = {};
      if (["capture_references", "submit_message", "withdraw_message", "submit_revision", "withdraw_revision", "interrupt_workflow"].includes(command)) {
        if (!project) throw new Error("请先打开项目");
        input.project = project.path;
        if(params.run_dir) input.run_dir = await check(params.run_dir);
        input.text = String(params.text || ""); input.context = params.context;
        input.stage = params.stage; input.task_id = params.task_id;
        input.permissions = params.permissions;
        input.request_id_to_withdraw = params.request_id_to_withdraw;
        input.message_id = params.message_id; input.delivery = params.delivery; input.references = params.references;
        input.node_ids = params.node_ids; input.purpose = params.purpose;
        if("expected_revision" in params)input.expected_revision=params.expected_revision;
      } else if (command === "save_book_view" || command === "load_book_pages") {
        if (!project) throw new Error("请先打开项目");
        input.project = project.path;
        input.book_id = params.book_id;
        input.view = params.view;
        input.pages = params.pages;
      } else if (["agent_answer", "agent_compact", "agent_fork", "agent_switch_branch", "agent_follow_up", "agent_resume_task", "agent_next_batch", "agent_message", "agent_continue", "agent_select_page", "agent_open_pages", "agent_run_stage", "read_session"].includes(command)) {
        if (!project) throw new Error("请先打开项目");
        if (engine.active.size && command !== "read_session") throw new Error("请先停止活动任务");
        input.project = project.path;
        if (params.run_dir) input.run_dir = await check(params.run_dir);
        if (params.attachment) input.attachment = await check(params.attachment);
        input.branch_id = params.branch_id; input.question_id = params.question_id;
        input.page_number = params.page_number;
        input.pages = params.pages;
        input.stage = params.stage;
        input.operation = params.operation; input.feedback = params.feedback; input.location = params.location;
        input.text = String(params.text || "");
        input.context = params.context;
        input.project_scope = params.project_scope === true;
        input.references = params.references; input.message_id = params.message_id;
        input.permissions = params.permissions;
        input.call_id = params.call_id;
        input.revision = params.revision;
        input.result = params.result;
        input.task_id = params.task_id; input.task_revision = params.task_revision; input.grant_scope = params.grant_scope; input.resume_mode = params.resume_mode;
      } else if (command === 'preview_canvas_delete' || command === 'delete_canvas_nodes') {
        if (!project) throw new Error('请先打开项目');
        if (engine.active.size) throw new Error('请先等待或停止当前任务');
        if (!Array.isArray(params.selections)) throw new Error('删除范围无效');
        input.project = project.path;
        input.selections = await Promise.all(params.selections.map(async (item: any) => ({
          run_dir: await check(item.run_dir), node_ids: item.node_ids, scope: item.scope,
        })));
        input.expected_revision = params.expected_revision;
      } else if (command === "fork_canvas") {
        input.run_dir = await check(params.run_dir);
        input.from_run = await check(params.from_run);
      } else if (command === "start_canvas") {
        input.run_dir = await check(params.run_dir);
        if(params.from_run)input.from_run = await check(params.from_run);
        if (params.page) input.page = await check(params.page);
        if (params.manifest) input.manifest = await check(params.manifest);
        input.prompt = String(params.prompt || "");
      } else if (command === 'read_candidates'||command==='adopt_candidate') {
        input.run_dir=await check(params.run_dir);
        input.keyframe=String(params.keyframe||'');
        if(command==='adopt_candidate'){
          if(!project)throw new Error('请先打开项目');
          input.project=project.path;input.candidate=params.candidate;input.candidate_revision=params.candidate_revision;input.expected_revision=params.expected_revision;
        }
      } else if (command === "save_canvas") {
        input.run_dir = await check(params.run_dir);
        input.canvas = params.canvas;
        if ("expected_revision" in params) input.expected_revision=params.expected_revision;
        const canvas = params.canvas as { page?: string };
        if (canvas?.page) await check(canvas.page);
      } else if (command === "save_source") {
        if (!project) throw new Error("请先打开项目");
        input.project = project.path;
        if (params.source) input.source = await check(params.source);
        else input.page = await check(params.page);
        if(params.base_source)input.base_source=await check(params.base_source);
        input.panels = params.panels;
        if ("expected_revision" in params) input.expected_revision=params.expected_revision;
      } else if (command === "read_source") {
        input.source = await check(params.source);
      } else if (["read_model_settings", "check_model_settings", "test_model_settings", "save_model_settings"].includes(command)) {
        if(command === "save_model_settings" && engine.active.size) throw new Error("任务正在执行，结束或停止后可保存模型设置");
        input.settings=params.settings;
        if(command === "test_model_settings") {
          input.service=String(params.service || "");
          input.kind=String(params.kind || "");
          input.model=String(params.model || "");
        }
      } else if (command === "read_agent_harness") {
        // 静态编排清单：不依赖项目或运行目录，也不触发模型。
      } else if (command !== "environment") {
        input.run_dir = await check(params.run_dir);
        if (command === "preprocess") {
          if (params.manifest) input.manifest = await check(params.manifest);
          else input.page = await check(params.page);
        }
        if (command === "plan") {
          if (params.source) input.source = await check(params.source);
          if (
            params.from_stage &&
            !["script", "arrangement", "direction", "storyboard"].includes(
              String(params.from_stage),
            )
          )
            throw new Error("未知修订阶段");
          if (
            params.until_stage &&
            !["script", "arrangement", "direction", "storyboard"].includes(
              String(params.until_stage),
            )
          )
            throw new Error("未知暂停阶段");
          input.until_stage = params.until_stage;
          input.location = String(params.location || "all");
          input.from_stage = params.from_stage;
          input.feedback = String(params.feedback || "");
        }
        if (command === "generate") input.dry_run = params.dry_run === true;
      }
      const result = await engine.run(command, input);
      if (command === "load_book_pages") {
        for (const page of result.pages.filter((p: {loaded?:boolean}) => p.loaded !== false)) {
          await authorize(page.image); await authorize(page.thumbnail);
        }
        return result;
      }
      if (["agent_answer", "agent_compact", "agent_fork", "agent_switch_branch", "agent_follow_up", "agent_resume_task", "agent_next_batch", "agent_message", "agent_continue", "agent_select_page", "agent_open_pages", "agent_run_stage", "read_session"].includes(command)) {
        for (const page of result.book?.pages || []) {
          if (page.loaded === false) continue;
          await authorize(page.image); await authorize(page.thumbnail);
        }
        if (result.active_run) {
          const active = await realpath(result.active_run);
          if (!inside(active, project!.path) && ![...roots].some(root => inside(active, root))) throw new Error("运行路径未授权");
          roots.add(active);
        }
        const data = JSON.parse(await readFile(join(project!.path, "project.json"), "utf8"));
        project!.runs = data.runs;
        return result;
      }
      if(command==='read_candidates')for(const item of result.items)await authorize(await check(item.image));
      if (command === "read_run") {
        // read_run 只在当前项目及其已登记运行中开放，服务端另校验项目归属。
        roots.add(await realpath(result.directory));
        // 将相对媒体引用解析至对应产物文件，而非应用 cwd。
        for (const record of result.records) {
          const d = record.data;
          const source =
            d?.source ||
            (/(?:manifest|prepared)\.json$/.test(record.file) ? d : undefined);
          for (const item of [...(source?.panels || []), ...(d?.assets || [])])
            if (typeof item.image === "string")
              item.image = resolve(
                String(input.run_dir),
                dirname(record.file),
                item.image,
              );
        }
        return hydrateRun(result);
      }
      if (
        (command === "start_canvas" || command === "fork_canvas") &&
        result.page
      )
        await authorize(result.page);
      if (command === "read_source") {
        for (const panel of result.source.panels) await authorize(panel.image);
        if (result.editor) await authorize(result.editor.page);
      }
      if (command === "save_source" && project) {
        project.sources.push(relative(project.path, result.manifest));
        await saveProject();
        if (result.page) await authorize(result.page);
        await authorize(result.manifest);
      }
      return result;
    },
  );
  handle("app-version", () => app.getVersion());
  handle("stop", () => engine.stop());
  handle("media", async (path: string) => media.acquire(await check(path)));
  handle("release-media", (lease: string) => { if (typeof lease !== "string") throw new Error("无效媒体租约"); media.release(lease); });
  handle("export-file", async (path: string) => {
    await check(path);
    const result = await dialog.showSaveDialog(window, {
      defaultPath: basename(path),
    });
    if (result.canceled || !result.filePath) return false;
    await copyFile(path, result.filePath);
    return true;
  });
  if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged)
    await window.loadURL("http://127.0.0.1:5173");
  else await window.loadFile(join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
