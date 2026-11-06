import { ArrowDown,ArrowUp,Save,ScanLine,Trash2 } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { ToggleGroup } from '../components/controls';
import { Disclosure } from '../components/Disclosure';
import { Media } from "../components/Media";
import { Button } from "../components/ui/button";
import { Field,FieldLabel } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { ToggleGroupItem } from '../components/ui/toggle-group';
import type { PanelEdit } from "../lib/types";

type RegisterFlush=(flush:()=>Promise<void>)=>()=>void;
function useSourceSave(panels:any[],save:((panels:any[])=>Promise<void>)|undefined,registerFlush:RegisterFlush){
  const initial=useRef(JSON.stringify(panels)),latest=useRef(panels),handler=useRef(save);
  latest.current=panels;handler.current=save;
  const pending=useRef<Promise<void>|null>(null);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
  async function flush(){
    if(pending.current)await pending.current;
    const value=latest.current,version=JSON.stringify(value);
    if(version===initial.current)return;
    if(!handler.current)throw new Error('来源草稿尚未保存，请先打开项目');
    setError('');setSaving(true);setSaved(false);
    const job=handler.current(value);pending.current=job;
    try{await job;initial.current=version;setSaved(true);}
    catch(e){setError((e as Error).message);throw e;}
    finally{if(pending.current===job)pending.current=null;setSaving(false);}
  }
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(()=>registerFlush(()=>flushRef.current()),[]);
  return {flush,error,status:saving?'正在保存…':JSON.stringify(panels)!==initial.current?'尚未保存':saved?'已保存新版本':''};
}

