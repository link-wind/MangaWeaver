import { ArrowUpRight,Send,ZoomIn } from "lucide-react";
import { useState } from "react";
import { Select } from '../components/controls';
import { Disclosure } from '../components/Disclosure';
import { Media } from "../components/Media";
import { Badge } from '../components/ui/badge';
import { Button } from "../components/ui/button";
import { Field,FieldLabel } from '../components/ui/field';
import { InputGroup,InputGroupAddon,InputGroupTextarea } from '../components/ui/input-group';
import { SelectItem } from '../components/ui/select';
import { currentPlan,planVersions,sourceData } from "../lib/data";
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
    <div className="planning-layout specialist-page">
      <div className="shot-list">
        <div className="inspector-title">
          镜头编排 <span>{shots.length} 镜</span>
        </div>
        {shots.map((s: any, i: number) => (
          <Button variant="ghost" size="sm"
            className={`shot-item h-auto justify-start whitespace-normal py-3 ${shot?.shot_id === s.shot_id ? "selected" : ""}`}
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
          </Button>
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

            <h2>镜头规划</h2>
            <p>
              {shot?.shot_id || "等待规划"}{" "}
              {shot?.type === "action" ? "／动作镜头" : "／镜头详情"}
            </p>
          </div>
          <Select
            label="规划版本"
            value={version || 'current'}
            onValueChange={value=>setVersion(value==='current'?'':value)}
          >
            <SelectItem value="current">当前版本</SelectItem>
            {versions.map((v) => (
              <SelectItem key={v.file} value={v.file}>
                {v.file==='production.json'?'已通过规划':v.file==='planning_draft.json'?'当前草案':v.file.replace(/\.json$/,'').replaceAll('/',' · ')}
              </SelectItem>
            ))}
          </Select>
        </div>
        {shot && (
          <>
            <div className="shot-copy">
              <Badge variant="secondary">{shot.duration} 秒</Badge>
              <Badge variant="secondary">{shot.camera}</Badge>
              <h3>{shot.intent}</h3><p>{shot.description}</p>
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
                    <Media path={a.image} revision={a.image_signature} alt={a.description} zoom={zoom} />
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
                    <Badge variant="secondary">{a.role}</Badge>
                    <span>{a.description}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {plan?.script && (
          <Disclosure className="details" title={<>来源脚本与对白</>}>

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
          </Disclosure>
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
                <Badge variant={r.accepted===false?"destructive":"secondary"}>
                  {r.accepted===true?"通过":r.accepted===false?"需修订":"未审查"}
                </Badge>
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
          <Field><FieldLabel>提交到阶段</FieldLabel>
            <Select label="修订阶段" value={stage} onValueChange={setStage}>
              <SelectItem value="script">来源脚本</SelectItem>
              <SelectItem value="arrangement">镜头编排</SelectItem>
              <SelectItem value="direction">动作演出</SelectItem>
              <SelectItem value="storyboard">关键画面</SelectItem>
            </Select>
          </Field>
          <InputGroup className="feedback-composer">
          <InputGroupTextarea aria-label="阶段修订要求"
            placeholder="例如：保持双方视线关系，为入间的回应留出停顿。"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <InputGroupAddon align="block-end" className="justify-end">
          <Button
            variant="default"
            disabled={busy || run.experimental || !feedback.trim()}
            onClick={() => onFeedback(stage, feedback)}
          >
            <Send size={14} />
            修订所选阶段 · 付费
          </Button>
          </InputGroupAddon>
          </InputGroup>
          <small>
            由原有 Agent
            修订与审查，可能产生模型费用。已有视频任务时须新建运行。
          </small>
        </div>
      </aside>
    </div>
  );
}
