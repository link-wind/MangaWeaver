import { readdir, realpath, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { RunPreview } from "../src/lib/types";

const markers = ["canvas.json", "production.json", "planning_state.json", "planning_draft.json", "EXPERIMENT.json"];

export async function scanLocalRuns(roots: string[]): Promise<RunPreview[]> {
  const found = new Map<string, RunPreview>();
  async function visit(path: string, depth: number) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const names = new Set(entries.filter(e => e.isFile()).map(e => e.name));
    if (names.has("simulation.json")) return;
    const source = entries.some(e => e.isDirectory() && e.name === "source") &&
      await stat(join(path, "source/manifest.json")).then(s => s.isFile(), e => {
        if (e.code === "ENOENT") return false;
        throw e;
      });
    if (markers.some(name => names.has(name)) || source) {
      const directory = await realpath(path);
      if (found.has(directory)) return;
      const media: string[] = [];
      async function collect(folder: string, level: number) {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          const target = join(folder, entry.name);
          if (entry.isFile() && /\.(png|jpe?g|webp|mp4)$/i.test(entry.name)) media.push(target);
          else if (entry.isDirectory() && level < 4) await collect(target, level + 1);
        }
      }
      await collect(directory, 0);
      media.sort();
      const video = ["final.mp4", "preview.mp4"].map(name => join(directory, name)).find(p => media.includes(p));
      const cover = media.find(p => /selected_keyframes\/|\/storyboard\.(jpg|png)$/.test(p)) ||
        media.find(p => /\.(png|jpe?g|webp)$/i.test(p));
      const updated = Math.max((await stat(directory)).mtimeMs, ...await Promise.all(
        markers.filter(name => names.has(name)).map(name => stat(join(directory, name)).then(s => s.mtimeMs)),
      ));
      found.set(directory, { directory, name: basename(directory), cover, video, updated,
        experimental: names.has("EXPERIMENT.json"), status: video ? "已有视频" : names.has("production.json") ? "规划完成" : "创作中" });
      return;
    }
    // results/项目/runs/运行目录是创作 Agent 的实际保存位置。
    if (depth < 3) for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) await visit(join(path, entry.name), depth + 1);
    }
  }
  for (const root of new Set(roots)) await visit(root, 0);
  return [...found.values()].filter(item => item.video).sort((a, b) => b.updated - a.updated);
}
