"""按视频评审的实际发声区间写字幕；Pillow 字幕层不依赖 libass。"""
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pydantic import Field

from ..schemas import Model
from .assembly import clip_ranges, probe


class HeardCue(Model):
    cue_id: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    heard_ja: str


class Subtitle(Model):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str


def from_review(speech, report, path):
    expected = {c.cue_id: c for c in speech.cues}
    observed = {c.cue_id: c for c in report.heard_cues}
    duration = float(probe(path)["format"]["duration"])
    if len(observed) != len(report.heard_cues) or set(observed) != set(expected):
        raise ValueError("视频评审没有逐句标注所有已分配日语对白，不能添加未经核对的字幕")
    result, previous_end = [], 0
    for cue in sorted(observed.values(), key=lambda c: c.start):
        if not previous_end <= cue.start < cue.end <= duration or not cue.heard_ja.strip():
            raise ValueError("对白实际时间无效或缺少可听台词记录")
        previous_end = cue.end
        result.append(Subtitle(start=cue.start, end=cue.end, text=expected[cue.cue_id].subtitle_zh))
    return result


def combine(paths, tracks, continuous=False):
    if len(paths) != len(tracks):
        raise ValueError("字幕轨与视频段数量不一致")
    offset, result = 0, []
    for (start, duration), track in zip(clip_ranges(paths, continuous), tracks):
        for cue in track:
            left, right = max(start, cue.start), min(start + duration, cue.end)
            if right > left:
                result.append(Subtitle(start=offset + left-start, end=offset + right-start, text=cue.text))
        offset += duration
    return result


def _timestamp(seconds):
    ms = round(seconds * 1000)
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{sec:02d},{ms:03d}"


def export(source, cues, destination, font_path=None):
    info = probe(source)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    width, height = video["width"], video["height"]
    duration = float(video.get("duration") or info["format"]["duration"])
    srt = destination.with_suffix(".srt")
    srt.write_text("\n\n".join(f"{i}\n{_timestamp(c.start)} --> {_timestamp(c.end)}\n{c.text}"
                              for i,c in enumerate(cues,1)) + "\n", encoding="utf-8")
    if not cues:
        import shutil
        shutil.copyfile(source, destination)
        return destination
    if font_path is None:
        import os
        font_path = os.getenv("SUBTITLE_FONT")
    if not font_path:
        raise ValueError("请设置 SUBTITLE_FONT 为支持中文字幕的字体路径")
    font = ImageFont.truetype(str(font_path), max(24, round(height * 0.05)))
    layers = destination.parent / (destination.stem + "_subtitle_layers")
    layers.mkdir(parents=True, exist_ok=True)
    args = ["ffmpeg", "-v", "error", "-y", "-i", str(source)]
    filters, label = [], "0:v:0"
    for i, cue in enumerate(cues, 1):
        if not 0 <= cue.start < cue.end <= duration:
            raise ValueError("字幕超出导出视频范围")
        image = Image.new("RGBA", (width, height), (0,0,0,0))
        draw = ImageDraw.Draw(image)
        lines, line = [], ""
        for char in cue.text:
            if draw.textlength(line + char, font=font) > width * .85:
                lines.append(line); line = ""
            line += char
        lines.append(line)
        line_height = math.ceil(font.size * 1.35)
        y = height - round(height * .06) - line_height * len(lines)
        for line in lines:
            x = (width - draw.textlength(line, font=font)) / 2
            draw.text((x,y), line, font=font, fill="white", stroke_width=2, stroke_fill="black")
            y += line_height
        layer = layers / f"{i:03d}.png"
        image.save(layer)
        args += ["-loop", "1", "-i", str(layer)]
        out = f"sub{i}"
        filters.append(f"[{label}][{i}:v]overlay=enable='gte(t,{cue.start})*lt(t,{cue.end})'[{out}]")
        label = out
    temporary = destination.with_name(destination.stem + ".partial.mp4")
    args += ["-filter_complex_threads", "1", "-filter_complex", ";".join(filters),
             "-map", f"[{label}]", "-map", "0:a:0", "-c:v", "libx264", "-crf", "18",
             "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", str(duration), "-movflags", "+faststart", str(temporary)]
    subprocess.run(args,check=True,capture_output=True)
    probe(temporary)
    temporary.replace(destination)
    return destination
