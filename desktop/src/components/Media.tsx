import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
export function Media({
  path,
  video = false,
  alt = "",
  className = "",
  zoom = 1,
  compact = false,
}: {
  path: string;
  video?: boolean;
  alt?: string;
  className?: string;
  zoom?: number;
  compact?: boolean;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setUrl("");
    setStarted(false);
    setError("");
    window.manga
      .media(path)
      .then((url) => {
        if (alive) setUrl(url);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  if (error)
    return <div className="media-error" role="alert">{error}</div>;
  if (!url) return <div className="media-loading">加载本地媒体…</div>;
  return video ? (
    <div className={compact ? "compact-video" : undefined}><video
      ref={player}
      key={url}
      src={url}
      controls={!compact || started}
      onPlay={() => setStarted(true)}
      onError={() => setError("视频无法加载或解码，请检查本地文件。")}
      preload={compact ? "metadata" : "none"}
      className={className}
    />{compact && !started && <button className="compact-play" aria-label="播放成片" onClick={() => {
      void player.current?.play().catch(() => setError("无法播放此视频，请检查本地文件。"));
    }}><Play size={20}/></button>}</div>
  ) : (
    <img
      src={url}
      alt={alt}
      className={className}
      style={{
        maxWidth: `${zoom * 100}%`,
        width: zoom > 1 ? `${zoom * 100}%` : undefined,
      }}
    />
  );
}
