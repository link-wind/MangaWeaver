import { Play } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import { Alert,AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Spinner } from './ui/spinner';
export function Media({
  path,
  revision,
  video = false,
  alt = "",
  className = "",
  zoom = 1,
  compact = false,
  compactLabel = "播放成片",
  onCompactOpen,
}: {
  path: string;
  revision?:string;
  video?: boolean;
  alt?: string;
  className?: string;
  zoom?: number;
  compact?: boolean;
  compactLabel?: string;
  onCompactOpen?: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let lease: string | undefined;
    setUrl("");
    setStarted(false);
    setError("");
    window.manga
      .media(path)
      .then((media) => {
        if (alive) { lease=media.lease; setUrl(media.url); }
        else void window.manga.releaseMedia(media.lease);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      if (lease) void window.manga.releaseMedia(lease);
    };
  }, [path,revision]);
  if (error)
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!url) return <Skeleton className="media-loading min-h-16 w-full" role="status"><Spinner className="size-4"/><span className="sr-only">加载本地媒体…</span></Skeleton>;
  return video ? (
    <div className={compact ? "compact-video" : "media-video"}><video
      ref={player}
      key={url}
      src={url}
      controls={!compact || started}
      onPlay={() => setStarted(true)}
      onError={() => setError("视频无法加载或解码，请检查本地文件。")}
      preload={compact ? "metadata" : "none"}
      className={className}
    />{compact && !started && <Button variant="ghost" size="sm" className="compact-play absolute inset-0 h-full w-full rounded-none bg-transparent hover:bg-black/5" aria-label={compactLabel} onClick={() => {
      if(onCompactOpen){onCompactOpen();return;}
      void player.current?.play().catch(() => setError("无法播放此视频，请检查本地文件。"));
    }}><Play className="size-10 rounded-full bg-black/60 p-2.5 text-white"/></Button>}</div>
  ) : (
    <img
      src={url}
      alt={alt}
      onError={()=>setError('图片无法加载，请检查本地文件。')}
      className={className}
      style={{
        maxWidth: `${zoom * 100}%`,
        width: zoom > 1 ? `${zoom * 100}%` : undefined,
      }}
    />
  );
}
