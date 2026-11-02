"""三个阶段的薄命令入口。"""
import argparse
import json
import logging
import os
import subprocess

from requests import RequestException
from pathlib import Path

from .config import Config
from .io import file_signature, read_json, signature, write_json


def parser():
    root = argparse.ArgumentParser(prog="mangaweaver", description="漫画理解、镜头编排与动画生成")
    root.add_argument("--env-file", type=Path, help="显式指定 .env 文件")
    commands = root.add_subparsers(dest="command", required=True)
    pre = commands.add_parser("preprocess", help="自动分格/OCR，或导入人工准备的来源清单")
    inputs = pre.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--page", type=Path, action="append", help="按阅读顺序多次指定页面")
    inputs.add_argument("--manifest", type=Path, help="已有 SourceManifest JSON，图片路径相对该文件")
    pre.add_argument("--reference", type=Path, action="append", default=[])
    pre.add_argument("--case", default="case", help="自动预处理案例 ID")
    pre.add_argument("--device", help="MAGI 的 cpu/cuda 等设备")
    pre.add_argument("--ocr-backend", choices=["magi", "rapidocr"], help="本地文字识别，默认读取 LOCAL_OCR_PROVIDER")
    plan = commands.add_parser("plan", help="来源脚本、镜头编排、演出和分镜反馈循环")
    plan.add_argument("--source", type=Path, help="SourceManifest；默认读取运行目录的 source/manifest.json")
    plan.add_argument("--resume", action="store_true", help="继续同一输入下的未完成阶段")
    plan.add_argument("--from-stage", choices=["script", "arrangement", "direction", "storyboard"],
                      help="对已有规划显式开始新一轮阶段修订")
    plan.add_argument("--feedback", default="", help="显式重跑时的修订要求")
    plan.add_argument("--until-stage", choices=["script", "arrangement", "direction", "storyboard"], help="通过指定阶段审查后暂停，等待用户继续")
    plan.add_argument("--location", default="all", help="修订目标，如镜头或关键帧 ID")
    gen = commands.add_parser("generate", help="构建任务、调用 H3、评审与剪辑")
    gen.add_argument("--plan", type=Path, help="ProductionPlan；默认读取运行目录的 production.json")
    gen.add_argument("--dry-run", action="store_true", help="校验并保存任务，不创建模型客户端或提交任务")
    for command in (pre, plan, gen):
        command.add_argument("--run-dir", type=Path, required=True, help="明确指定本次运行目录")
    return root


def _record_config(run_dir, config):
    path = run_dir / "config.json"
    if path.exists() and Config(**read_json(path)).snapshot() != config.snapshot():
        raise ValueError("运行配置与已有记录不同，请使用原配置继续或指定新运行目录")
    write_json(path, config.snapshot())


def _record_source(run_dir, source):
    record = {"source": source.model_dump(mode="json"),
              "media": [file_signature(p) for p in source.images + source.reference_images]}
    path = run_dir / "source" / "input_signature.json"
    fingerprint = signature(record)
    if path.exists() and read_json(path)["signature"] != fingerprint:
        raise ValueError("来源内容与该运行目录不同，请使用新目录，避免混用旧计划和新素材")
    write_json(path, {"signature": fingerprint})
    write_json(run_dir / "source" / "manifest.json", source)


def main(argv=None):
    root = parser()
    args = root.parse_args(argv)
    try:
        config = Config.load(args.env_file)
        run_dir = args.run_dir.resolve()
        run_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                            handlers=[logging.StreamHandler(), logging.FileHandler(run_dir / "log.txt", encoding="utf-8")])
        from .run_lock import run_lock
        with run_lock(run_dir, args.command):
            execute(args, config, run_dir)
    except (ValueError, RuntimeError, OSError, TimeoutError, RequestException, subprocess.CalledProcessError) as exc:
        root.exit(1, f"错误：{exc}\n")
    return 0


def execute(args, config, run_dir):
    from .events import emit
    emit(args.command, status="running")
    _record_config(run_dir, config)
    if args.command == "preprocess":
        if args.manifest:
            from .preprocessing.transcript import load_source
            source = load_source(args.manifest)
        else:
            if (run_dir / "source" / "manifest.json").exists():
                raise ValueError("该运行已有来源清单；自动预处理请使用新运行目录")
            from .preprocessing.character_description import run
            source = run(args.page, run_dir, args.case, args.reference, args.device,
                         args.ocr_backend or os.getenv("LOCAL_OCR_PROVIDER", "magi"))
        _record_source(run_dir, source)
        print(f"已保存 {len(source.panels)} 格来源：{run_dir / 'source' / 'manifest.json'}")
    elif args.command == "plan":
        from .preprocessing.transcript import load_source
        from .planning.pipeline import run
        source = load_source(args.source or run_dir / "source" / "manifest.json")
        if any(run_dir.glob("iter*")) and not (args.resume or args.from_stage):
            raise ValueError("该运行已有规划，请使用 --resume、--from-stage 或新运行目录")
        _record_source(run_dir, source)
        from .clients import create
        result = run(create(config), source, run_dir, args.from_stage, args.feedback, args.until_stage, args.location)
        if (run_dir / "planning_pause.json").exists():
            print(f"阶段检查点已保存：{run_dir / 'planning_pause.json'}")
        else:
            print(f"已选定 {len(result.shot_list.shots)} 个镜头：{run_dir / 'production.json'}")
    else:
        from .generation.tasks import load_plan
        from .generation.pipeline import run
        result = run(config, load_plan(args.plan or run_dir / "production.json"), run_dir, args.dry_run)
        if args.dry_run:
            print(json.dumps([{"segment": j.segment_id, "mode": j.mode, "seconds": j.target_duration}
                              for j in result], ensure_ascii=False, indent=2))
            print("仅构建任务，未调用模型。")
        else:
            print(f"已导出：{result}")