export function SourceEditor({
  page,
  busy,
  onSave,
  onAuto,
  registerFlush,
  initial = [],
}: {
  page: string;
  busy: boolean;
  initial?: PanelEdit[];
  onSave: (panels: PanelEdit[]) => Promise<void>;
  registerFlush:RegisterFlush;
  onAuto: () => void;
}) {
  const [panels, setPanels] = useState<PanelEdit[]>(initial),
    [size, setSize] = useState([0, 0]),
    [start, setStart] = useState<number[] | null>(null),
    [end, setEnd] = useState<number[] | null>(null),
    [selected, setSelected] = useState(0);
  const save=useSourceSave(panels,onSave,registerFlush);
  const [mode,setMode]=useState<'browse'|'draw'>(initial.length?'browse':'draw');
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  // Source image needs intrinsic dimensions for pixel-exact crop coordinates.
  useEffect(() => {
    let alive = true;
    let lease: string | undefined;
    setUrl("");
    window.manga.media(page).then((media) => {
      if (alive) {lease=media.lease;setUrl(media.url);}
      else void window.manga.releaseMedia(media.lease);
    }).catch(()=>{if(alive)setUrl("");});
    return () => {
      alive = false;
      if (lease) void window.manga.releaseMedia(lease);
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
      <div className="editor-main" inert={busy}>
        <div className="section-heading">
          <div>
            <h2>分格与对白</h2>
            <p>{mode==='draw'?'拖动添加分格':'点击已有分格查看和校正'} · {panels.length} 格</p>
          </div>
          <Button onClick={onAuto} disabled={busy}>
            <ScanLine size={15} />
            自动分格 / OCR
          </Button>
        </div>
        <ToggleGroup className="editor-mode" label="分格编辑模式" value={mode} onValueChange={value=>setMode(value as "browse"|"draw")}><ToggleGroupItem value="browse">浏览与选择</ToggleGroupItem><ToggleGroupItem value="draw">绘制分格</ToggleGroupItem></ToggleGroup>
        <div className="page-canvas">
          <div
            ref={box}
            className="crop-surface"
            onPointerDown={(event) => {
              if (busy || event.button !== 0 || !size[0]) return;
              if(mode==='browse'){
                const [x,y]=point(event);
                const hits=panels.map((p,i)=>({p,i})).filter(({p})=>x>=p.bbox[0]&&x<=p.bbox[2]&&y>=p.bbox[1]&&y<=p.bbox[3]);
                hits.sort((a,b)=>(a.p.bbox[2]-a.p.bbox[0])*(a.p.bbox[3]-a.p.bbox[1])-(b.p.bbox[2]-b.p.bbox[0])*(b.p.bbox[3]-b.p.bbox[1]));
                if(hits.length)setSelected(hits[0].i);
                return;
              }
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
        <div className="panel-edit-list" inert={busy}>
          {!panels.length && (
            <p className="muted">在漫画页上拖动，框选第一个分格。</p>
          )}
          {panels.map((p, i) => (
            <div
              key={i}
              className={`panel-edit ${selected === i ? "active" : "compact-panel-edit"}`}
              onClick={() => setSelected(i)}
            >
              <div className="row">
                <strong>分格 {String(i + 1).padStart(2, "0")}</strong>
                <div className="row" onClick={e=>e.stopPropagation()}>
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
                    onClick={() => {setPanels(panels.filter((_, j) => j !== i));setSelected(Math.max(0,Math.min(selected>i?selected-1:selected,panels.length-2)));}}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              {selected!==i&&<Button variant="ghost" size="sm" className="panel-summary h-auto justify-start whitespace-normal text-left" onClick={()=>setSelected(i)}>{p.text||'选择后校正对白'}</Button>}
              {selected===i&&<>
              <Field><FieldLabel htmlFor={`speaker-${i}`}>说话人</FieldLabel>
                <Input id={`speaker-${i}`}
                  disabled={busy}
                  value={p.speaker}
                  placeholder="可留空"
                  onChange={(e) => update(i, { speaker: e.target.value })}
                />
              </Field>
              <Field><FieldLabel htmlFor={`dialogue-${i}`}>原文对白</FieldLabel>
                <Textarea id={`dialogue-${i}`}
                  disabled={busy}
                  value={p.text}
                  placeholder="校正对白，不确定内容请标注"
                  onChange={(e) => update(i, { text: e.target.value })}
                />
              </Field>
              <Disclosure className="panel-coordinates" title={<>分格坐标</>}><div className="bbox-inputs">
                {p.bbox.map((n, j) => (
                  <Input
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
              </div></Disclosure>
              </>}
            </div>
          ))}
        </div>
        <div className="inspector-footer">
          <Button
            variant="default"
            disabled={busy || !panels.length}
            onClick={() => void save.flush().catch(()=>{})}
          >
            <Save size={15} />
            保存新来源版本
          </Button>
          <p role="status">{save.status||'修改将保存为新来源版本'}</p>{save.error&&<p role="alert">{save.error}</p>}
        </div>
      </aside>
    </div>
  );
}
export function SourceView({
  source,
  onRevise,
  registerFlush,
  busy,
}: {
  source: any;
  onRevise?: (panels: any[]) => Promise<void>;
  registerFlush:RegisterFlush;
  busy:boolean;
}) {
  const [zoom, setZoom] = useState(1),
    [editing, setEditing] = useState(false),
    [selected,setSelected]=useState(0),
    [panels, setPanels] = useState<any[]>(source?.panels || []);
  const save=useSourceSave(panels,onRevise,registerFlush);
  return (
    <div className="padded">
      {save.error&&<p role="alert">{save.error}</p>}
      <div className="section-heading">
        <div>
          <h2>原作素材</h2>
          <p>{source?.panels?.length || 0} 格 · 来源与顺序保留</p>
        </div>
        <div className="row">
          {onRevise && (
            <Button
              disabled={busy}
              onClick={() => {if(editing)void save.flush().then(()=>setEditing(false)).catch(()=>{});else setEditing(true);}}
            >
              {editing ? "保存对白新版本" : "校正对白"}
            </Button>
          )}
          <Button onClick={() => setZoom(zoom === 1 ? 1.4 : 1)}>
            缩放 {Math.round(zoom * 100)}%
          </Button>
        </div>
      </div>
      {save.status&&<p role="status">{save.status}</p>}
      <div className="source-grid">
        {source?.panels?.map((panel: any, i: number) => (
          <article className={`source-tile ${editing&&selected===i?'editing-source-tile':''}`} key={panel.panel_id}>
            <div className="tile-label">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span>{panel.panel_id}</span>
            </div>
            <div className="source-image">
              <Media path={panel.image} alt={panel.panel_id} zoom={zoom} />
            </div>
            {editing&&selected===i ? (
              <label className="padded">
                说话人：对白
                <Textarea
                  disabled={busy}
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
              <><p>{panel.text || "未记录逐格文字"}</p>{editing&&<Button size="sm" variant="ghost" onClick={()=>setSelected(i)}>编辑此格对白</Button>}</>
            )}
          </article>
        ))}
      </div>
      {source?.transcript && (
        <Disclosure className="details" title={<>原文转录</>}>

          <pre>{source.transcript}</pre>
        </Disclosure>
      )}
    </div>
  );
}
