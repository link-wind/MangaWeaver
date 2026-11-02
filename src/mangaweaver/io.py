"""JSON、模板与直接的文件式恢复。"""
import hashlib
import json
from importlib.resources import files
from pathlib import Path

from pydantic import BaseModel


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    if path.name in {'manifest.json', 'prepared.json', 'planning_draft.json', 'planning_state.json', 'production.json',
                     'selected.json', 'tasks.json', 'generation_tasks.json', 'export.json'}:
        from .events import artifact
        artifact(path)
    return path


def prompt(name: str):
    # editable 安装读取根目录模板；wheel 安装读取构建时打包的同一套资源。
    root = Path(__file__).resolve().parents[2]
    if (root / "pyproject.toml").is_file():
        return (root / "prompts" / name).read_text(encoding="utf-8")
    return files("mangaweaver").joinpath("prompts", name).read_text(encoding="utf-8")


def signature(value):
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def file_signature(path: Path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def project_run(project, directory):
    """新运行在 runs/ 下；原地接入的旧运行由项目索引明确登记为 .。"""
    project, directory = Path(project).resolve(), Path(directory).resolve()
    return directory.is_relative_to(project / 'runs') or (
        directory == project and '.' in read_json(project / 'project.json').get('runs', []))


def cached_json(path: Path, context, produce, model):
    """输入有变化时明确要求新运行／显式重跑，不自动传播失效。"""
    path = Path(path)
    metadata = path.with_suffix(".input.json")
    fingerprint = signature(context)
    if path.exists():
        if not metadata.exists() or read_json(metadata)["signature"] != fingerprint:
            raise ValueError(f"已有产物输入不同：{path}。请使用新运行目录或显式重跑对应阶段。")
        return model.model_validate(read_json(path))
    result = produce()
    write_json(path, result)
    write_json(metadata, {"signature": fingerprint})
    return result
