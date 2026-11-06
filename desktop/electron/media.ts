import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { extname, isAbsolute, relative } from "node:path";

export async function authorizedPath(path: string, roots: Iterable<string>, files: ReadonlySet<string>) {
  const real = await realpath(path);
  if (!files.has(real) && ![...roots].some(root => {
    const rel = relative(root, real);
    return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
  })) throw new Error("路径未授权，请使用文件选择器");
  return real;
}

const mime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".srt": "text/plain; charset=utf-8",
};
export class MediaFiles {
  private tokens = new Map<string, string>();
  private epoch = 0;
  private resources = new Map<string, { url: string; users: number }>();
  private leases = new Map<string, string>();
  async acquire(path: string) {
    const epoch = this.epoch;
    const real = await realpath(path);
    const info = await stat(real);
    if (!info.isFile() || info.size === 0) throw new Error("媒体文件为空或不是普通文件，请重新生成或导入");
    const key = JSON.stringify([real, info.size, info.mtimeMs]);
    if (!this.authorized.has(real)) throw new Error("该媒体未授权");
    if (epoch !== this.epoch) throw new Error("媒体视图已结束");
    let resource = this.resources.get(key);
    if (!resource) {
      const url = await this.url(real);
      if (epoch !== this.epoch) {
        this.tokens.delete(new URL(url).pathname.slice(1));
        throw new Error("媒体视图已结束");
      }
      // 规范路径解析期间，另一位使用者可能已经建立同一资源。
      resource = this.resources.get(key);
      if (resource) this.tokens.delete(new URL(url).pathname.slice(1));
      else this.resources.set(key, resource = { url, users: 0 });
    }
    const lease = crypto.randomUUID();
    resource.users++;
    this.leases.set(lease, key);
    return { url: resource.url, lease };
  }
  release(lease: string) {
    const key = this.leases.get(lease);
    if (!key) return;
    this.leases.delete(lease);
    const resource = this.resources.get(key)!;
    if (--resource.users === 0) {
      this.resources.delete(key);
      this.tokens.delete(new URL(resource.url).pathname.slice(1));
    }
  }
  releaseAll() {
    this.epoch++;
    this.leases.clear(); this.resources.clear(); this.tokens.clear();
  }
  private authorized = new Set<string>();
  async allow(path: string) {
    this.authorized.add(await realpath(path));
  }
  async url(path: string) {
    const real = await realpath(path);
    if (!this.authorized.has(real) || !mime[extname(real).toLowerCase()])
      throw new Error("该媒体未授权");
    const token = crypto.randomUUID();
    this.tokens.set(token, real);
    return `manga-media://local/${token}`;
  }
  async response(request: Request) {
    const url = new URL(request.url),
      path = this.tokens.get(url.pathname.slice(1));
    if (
      url.hostname !== "local" ||
      !path ||
      !["GET", "HEAD"].includes(request.method)
    )
      return new Response("Forbidden", { status: 403 });
    if ((await realpath(path)) !== path)
      return new Response("Forbidden", { status: 403 });
    const { size } = await stat(path),
      range = request.headers.get("range");
    if (size === 0) return new Response("媒体文件为空，请重新生成或导入", {status:422});
    let start = 0,
      end = size - 1,
      status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (!Number.isSafeInteger(start) || start > end || start >= size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      status = 206;
    }
    const headers: Record<string, string> = {
      "Content-Type": mime[extname(path).toLowerCase()],
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(
      request.method === "HEAD"
        ? null
        : (Readable.toWeb(
            createReadStream(path, { start, end }),
          ) as ReadableStream),
      { status, headers },
    );
  }
}
