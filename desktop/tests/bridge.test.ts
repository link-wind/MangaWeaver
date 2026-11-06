import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLines } from "../electron/engine";
import { authorizedPath, MediaFiles } from "../electron/media";

test("media references cannot escape through paths or symlinks and empty media is explicit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manga-media-boundary-"));
  const outside = await mkdtemp(join(tmpdir(), "manga-private-"));
  try {
    const allowed = join(dir,"empty.png"), privateFile = join(outside,"private.png");
    await writeFile(allowed,"");await writeFile(privateFile,"private");
    await symlink(privateFile,join(dir,"linked.png"));
    const root=await realpath(dir), privateReal=await realpath(privateFile);
    assert.equal(await authorizedPath(allowed,[root],new Set()),await realpath(allowed));
    await assert.rejects(authorizedPath(privateFile,[root],new Set()),/未授权/);
    await assert.rejects(authorizedPath(join(dir,"linked.png"),[root],new Set()),/未授权/);
    assert.equal(await authorizedPath(privateFile,[root],new Set([privateReal])),privateReal);
    const media = new MediaFiles();await media.allow(allowed);
    await assert.rejects(media.acquire(allowed),/媒体文件为空/);
    const response=await media.response(new Request(await media.url(allowed)));
    assert.equal(response.status,422);
    assert.match(await response.text(),/媒体文件为空/);
  } finally {await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

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

test("shared media leases release only after the last user", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manga-media-lease-"));
  const file = join(dir, "clip.mp4");
  await writeFile(file, "0123456789");
  const media = new MediaFiles();
  await media.allow(file);
  const [first, second] = await Promise.all([media.acquire(file), media.acquire(file)]);
  assert.equal(first.url, second.url);
  assert.notEqual(first.lease, second.lease);
  media.release(first.lease);
  media.release(first.lease);
  assert.equal((await media.response(new Request(second.url))).status, 200);
  media.release(second.lease);
  assert.equal((await media.response(new Request(second.url))).status, 403);
  const pending = media.acquire(file);
  media.releaseAll();
  await assert.rejects(pending, /视图已结束/);
});

test('画布串行保存使用上一回包基准，提交快照不被后续输入修改',async()=>{
  const {CanvasSaveQueue}=await import('../src/lib/canvasSave');
  const calls:{draft:string;revision:string|null}[]=[];
  let finish!:()=>void;
  const queue=new CanvasSaveQueue(async(_path,state,revision)=>{
    calls.push({draft:state.draft,revision});
    if(calls.length===1)await new Promise<void>(resolve=>{finish=resolve;});
    return {revision:`r${calls.length}`};
  });
  queue.read({directory:'/run',canvas_revision:'r0'} as any);
  const state={version:1,page:'',prompt:'',draft:'甲',positions:{},messages:[]} as const;
  const first=queue.save('/run',state as any);
  await new Promise(resolve=>setTimeout(resolve,0));
  const second=queue.save('/run',{...state,draft:'乙'} as any);
  assert.deepEqual(calls,[{draft:'甲',revision:'r0'}]);
  finish();await Promise.all([first,second]);await queue.flush();
  assert.deepEqual(calls,[{draft:'甲',revision:'r0'},{draft:'乙',revision:'r1'}]);
});
