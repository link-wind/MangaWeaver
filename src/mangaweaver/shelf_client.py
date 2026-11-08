"""MangaShelf 平台接入客户端（协议 v1）。

协议契约见平台仓库 docs/api/mangaweaver-integration.md。凭证为用户在平台
「个人设置」创建的接入 Token（原始值仅展示一次）；模型 Key 不传给平台。
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import requests

SCHEMA_VERSION = 1
UPLOAD_POLL_SECONDS = 120
VERIFY_POLL_SECONDS = 240


class PlatformError(RuntimeError):
    """平台调用失败（HTTP 非 2xx 或响应不符合协议）。"""


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _post(base: str, token: str, path: str, payload: dict) -> dict:
    r = requests.post(f"{base.rstrip('/')}{path}", json=payload,
                      headers=_headers(token), timeout=60)
    if r.status_code >= 400:
        raise PlatformError(f"POST {path} -> {r.status_code}: {r.text[:200]}")
    return r.json()


def _get(base: str, token: str, path: str) -> dict:
    r = requests.get(f"{base.rstrip('/')}{path}", headers=_headers(token), timeout=60)
    if r.status_code >= 400:
        raise PlatformError(f"GET {path} -> {r.status_code}: {r.text[:200]}")
    return r.json()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_pages(base: str, token: str, chapter_revision_id: str, output: Path) -> Path:
    """导出章节版本页面：逐页下载、核验 SHA-256、落盘并写清单（协议 17.2）。"""
    output.mkdir(parents=True, exist_ok=True)
    manifest = _post(base, token, "/api/v1/integrations/mangaweaver/exports", {
        "schema_version": SCHEMA_VERSION,
        "chapter_revision_id": chapter_revision_id,
    })
    pages_dir = output / "pages"
    pages_dir.mkdir(exist_ok=True)
    saved = []
    for page in manifest["pages"]:
        ordinal = page["ordinal"]
        target = pages_dir / f"page{ordinal:04d}{Path(page['download_url'].split('?')[0]).suffix}"
        r = requests.get(page["download_url"], timeout=60)
        if r.status_code != 200:
            raise PlatformError(f"页面 {ordinal} 下载失败：HTTP {r.status_code}")
        target.write_bytes(r.content)
        actual = _sha256(target)
        if actual != page["sha256"]:
            raise PlatformError(
                f"页面 {ordinal} 摘要不一致：声明 {page['sha256'][:12]}…，实际 {actual[:12]}…")
        saved.append({"ordinal": ordinal, "page_id": page["page_id"],
                      "asset_id": page["asset_id"], "sha256": actual,
                      "file": str(target.relative_to(output))})
        print(f"  页面 {ordinal}/{len(manifest['pages'])} 已核验：{target.name}")
    receipt = {
        "schema_version": SCHEMA_VERSION,
        "platform_id": manifest["platform_id"],
        "work_id": manifest["work_id"],
        "chapter_id": manifest["chapter_id"],
        "chapter_revision_id": manifest["chapter_revision_id"],
        "reading_direction": manifest["reading_direction"],
        "pages": saved,
    }
    manifest_path = output / "mangashelf_manifest.json"
    manifest_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已导入 {len(saved)} 页到 {output}（清单 {manifest_path.name}）")
    return manifest_path


def _upload(base: str, token: str, purpose: str, content_type: str, file: Path,
            idempotency_key: str) -> str:
    created = _post(base, token, "/api/v1/uploads", {
        "purpose": purpose, "expectedSizeBytes": file.stat().st_size,
        "contentType": content_type, "idempotencyKey": idempotency_key,
    })
    upload_id = created["uploadId"]
    with file.open("rb") as f:
        r = requests.put(created["presigned"]["url"], data=f,
                         headers={"Content-Type": content_type}, timeout=600)
    if r.status_code != 200:
        raise PlatformError(f"上传 {file.name} 失败：HTTP {r.status_code}")
    _post(base, token, f"/api/v1/uploads/{upload_id}/complete", {})
    deadline = time.time() + UPLOAD_POLL_SECONDS
    while time.time() < deadline:
        snap = _get(base, token, f"/api/v1/uploads/{upload_id}")
        if snap.get("assetState") == "VERIFIED":
            return snap["assetId"]
        time.sleep(2)
    raise PlatformError(f"上传 {file.name} 核验超时")


def _poll_revision(base: str, token: str, revision_id: str, expect: str) -> None:
    deadline = time.time() + VERIFY_POLL_SECONDS
    while time.time() < deadline:
        rev = _get(base, token, f"/api/v1/animation-revisions/{revision_id}")
        if rev["status"] == expect:
            return
        if rev["status"] == "FAILED":
            raise PlatformError(f"平台验证失败：{rev.get('errorCode')} {rev.get('errorMessage')}")
        time.sleep(3)
    raise PlatformError(f"等待版本 {expect} 超时")


def publish_film(base: str, token: str, title: str, origin_run_ref: str,
                 sources: list[dict], video: Path, subtitle: Path | None,
                 animation_id: str | None, requested_visibility: str) -> dict:
    """成片发布回传（协议 17.3）：草稿 → 上传 → 验证 → 发布 → 回执。"""
    draft = _post(base, token, "/api/v1/integrations/mangaweaver/publications", {
        "schema_version": SCHEMA_VERSION,
        "title": title,
        "requested_visibility": requested_visibility,
        "animation_id": animation_id,
        "origin_run_ref": origin_run_ref,
        "sources": sources,
    })
    revision_id = draft["revision_id"]
    print(f"发布草稿：animation={draft['animation_id']} revision={revision_id}"
          f" status={draft['revision_status']}")
    video_asset = _upload(base, token, "ANIMATION_VIDEO", "video/mp4", video,
                          f"mw-film-{origin_run_ref}")
    payload: dict = {"video_asset_id": video_asset}
    if subtitle is not None:
        subtitle_asset = _upload(base, token, "ANIMATION_SUBTITLE",
                                 "application/x-subrip", subtitle, f"mw-sub-{origin_run_ref}")
        payload["subtitle_asset_id"] = subtitle_asset
    _post(base, token, f"/api/v1/animation-revisions/{revision_id}/verify", payload)
    print("平台验证中（ffprobe）…")
    _poll_revision(base, token, revision_id, "READY")
    _post(base, token, f"/api/v1/animation-revisions/{revision_id}/publish", {})
    status = _get(base, token, f"/api/v1/integrations/mangaweaver/publications/{origin_run_ref}")
    receipt = {
        "schema_version": SCHEMA_VERSION,
        "origin_run_ref": origin_run_ref,
        "animation_id": status["animation_id"],
        "revision_id": status["revision_id"],
        "revision_status": status["revision_status"],
        "watch_url": status.get("watch_url"),
    }
    receipt_path = Path(f"mangashelf_receipt_{origin_run_ref}.json")
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"发布回执：animation={receipt['animation_id']} "
          f"revision={receipt['revision_id']} watch={receipt['watch_url']}")
    print(f"回执已保存：{receipt_path}")
    return receipt


def handle(args) -> int:
    """CLI 分发（协议 v1）；错误显式报出，不静默回退。"""
    if args.command == "shelf-export":
        export_pages(args.platform, args.token, args.chapter_revision_id, args.output)
        return 0
    if args.command == "shelf-publish":
        sources = []
        for item in args.source:
            rev, start, end = item.split(":")
            sources.append({"chapter_revision_id": rev, "page_start": int(start),
                            "page_end": int(end), "ordinal": len(sources) + 1})
        publish_film(args.platform, args.token, args.title, args.origin_run_ref,
                     sources, args.video, args.subtitle, args.animation_id, args.visibility)
        return 0
    raise ValueError(f"未知 shelf 命令：{args.command}")
