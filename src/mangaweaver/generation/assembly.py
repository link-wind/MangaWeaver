"""显式连接并保留原生音轨，不以叠化或变速掩盖接缝。"""
import json
import subprocess
from fractions import Fraction
from pathlib import Path


def probe(path: Path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                            check=True, capture_output=True, text=True)
    info = json.loads(result.stdout)
    if not any(s.get("codec_type") == "video" for s in info["streams"]):
        raise ValueError(f"文件没有视频轨：{path}")
    if float(info["format"].get("duration", 0)) <= 0:
        raise ValueError(f"视频时长无效：{path}")
    return info


def _frame_hash(path, last=False):
    args = ["ffmpeg", "-v", "error"]
    # 解码实际末帧，不用外推的时间点。仅严格相同像素时去重。
    args += ["-i", str(path), "-map", "0:v:0", "-an"]
    if last:
        args += ["-f", "framemd5", "-"]
        lines = subprocess.run(args, check=True, capture_output=True, text=True).stdout.splitlines()
        return next(line.rsplit(",", 1)[-1].strip() for line in reversed(lines) if line and not line.startswith("#"))
    args += ["-frames:v", "1", "-f", "framemd5", "-"]
    lines = subprocess.run(args, check=True, capture_output=True, text=True).stdout.splitlines()
    return next(line.rsplit(",", 1)[-1].strip() for line in lines if line and not line.startswith("#"))


def clip_ranges(paths, continuous=False):
    """供音视频与字幕共用的实际裁剪区间。"""
    result = []
    for i, path in enumerate(paths):
        info = probe(path)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        drop = continuous and i > 0 and _frame_hash(paths[i-1], last=True) == _frame_hash(path)
        start = float(1 / Fraction(video["avg_frame_rate"])) if drop else 0
        duration = float(video.get("duration") or info["format"]["duration"]) - start
        result.append((start, duration))
    return result


def assemble(paths: list[Path], destination: Path, continuous=False, fps=24):
    if not paths:
        raise ValueError("没有视频可以组装")
    infos = [probe(path) for path in paths]
    for path, info in zip(paths, infos):
        if not any(s.get("codec_type") == "audio" for s in info["streams"]):
            raise ValueError(f"片段缺少音轨，不能导出有声成片：{path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    args = ["ffmpeg", "-v", "error", "-y"]
    for path in paths:
        args += ["-i", str(path)]
    filters = []
    for i, (audio_start, duration) in enumerate(clip_ranges(paths, continuous)):
        drop = audio_start > 0
        # 跨镜头 cut 不删帧；同镜头仅删除可证实重复的一帧。
        trim = "trim=start_frame=1," if drop else ""
        filters.append(f"[{i}:v:0]{trim}setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,"
                       f"pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},format=yuv420p[v{i}]")
        # 音频跟随视频边界裁剪，统一采样格式，不混入新的配乐。
        filters.append(f"[{i}:a:0]atrim=start={audio_start},asetpts=PTS-STARTPTS,"
                       f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                       f"apad,atrim=duration={duration}[a{i}]")
    inputs = "".join(f"[v{i}][a{i}]" for i in range(len(paths)))
    filters.append(f"{inputs}concat=n={len(paths)}:v=1:a=1[outv][outa]")
    temporary = destination.with_name(destination.stem + ".partial.mp4")
    args += ["-filter_complex", ";".join(filters), "-map", "[outv]", "-map", "[outa]",
             "-c:a", "aac", "-b:a", "192k", "-c:v", "libx264",
             "-crf", "18", "-movflags", "+faststart", str(temporary)]
    subprocess.run(args, check=True, capture_output=True)
    info = probe(temporary)
    if not any(s.get("codec_type") == "audio" for s in info["streams"]):
        raise ValueError(f"导出结果缺少音轨：{temporary}")
    temporary.replace(destination)
    return destination
