import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Save, ScanLine } from "lucide-react";
import { Button } from "../components/ui/button";
import { Media } from "../components/Media";
import type { PanelEdit } from "../lib/types";

export function SourceEditor({
  page,
  busy,
  onSave,
  onAuto,
  initial = [],
}: {
  page: string;
  busy: boolean;
  initial?: PanelEdit[];
  onSave: (panels: PanelEdit[]) => void;
  onAuto: () => void;
}) {
  const [panels, setPanels] = useState<PanelEdit[]>(initial),
    [size, setSize] = useState([0, 0]),
    [start, setStart] = useState<number[] | null>(null),
    [end, setEnd] = useState<number[] | null>(null),
    [selected, setSelected] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  // Source image needs intrinsic dimensions for pixel-exact crop coordinates.
  useEffect(() => {
    let alive = true;
    window.manga.media(page).then((url) => {
      if (alive) setUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [page]);
  const point = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return [
      Math.round(
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
          size[0],
      ),
      Math.round(
        Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) *
          size[1],
      ),
    ];
  };
  function update(i: number, change: Partial<PanelEdit>) {
    setPanels((p) => p.map((v, j) => (j === i ? { ...v, ...change } : v)));
  }
  function move(i: number, delta: number) {
    const next = [...panels];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setPanels(next);
    setSelected(i + delta);
  }
  function outline(b: number[]) {
    return {
      left: `${(b[0] / size[0]) * 100}%`,
      top: `${(b[1] / size[1]) * 100}%`,
      width: `${((b[2] - b[0]) / size[0]) * 100}%`,
      height: `${((b[3] - b[1]) / size[1]) * 100}%`,
    };
  }
  const drawing =
    start && end
      ? [
          Math.min(start[0], end[0]),
          Math.min(start[1], end[1]),
          Math.max(start[0], end[0]),
          Math.max(start[1], end[1]),
        ]
      : null;
  return (
    <div className="editor-layout">
      <div className="editor-main">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SOURCE EDITOR</span>
            <h2>从原作开始</h2>
            <p>拖动画面添加矩形分格，右侧列表顺序即阅读顺序。</p>
          </div>
          <Button onClick={onAuto} disabled={busy}>
            <ScanLine size={15} />
            自动分格 / OCR
          </Button>
        </div>
        <div className="page-canvas">
          <div
            ref={box}
            className="crop-surface"
            onPointerDown={(event) => {
              if (event.button !== 0 || !size[0]) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const p = point(event);
              setStart(p);
              setEnd(p);
            }}
            onPointerMove={(event) => {
              if (start) setEnd(point(event));
            }}
            onPointerUp={(event) => {
              if (start) {
                const p = point(event);
                const b = [
                  Math.min(start[0], p[0]),
                  Math.min(start[1], p[1]),
                  Math.max(start[0], p[0]),
                  Math.max(start[1], p[1]),
                ];
                if (b[2] - b[0] > 8 && b[3] - b[1] > 8) {
                  setPanels([...panels, { bbox: b, text: "", speaker: "" }]);
                  setSelected(panels.length);
                }
                setStart(null);
                setEnd(null);
              }
            }}
          >
            {url && (
              <img
                draggable={false}
                src={url}
                alt="漫画原始页面，拖动添加分格"
                onLoad={(e) =>
                  setSize([
                    e.currentTarget.naturalWidth,
                    e.currentTarget.naturalHeight,
                  ])
                }
              />
            )}
            {size[0] > 0 &&
              panels.map((p, i) => (
                <div
                  key={i}
                  className={`crop-box ${i === selected ? "selected" : ""}`}
                  style={outline(p.bbox)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </div>
              ))}
            {drawing && (
              <div className="crop-box drawing" style={outline(drawing)} />
            )}
          </div>
        </div>
      </div>
      <aside className="inspector">
        <div className="inspector-title">
          阅读顺序 <span>{panels.length} 格</span>
        </div>
        <div className="panel-edit-list">
          {!panels.length && (
            <p className="muted">在漫画页上拖动，框选第一个分格。</p>
          )}
          {panels.map((p, i) => (
            <div
              key={i}
              className={`panel-edit ${selected === i ? "active" : ""}`}
              onClick={() => setSelected(i)}
            >
              <div className="row">
                <strong>分格 {String(i + 1).padStart(2, "0")}</strong>
                <div className="row">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="前移"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="后移"
                    disabled={i === panels.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="删除"
                    onClick={() => setPanels(panels.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              <div className="coordinates">{p.bbox.join(" · ")}</div>
              <label>
                说话人
                <input
                  value={p.speaker}
                  placeholder="可留空"
                  onChange={(e) => update(i, { speaker: e.target.value })}
                />
              </label>
              <label>
                原文对白
                <textarea
                  value={p.text}
                  placeholder="校正对白，不确定内容请标注"
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              </label>
              <div className="bbox-inputs">
                {p.bbox.map((n, j) => (
                  <input
                    key={j}
                    type="number"
                    aria-label={["左", "上", "右", "下"][j]}
                    value={n}
                    onChange={(e) =>
                      update(i, {
                        bbox: p.bbox.map((v, k) =>
                          k === j ? Number(e.target.value) : v,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="inspector-footer">
          <Button
            variant="default"
            disabled={busy || !panels.length}
            onClick={() => onSave(panels)}
          >
            <Save size={15} />
            保存新来源版本
          </Button>
          <p>保留原始页面与旧运行，修改不会覆盖已生成内容。</p>
        </div>
      </aside>
    </div>
  );
}
export function SourceView({
  source,
  onRevise,
}: {
  source: any;
  onRevise?: (panels: any[]) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [editing, setEditing] = useState(false),
    [panels, setPanels] = useState<any[]>(source?.panels || []);
  return (
    <div className="padded">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MANGA SOURCE</span>
          <h2>原作素材</h2>
          <p>{source?.panels?.length || 0} 格 · 来源与顺序保留</p>
        </div>
        <div className="row">
          {onRevise && (
            <Button
              onClick={() => {
                if (editing) {
                  onRevise(panels);
                  setEditing(false);
                } else setEditing(true);
              }}
            >
              {editing ? "保存对白新版本" : "校正对白"}
            </Button>
          )}
          <Button onClick={() => setZoom(zoom === 1 ? 1.4 : 1)}>
            缩放 {Math.round(zoom * 100)}%
          </Button>
        </div>
      </div>
      <div className="source-grid">
        {source?.panels?.map((panel: any, i: number) => (
          <article className="source-tile" key={panel.panel_id}>
            <div className="tile-label">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span>{panel.panel_id}</span>
            </div>
            <div className="source-image">
              <Media path={panel.image} alt={panel.panel_id} zoom={zoom} />
            </div>
            {editing ? (
              <label className="padded">
                说话人：对白
                <textarea
                  aria-label={`${panel.panel_id} 对白`}
                  value={panels[i]?.text || ""}
                  onChange={(e) =>
                    setPanels(
                      panels.map((p, j) =>
                        j === i ? { ...p, text: e.target.value } : p,
                      ),
                    )
                  }
                />
              </label>
            ) : (
              <p>{panel.text || "未记录逐格文字"}</p>
            )}
          </article>
        ))}
      </div>
      {source?.transcript && (
        <details className="details">
          <summary>原文转录</summary>
          <pre>{source.transcript}</pre>
        </details>
      )}
    </div>
  );
}
