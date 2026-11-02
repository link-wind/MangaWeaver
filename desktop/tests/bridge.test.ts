import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLines } from "../electron/engine";
import { MediaFiles } from "../electron/media";

test("JSONL buffers partial lines and rejects truncated exit", () => {
  const got: unknown[] = [];
  const lines = new JsonLines((e) => got.push(e));
  const data =
    JSON.stringify({ version: 1, type: "completed", data: { name: "中文" } }) +
    "\n";
  lines.push(data.slice(0, 12));
  assert.equal(got.length, 0);
  lines.push(data.slice(12));
  lines.finish();
  assert.equal(got.length, 1);
  lines.push("{");
  assert.throws(() => lines.finish(), /不完整/);
});
test("media tokens restrict paths and support byte ranges", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manga-media-")),
    file = join(dir, "clip.mp4"),
    other = join(dir, "other.mp4");
  await writeFile(file, "0123456789");
  await writeFile(other, "private");
  const media = new MediaFiles();
  await media.allow(file);
  await assert.rejects(media.url(other), /未授权/);
  const url = await media.url(file),
    response = await media.response(
      new Request(url, { headers: { Range: "bytes=2-5" } }),
    );
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "2345");
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(
    (
      await media.response(
        new Request(url, { headers: { Range: "bytes=99-" } }),
      )
    ).status,
    416,
  );
  const suffix = await media.response(
    new Request(url, { headers: { Range: "bytes=-3" } }),
  );
  assert.equal(await suffix.text(), "789");
  assert.equal(
    (await media.response(new Request("manga-media://local/unknown"))).status,
    403,
  );
});

import { graph, canvasState } from "../src/lib/canvas";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
test("canvas maps multi-panel shots and keeps stable persisted positions", async () => {
  const directory = resolve("..", "examples/cross-panel");
  const plan = JSON.parse(
    await readFile(resolve(directory, "production.json"), "utf8"),
  );
  const run = {
    directory,
    experimental: false,
    media: [],
    records: [{ file: "production.json", data: plan }],
  };
  const state = canvasState(run);
  state.positions.arrangement = { x: 123, y: 456 };
  const result = graph(run, state),
    ids = new Set(result.nodes.map((n) => n.id));
  assert.deepEqual(result.nodes.find((n) => n.id === "arrangement")?.position, {
    x: 123,
    y: 456,
  });
  assert.equal(
    result.nodes.filter((n) => n.data.kind === "shot").length,
    plan.shot_list.shots.length,
  );
  assert.equal(
    result.nodes.filter((n) => n.data.kind === "frame").length,
    plan.assets.length,
  );
  const panels = result.nodes.filter(n => n.data.kind === "panel");
  assert.deepEqual(panels.map(n => n.id), plan.source.panels.map((p: any) => `panel:${p.panel_id}`));
  assert.equal(new Set(panels.map(n => n.position.x)).size, 1);
  assert.ok(panels.every((n, i) => i === 0 || n.position.y > panels[i - 1].position.y));
  assert.ok(panels.every(n => result.edges.some(e => e.source === n.id && e.target === "arrangement")));
  assert.ok(!ids.has("script"));
  const legacy = { ...state, page: plan.source.panels[0].image };
  assert.ok(!graph(run, legacy).nodes.some(n => n.id === "source"));
  assert.equal(graph({ ...run, original_page: "/whole-page.jpg" }, legacy).nodes.find(n => n.id === "source")?.data.image, "/whole-page.jpg");
  assert.ok(result.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});
