import { spawn, type ChildProcess } from "node:child_process";
import type { EngineEvent, Settings } from "../src/lib/types";

function signalGroup(child:ChildProcess, name:NodeJS.Signals) {
  try {
    if(process.platform!=="win32"&&child.pid)process.kill(-child.pid,name);
    else child.kill(name);
  } catch { /* 进程组已退出 */ }
}

export class JsonLines {
  private buffer = "";
  constructor(private receive: (event: EngineEvent) => void) {}
  push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024)
      throw new Error("引擎事件超过大小限制");
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (
        event.version !== 1 ||
        !["started", "stage", "artifact", "completed", "failed"].includes(
          event.type,
        )
      )
        throw new Error("无效的引擎事件");
      this.receive(event);
    }
  }
  finish() {
    if (this.buffer.trim()) throw new Error("引擎退出时事件不完整");
  }
}
export class Engine {
  active = new Map<string, ChildProcess>();
  private cancelled = new WeakSet<ChildProcess>();
  constructor(
    private settings: () => Settings,
    private receive: (event: EngineEvent) => void,
  ) {}
  async run(
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    const cfg = this.settings(),
      id = crypto.randomUUID();
    // 只读命令（environment、read_run、read_source、read_agent_harness 等）不在此列，
    // 可直接转发且不阻塞进行中的制作任务。
    const mutation = [
      "import_material", "create_simulation", "simulate",
      "agent_answer", "agent_compact", "agent_fork", "agent_switch_branch", "agent_follow_up", "agent_resume_task", "agent_next_batch", "agent_message", "agent_continue", "agent_select_page", "agent_open_pages", "agent_run_stage",
      "preprocess",
      "plan",
      "generate",
      "resume",
      "save_source",
      "start_canvas",
      "fork_canvas",
      "save_canvas", "adopt_candidate", "delete_canvas_nodes",
    ].includes(command);
    const key = String(params.run_dir || params.project || id);
    if (mutation && this.active.size) throw new Error("已有本地操作，请等待完成或停止");
    const path = [
      cfg.ffmpeg,
      ...["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"],
      process.env.PATH,
    ]
      .filter(Boolean)
      .join(":");
    const child = spawn(cfg.python, ["-m", "mangaweaver.desktop"], {
      cwd: cfg.root,
      detached: process.platform !== "win32",
      env: { ...process.env, PATH: path, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (mutation) this.active.set(key, child);
    return new Promise((resolve, reject) => {
      let result: any,
        terminal = false,
        failed = false,
        protocolError: Error | undefined;
      const parser = new JsonLines((event) => {
        if (event.request_id !== id) throw new Error("引擎请求标识不匹配");
        if (mutation) this.receive(event);
        if (event.type === "completed") {
          terminal = true;
          result = event.data;
        }
        if (event.type === "failed") {
          terminal = true;
          failed = true;
          result = event.data;
        }
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        try {
          parser.push(chunk);
        } catch (error) {
          protocolError = error as Error;
          signalGroup(child,"SIGTERM");
        }
      });
      // stderr 可能来自第三方 SDK，故不转发给 renderer 或持久化；错误由脱敏事件返回。
      child.stderr.resume();
      child.on("error", (error) => {
        if (this.active.get(key) === child) this.active.delete(key);
        reject(new Error(`Python 无法启动：${error.message}`));
      });
      child.on("close", (code) => {
        if (this.active.get(key) === child) this.active.delete(key);
        try {
          parser.finish();
        } catch (error) {
          if(!this.cancelled.has(child))protocolError = error as Error;
        }
        if (protocolError) reject(protocolError);
        else if (terminal) {
          if(failed)reject(new Error(this.cancelled.has(child)&&result?.status==='interrupted'
            ?'本地执行已停止，已保存的进度可继续'
            :`${result?.code ? `[${result.code}] ` : ""}${result?.message || "引擎执行失败"}`));
          else resolve(result);
        }
        else if (this.cancelled.has(child)) {
          this.receive({version:1,request_id:id,id:`${id}:stopped`,timestamp:new Date().toISOString(),
            run_dir:typeof params.run_dir === 'string'?params.run_dir:undefined,type:'failed',stage:command,
            data:{status:'interrupted',message:'本地执行已停止，已保存的进度可继续'}});
          reject(new Error('本地执行已停止，已保存的进度可继续'));
        }
        else reject(new Error(`引擎中断（${code}）；已有远端任务仍可能在运行`));
      });
      child.stdin.on("error", () => {
        /* close reports process launch failures */
      });
      child.stdin.end(
        JSON.stringify({
          ...params,
          command,
          conversation_protocol: 1,
          request_id: id,
          env_file: cfg.env_file,
        }) + "\n",
      );
    });
  }
  async stop() {
    await Promise.all(
      [...this.active.values()].map(
        (child) =>
          new Promise<void>((resolve) => {
            if(child.exitCode!==null||child.signalCode!==null){resolve();return;}
            this.cancelled.add(child);
            const timer = setTimeout(() => signalGroup(child, "SIGTERM"), 2000);
            const force = setTimeout(() => signalGroup(child, "SIGKILL"), 6000);
            child.once("close", () => {
              clearTimeout(timer);
              clearTimeout(force);
              resolve();
            });
            signalGroup(child, "SIGINT");
          }),
      ),
    );
  }
}
