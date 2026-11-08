import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import requests
from dotenv import dotenv_values
from mangaweaver.config import Config
from mangaweaver.desktop_settings import handle, read


class ModelSettingsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / ".env"
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.network = patch("socket.socket.connect", side_effect=AssertionError("设置不可联网"))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.path.write_text(
            "# keep this comment\nUNRELATED=\"hello world\" # preserve this too\n"
            "MODEL_PROVIDER=huanling\nIMAGE_PROVIDER=huanling\nVIDEO_PROVIDER=minimax\n"
            "TEXT_MODEL=gemini-3.8-flash\nVIDEO_REVIEW_MODEL=gemini-3.8-flash\n"
            "IMAGE_MODEL=gpt-image-2\nMINIMAX_MODEL=MiniMax-H3-Lite\nMINIMAX_RESOLUTION=480P\n"
            "HUANLING_API_KEY='local-text-value'\nHUANLING_IMAGE_API_KEY='local-image-value'\n"
            "MINIMAX_API_KEY='local-video-value'\n"
        )

    def document(self):
        value = read(self.path)
        return {key: value[key] for key in ("revision", "services", "tasks", "preferences")}

    def request(self, command, data, **extra):
        return handle({"command": command, "env_file": str(self.path), "settings": data, **extra})

    @staticmethod
    def response(status, data, request_id=""):
        value = requests.Response()
        value.status_code = status
        value._content = (data if isinstance(data, str) else json.dumps(data)).encode()
        value.headers["Content-Type"] = "application/json"
        if request_id:
            value.headers["x-request-id"] = request_id
        return value

    def test_roundtrip_preserves_credentials_and_maps_profile_to_real_config(self):
        data = self.document()
        self.assertNotIn("local-text-value", json.dumps(data))
        clone = deepcopy(data["services"][0])
        clone["id"], clone["name"] = "huanling-secondary", "第二连接"
        clone["channels"]["text"]["api_key"] = "replacement-text-value"
        clone["channels"]["image"]["api_key"] = "replacement-image-value"
        data["services"].append(clone)
        data["tasks"]["text"]["service"] = clone["id"]
        data["tasks"]["image"]["service"] = clone["id"]
        data["preferences"]["target_duration"] = 12
        result = self.request("save_model_settings", data)
        self.assertNotIn("replacement-text-value", json.dumps(result))
        self.assertNotIn("local-video-value", json.dumps(result))
        values = dotenv_values(self.path)
        self.assertEqual(values["HUANLING_API_KEY"], "replacement-text-value")
        self.assertEqual(values["HUANLING_IMAGE_API_KEY"], "replacement-image-value")
        self.assertEqual(values["MINIMAX_API_KEY"], "local-video-value")
        self.assertEqual(Config.from_values(values).target_duration, 12)
        self.assertEqual(result["tasks"]["text"]["service"], clone["id"])
        self.assertIn('UNRELATED="hello world" # preserve this too', self.path.read_text())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        # 第二次保存未重新输入Key，不能清空已保存凭据或把Key带回客户端。
        data = self.document()
        data["services"][-1]["name"] = "第二连接改名"
        self.request("save_model_settings", data)
        self.assertEqual(dotenv_values(self.path)["HUANLING_API_KEY"], "replacement-text-value")

    def test_local_check_and_rejected_save_never_modify_file(self):
        data = self.document()
        before = self.path.read_bytes()
        self.assertIn("未调用模型", self.request("check_model_settings", data)["message"])
        self.assertEqual(self.path.read_bytes(), before)
        data["tasks"]["video"] = {"service": "huanling", "model": "MiniMax-H3-Lite"}
        service = data["services"][0]["channels"]["video"]
        service["api_key"] = "local-huanling-video"
        service["models"] = [{"id": "MiniMax-H3-Lite", "name": "H3 Lite"}]
        with self.assertRaisesRegex(ValueError, "型号不受支持"):
            self.request("save_model_settings", data)
        self.assertEqual(self.path.read_bytes(), before)

    def test_stale_revision_and_incompatible_client_combo_are_explicit(self):
        data = self.document()
        self.path.write_text(self.path.read_text() + "EXTERNAL_EDIT=1\n")
        with self.assertRaisesRegex(ValueError, "其他入口"):
            self.request("save_model_settings", data)
        data = self.document()
        kie = next(s for s in data["services"] if s["id"] == "kie")
        kie["channels"]["image"].update(api_key="test-kie-value", models=[{"id": "example", "name": "示例"}])
        data["tasks"]["image"] = {"service": "kie", "model": "example"}
        with self.assertRaisesRegex(ValueError, "组合不受"):
            self.request("save_model_settings", data)

    def test_independent_keys_and_shared_field_restrictions(self):
        data = self.document()
        data["services"][0]["channels"]["text"]["api_key"] = "only-text-changes"
        result = self.request("save_model_settings", data)
        self.assertTrue(result["services"][0]["channels"]["image"]["credential_set"])
        self.assertEqual(dotenv_values(self.path)["HUANLING_IMAGE_API_KEY"], "local-image-value")
        data = self.document()
        other = deepcopy(data["services"][0])
        other["id"] = "different-endpoint"
        other["channels"]["image"]["base_url"] = "https://example.invalid"
        other["channels"]["image"]["api_key"] = "different-image-value"
        data["services"].append(other)
        data["tasks"]["image"]["service"] = other["id"]
        with self.assertRaisesRegex(ValueError, "相同地址"):
            self.request("save_model_settings", data)

    def test_manual_test_uses_unsaved_draft_key_without_saving_or_returning_it(self):
        data = self.document()
        secret = "draft-only-secret"
        channel = data["services"][0]["channels"]["text"]
        channel["base_url"] = "https://draft.example/v1"
        channel["api_key"] = secret
        before = self.path.read_bytes()
        calls = []

        def request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            return self.response(200, {"candidates": [{"content": {"parts": [{"text": "OK"}]}}]}, "req-test")

        with patch("mangaweaver.desktop_settings.requests.request", side_effect=request):
            result = self.request("test_model_settings", data, service="huanling", kind="text",
                                  model="gemini-3.8-flash")
        self.assertTrue(result["ok"])
        self.assertFalse(result["billable_submission"])
        self.assertIn("req-test", result["message"])
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(self.path.read_bytes(), before)
        method, url, call = calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, "https://draft.example/v1beta/models/gemini-3.8-flash:generateContent")
        self.assertEqual(call["headers"]["x-goog-api-key"], secret)
        self.assertEqual(call["json"]["generationConfig"]["maxOutputTokens"], 16)

    def test_failed_test_is_redacted_and_video_submission_checks_a_real_frame(self):
        data = self.document()
        secret = "never-show-this-key"
        channel = data["services"][0]["channels"]["text"]
        channel["base_url"] = "https://draft.example"
        channel["api_key"] = secret

        def rejected(method, url, **kwargs):
            return self.response(401, {"error": {"message": f"invalid key {secret}"}})

        with patch("mangaweaver.desktop_settings.requests.request", side_effect=rejected):
            with self.assertRaises(RuntimeError) as error:
                self.request("test_model_settings", data, service="huanling", kind="text",
                             model="gemini-3.8-flash")
        self.assertNotIn(secret, str(error.exception))
        self.assertIn("[REDACTED]", str(error.exception))

        video = data["services"][0]["channels"]["video"]
        video["base_url"] = "https://draft.example"
        video["models"] = [{"id": "MiniMax-H3", "name": "MiniMax H3"}]
        video["api_key"] = "video-draft-secret"
        calls = []

        def accepted(method, url, **kwargs):
            calls.append(kwargs["json"])
            return self.response(200, {"task_id": "task-test"}, "req-video")

        with patch("mangaweaver.desktop_settings.requests.request", side_effect=accepted):
            result = self.request("test_model_settings", data, service="huanling", kind="video",
                                  model="MiniMax-H3")
        self.assertTrue(result["billable_submission"])
        self.assertIn("task-test", result["message"])
        content = calls[0]["content"]
        self.assertEqual(content[1]["role"], "first_frame")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        self.assertEqual(calls[0]["duration"], 4)
