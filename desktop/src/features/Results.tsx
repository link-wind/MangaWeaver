import { useState } from "react";
import { Download, Film } from "lucide-react";
import { Media } from "../components/Media";
import { Button } from "../components/ui/button";
import { filename, reviewRecords } from "../lib/data";
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
  return (
    <div className="result-layout">
      <div className="result-main">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SCREENING ROOM</span>
            <h2>让故事连贯起来</h2>
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
              <p>完成规划审查后，可在“生成”中构建任务。</p>
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
        <div className="video-list">
          {videos.map((p) => (
            <button
              key={p}
              className={path === p ? "selected" : ""}
              onClick={() => setSelected(p)}
            >
              <Film size={15} />
              <span>{p.slice(run.directory.length + 1)}</span>
              {p === path && <span className="tag">当前</span>}
            </button>
          ))}
        </div>
        <div className="subtitle-files">
          <h3>字幕与对白记录</h3>
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
              <details key={r.file} className="details">
                <summary>{r.file}</summary>
                <pre>{JSON.stringify(r.data, null, 2)}</pre>
              </details>
            ))}
        </div>
      </div>
      <aside className="inspector">
        <div className="inspector-title">
          审查记录 <span>{reviews.length} 份</span>
        </div>
        <div className="review-list">
          {reviews.map((r) => (
            <details
              key={r.file}
              className="review-item"
              open={r.file === "video_review.json"}
            >
              <summary>
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
              </summary>
              <p>
                {r.data?.reason ||
                  r.data?.video_review?.reason ||
                  r.data?.status}
              </p>
              <pre>{JSON.stringify(r.data, null, 2)}</pre>
            </details>
          ))}
          {!reviews.length && <p className="muted">尚未审查，不代表已通过。</p>}
        </div>
      </aside>
    </div>
  );
}
