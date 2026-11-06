import { Download,Film } from "lucide-react";
import { useState } from "react";
import { Disclosure } from '../components/Disclosure';
import { Media } from "../components/Media";
import { Badge } from '../components/ui/badge';
import { Button } from "../components/ui/button";
import { filename,reviewRecords } from "../lib/data";
import type { RunData } from "../lib/types";
export function Results({
  run,
  onExport,
}: {
  run: RunData;
  onExport: (path: string) => void;
}) {
  const videos = run.media
    .filter((p) => p.endsWith(".mp4"))
    .sort((a, b) => {
      const rank = (p: string) =>
        /\/(final|preview)\.mp4$/.test(p) ? 0 : /clean\.mp4$/.test(p) ? 1 : 2;
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  const [selected, setSelected] = useState(""),
    path = videos.includes(selected) ? selected : videos[0],
    reviews = reviewRecords(run);
  const isFilm=(path:string)=>/\/(final|preview|clean)\.mp4$/.test(path);
  return (
    <div className="result-layout specialist-page">
      <div className="result-main">
        <div className="section-heading">
          <div>

            <h2>视频结果</h2>
            <p>
              {run.experimental
                ? "整张故事板实验 · 只读预览"
                : "本地视频 · 保留原生音轨"}
            </p>
          </div>
          <Button disabled={!path} onClick={() => onExport(path)}>
            <Download size={15} />
            导出选中视频
          </Button>
        </div>
        <div className="screen">
          {path ? (
            <Media path={path} video />
          ) : (
            <div className="empty">
              <Film size={30} />
              <h3>视频尚未生成</h3>
              <p>完成规划审查后，可在“视频任务”中构建任务。</p>
            </div>
          )}
        </div>
        {path && (
          <div className="screen-caption">
            <span>{filename(path)}</span>
            <span>
              {/clean/.test(path)
                ? "干净版"
                : /preview|final/.test(path)
                  ? "已有导出版本"
                  : "片段候选"}{" "}
              · 支持声音与定位
            </span>
          </div>
        )}
        {[{title:'成片',items:videos.filter(isFilm)},{title:'片段与候选',items:videos.filter(p=>!isFilm(p))}].map(group=>group.items.length>0&&<section className="result-video-group" key={group.title}><h3>{group.title}<small>{group.items.length}</small></h3><div className="video-list">{group.items.map(p=><Button variant="ghost" size="sm" key={p} className={path===p?'selected':''} onClick={()=>setSelected(p)} title={p.slice(run.directory.length+1)}><Film size={15}/><span>{filename(p)}</span>{path===p&&<Badge variant="secondary">当前</Badge>}</Button>)}</div></section>)}
        <Disclosure className="subtitle-files details" title={<>字幕与对白记录</>}>

          <p>中文字幕时间以已有字幕产物为准；规划译文仅作内容对照。</p>
          {run.media
            .filter((p) => p.endsWith(".srt"))
            .map((p) => (
              <Button key={p} size="sm" onClick={() => onExport(p)}>
                <Download size={13} />
                {filename(p)}
              </Button>
            ))}
          {run.records
            .filter((r) => /subtitles|dialogue/.test(r.file))
            .map((r) => (
              <Disclosure key={r.file} className="details" title={<>{r.file}</>}>

                <pre>{JSON.stringify(r.data, null, 2)}</pre>
              </Disclosure>
            ))}
        </Disclosure>
      </div>
      <aside className="inspector">
        <div className="inspector-title">
          审查记录 <span>{reviews.length} 份</span>
        </div>
        <div className="review-list">
          {reviews.map((r) => (
            <Disclosure key={r.file}
              className="review-item"
              defaultOpen={r.file === "video_review.json"} title={<>
                <span
                  className={`status ${r.data?.accepted === true ? "passed" : r.data?.accepted === false ? "rejected" : ""}`}
                >
                  {r.data?.accepted === true
                    ? "通过"
                    : r.data?.accepted === false
                      ? "未通过"
                      : "报告"}
                </span>{" "}
                {r.file}
              </>}>

              <p>
                {r.data?.reason ||
                  r.data?.video_review?.reason ||
                  r.data?.status}
              </p>
              <details><summary>原始报告</summary><pre>{JSON.stringify(r.data, null, 2)}</pre></details>
            </Disclosure>
          ))}
          {!reviews.length && <p className="muted">尚未审查，不代表已通过。</p>}
        </div>
      </aside>
    </div>
  );
}
