import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { extname } from "node:path";

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
