import { useState } from "react";
import { ArrowUpRight, Send, ZoomIn } from "lucide-react";
import { Button } from "../components/ui/button";
import { Media } from "../components/Media";
import { planVersions, currentPlan, sourceData } from "../lib/data";
import type { RunData } from "../lib/types";

export function Planning({
  run,
  busy,
  onFeedback,
}: {
  run: RunData;
  busy: boolean;
  onFeedback: (stage: string, feedback: string) => void;
}) {
  const versions = planVersions(run),
    [version, setVersion] = useState(""),
    [selected, setSelected] = useState(""),
    [feedback, setFeedback] = useState(""),
    [stage, setStage] = useState("arrangement"),
    [zoom, setZoom] = useState(1);
  const plan =
      versions.find((v) => v.file === version)?.data || currentPlan(run),
    shots = plan?.shot_list?.shots || [],
    shot = shots.find((s: any) => s.shot_id === selected) || shots[0],
    source = plan?.source || sourceData(run);
  const assets = (plan?.assets || []).filter(
      (a: any) => a.shot_id === shot?.shot_id,
    ),
    direction = (plan?.directions || []).find(
      (d: any) => d.shot_id === shot?.shot_id,
    );
  const reviews = (plan?.reviews || []).filter(
    (r: any) =>
      !shot ||
      !r.scope ||
      !r.scope.includes(":") ||
      r.scope.endsWith(`:${shot.shot_id}`),
  );
  return (
    <div className="planning-layout">
      <div className="shot-list">
        <div className="inspector-title">
          镜头编排 <span>{shots.length} 镜</span>
        </div>
        {shots.map((s: any, i: number) => (
          <button
            className={`shot-item ${shot?.shot_id === s.shot_id ? "selected" : ""}`}
            key={s.shot_id}
            onClick={() => setSelected(s.shot_id)}
          >
            <span className="shot-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <span className="shot-type">
                {s.type === "static" ? "静态镜头" : "动作镜头"} · {s.duration}s
              </span>
              <strong>{s.intent}</strong>
              <small>{s.source_panel_ids.join(" → ")}</small>
            </div>
            <ArrowUpRight size={13} />
          </button>
        ))}
        {!shots.length && (
          <p className="muted padded">
            镜头编排尚未生成。可先查看脚本与审查记录。
          </p>
        )}
        <div className="shot-total">
          总时长{" "}
          <strong>
            {shots.reduce((n: number, s: any) => n + s.duration, 0).toFixed(1)}{" "}
            s
          </strong>
        </div>
      </div>
      <div className="planning-main">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SHOT DEVELOPMENT</span>
            <h2>{shot?.intent || "规划与脚本"}</h2>
            <p>
              {shot?.shot_id || "等待规划"}{" "}
              {shot?.type === "action" ? "／动作镜头" : "／镜头详情"}
            </p>
          </div>
          <select
            aria-label="规划版本"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          >
            <option value="">当前版本</option>
            {versions.map((v) => (
              <option key={v.file} value={v.file}>
                {v.file}
              </option>
            ))}
          </select>
        </div>
        {shot && (
          <>
            <div className="shot-copy">
              <span className="tag">{shot.duration} 秒</span>
              <span className="tag">{shot.camera}</span>
              <p>{shot.description}</p>
              <small>{shot.rationale}</small>
            </div>
            <div className="comparison-heading">
              <h3>原作 → 关键画面</h3>
              <Button size="sm" onClick={() => setZoom(zoom === 1 ? 1.5 : 1)}>
                <ZoomIn size={14} /> {zoom === 1 ? "放大" : "还原"}
              </Button>
            </div>
            <div className="comparison">
              <div>
                <div className="column-label">
                  漫画来源 / {shot.source_panel_ids.length} 格
                </div>
                <div className="manga-strip">
                  {shot.source_panel_ids.map((id: string) => {
                    const p = source?.panels?.find(
                      (p: any) => p.panel_id === id,
                    );
                    return p ? (
                      <figure key={id}>
                        <Media path={p.image} alt={id} zoom={zoom} />
                        <figcaption>
                          {id} · {p.text || "原作分格"}
                        </figcaption>
                      </figure>
                    ) : (
                      <p key={id}>来源 {id} 缺失</p>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="column-label">
                  动画关键画面 / {assets.length} 帧
                </div>
                {assets.map((a: any) => (
                  <figure className="anchor-frame" key={a.keyframe_id}>
                    <Media path={a.image} alt={a.description} zoom={zoom} />
                    <figcaption>
                      <b>{a.time}s</b> {a.keyframe_id}
                      <p>{a.description}</p>
                    </figcaption>
                  </figure>
                ))}
                {!assets.length && (
                  <div className="empty-frame">关键画面尚未生成</div>
                )}
              </div>
            </div>
            {direction && (
              <section className="direction">
                <h3>动作时间与节奏</h3>
                <p>{direction.rhythm}</p>
                {direction.anchors?.map((a: any) => (
                  <div className="anchor-row" key={a.keyframe_id}>
                    <b>{a.time}s</b>
                    <span className="tag">{a.role}</span>
                    <span>{a.description}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {plan?.script && (
          <details className="details">
            <summary>来源脚本与对白</summary>
            {plan.script.panels?.map((p: any) => (
              <div key={p.panel_id}>
                <b>{p.panel_id}</b>
                <p>{p.description}</p>
                {p.dialogue?.map((d: any, i: number) => (
                  <p key={i}>
                    {d.speaker_id || "未标记"}：{d.text}
                  </p>
                ))}
              </div>
            ))}
          </details>
        )}
      </div>
      <aside className="inspector">
        <div className="inspector-title">
          审查与修订 <span>Creator / Reviewer</span>
        </div>
        <div className="review-list">
          {reviews.map((r: any, i: number) => (
            <div className="review-item" key={i}>
              <div className="row">
                <span
                  className={`status ${r.accepted ? "passed" : "rejected"}`}
                >
                  {r.accepted ? "通过" : "需修订"}
                </span>
                <small>{r.scope || "审查"}</small>
              </div>
              <p>{r.reason}</p>
              {r.issues?.map((issue: any, j: number) => (
                <div className="issue" key={j}>
                  <strong>{issue.location}</strong>
                  <p>{issue.evidence}</p>
                  <small>{issue.suggestion}</small>
                </div>
              ))}
            </div>
          ))}
          {!reviews.length && <p className="muted">尚无审查结果。</p>}
        </div>
        <div className="feedback">
          <label>
            提交到阶段
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="script">来源脚本</option>
              <option value="arrangement">镜头编排</option>
              <option value="direction">动作演出</option>
              <option value="storyboard">关键画面</option>
            </select>
          </label>
          <div className="feedback-composer text-composer">
          <textarea
            placeholder="例如：保持双方视线关系，为入间的回应留出停顿。"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="reply-actions">
          <Button
            variant="default"
            disabled={busy || run.experimental || !feedback.trim()}
            onClick={() => onFeedback(stage, feedback)}
          >
            <Send size={14} />
            提交修订 · 付费
          </Button>
          </div>
          </div>
          <small>
            由原有 Agent
            修订与审查，可能产生模型费用。已有视频任务时须新建运行。
          </small>
        </div>
      </aside>
    </div>
  );
}
