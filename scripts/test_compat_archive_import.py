#!/usr/bin/env python3
"""Regression tests for the developer-only Haixia-to-archive importer."""

import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from local_server import create_server


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class CompatArchiveImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tabbss-compat-import-")
        self.root = Path(self.temp.name)
        self.data_root = self.root / "报站线路文件库"
        self.compat_root = self.root / "兼容模式-海峡报站器文件库"
        (self.root / "scripts").mkdir(parents=True)
        (self.root / "web").mkdir(parents=True)
        self.data_root.mkdir()
        self.compat_root.mkdir()
        shutil.copy2(PROJECT_ROOT / "scripts" / "convert_ini.py", self.root / "scripts" / "convert_ini.py")
        (self.data_root / "index.json").write_text(
            json.dumps({"version": "V1.6.1", "companies": []}, ensure_ascii=False),
            encoding="utf-8",
        )
        self.set_feature(False)
        self.httpd = create_server("127.0.0.1", 0, self.root, self.data_root)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def set_feature(self, enabled: bool):
        (self.root / "web" / "funct.json").write_text(
            json.dumps({
                "edition": "dev",
                "show_dev_panel": True,
                "allow_compat_import_archive": enabled,
            }, ensure_ascii=False),
            encoding="utf-8",
        )

    def post_json(self, path: str, payload: dict):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            payload = json.loads(exc.read().decode("utf-8"))
            status = exc.code
            exc.close()
            return status, payload

    def write_route(self):
        route = self.compat_root / "测试海峡线路"
        route.mkdir()
        (route / "线路信息.ini").write_text("\n".join([
            "[线路]",
            "线路名=测试海峡线路",
            "所属公司=来源公司",
            "编写者=测试",
            "[上行]",
            "上行车站=甲站|乙站",
            "上行车站英文=Alpha|Beta",
            "上行特殊服务语=乙站→换乘+提示.mp3",
            "[下行]",
            "下行车站=乙站|甲站",
            "下行车站英文=Beta|Alpha",
            "下行特殊服务语=",
            "[报站器提示语]",
            "提示语1=服务语.mp3",
            "提示语2=",
            "[报站器到站设置]",
            "前奏=叮咚.mp3",
            "到站报站1=【本站】",
            "到站报站2=【英文本站】",
            "到站报站3=到站+提示.mp3",
            "到站报站4=【特殊语句】",
            "[报站器出站设置]",
            "前奏=下一站.mp3",
            "出站报站1=【下站】",
            "出站报站2=【英文下站】",
            "[报站器终点设置]",
            "前奏=叮咚.mp3",
            "终点报站1=【本站】",
            "终点报站2=【终点】",
            "终点报站3=终点.mp3",
        ]), encoding="utf-8")
        for name in (
            "甲站.mp3", "乙站.mp3", "叮咚.mp3", "到站+提示.mp3",
            "换乘+提示.mp3", "下一站.mp3", "终点.mp3", "服务语.mp3",
        ):
            (route / name).write_bytes(("audio:" + name).encode("utf-8"))
        return route

    def test_feature_is_denied_when_disabled(self):
        self.write_route()
        status, payload = self.post_json(
            "/api/file/import_compat_preview", {"routeId": "测试海峡线路"}
        )
        self.assertEqual(status, 403)
        self.assertFalse(payload["ok"])
        self.assertEqual(list(self.data_root.glob("*/**/*.ini")), [])

    def test_preview_and_confirm_reuse_import_flow_without_overwrite(self):
        route = self.write_route()
        source_snapshot = {p.name: p.read_bytes() for p in route.iterdir() if p.is_file()}
        self.set_feature(True)

        status, preview = self.post_json(
            "/api/file/import_compat_preview", {"routeId": "测试海峡线路"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(preview["compatArchiveImport"])
        self.assertEqual(preview["mediaCount"], 8)
        self.assertEqual(preview["warnings"], [])

        status, result = self.post_json("/api/file/import", {
            "sessionId": preview["sessionId"],
            "company": "新建目标公司",
            "conflictMode": "skip",
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["imported"], ["新建目标公司/测试海峡线路.ini"])
        target = self.data_root / "新建目标公司"
        ini = (target / "测试海峡线路.ini").read_text(encoding="utf-8")
        self.assertIn("环线模式=false", ini)
        self.assertIn("上行首站预报规则=", ini)
        self.assertIn("{下站中文}>{下站英文}", ini)
        self.assertIn("{本站中文}>{本站英文}", ini)
        self.assertIn("{本站中文}>{终点站中文}", ini)
        self.assertIn("预报规则={默认模版}", ini)
        self.assertIn("到站+提示.mp3", "\n".join(p.name for p in target.iterdir()))
        self.assertNotIn('"到站">"提示.mp3"', ini)
        self.assertTrue(all(p.name.startswith("HX") for p in target.iterdir() if p.suffix.lower() == ".mp3"))
        self.assertFalse((target / "叮咚.mp3").exists())

        index = json.loads((self.data_root / "index.json").read_text(encoding="utf-8"))
        company = next(c for c in index["companies"] if c["name"] == "新建目标公司")
        self.assertEqual(company["lines"], [{"name": "测试海峡线路", "file": "新建目标公司/测试海峡线路.ini"}])
        self.assertEqual(source_snapshot, {p.name: p.read_bytes() for p in route.iterdir() if p.is_file()})

        _, preview2 = self.post_json(
            "/api/file/import_compat_preview", {"routeId": "测试海峡线路"}
        )
        status, conflict = self.post_json("/api/file/import", {
            "sessionId": preview2["sessionId"],
            "company": "新建目标公司",
            "conflictMode": "overwrite",
        })
        self.assertEqual(status, 409)
        self.assertIn("目标线路已存在", conflict["error"])
        self.assertEqual(source_snapshot, {p.name: p.read_bytes() for p in route.iterdir() if p.is_file()})

    def test_release_edition_cannot_enable_writer(self):
        self.write_route()
        (self.root / "web" / "funct.json").write_text(
            json.dumps({"edition": "release", "allow_compat_import_archive": True}),
            encoding="utf-8",
        )
        status, payload = self.post_json(
            "/api/file/import_compat_preview", {"routeId": "测试海峡线路"}
        )
        self.assertEqual(status, 403)
        self.assertFalse(payload["ok"])

        status, payload = self.post_json(
            "/api/dev/funct", {"values": {"allow_compat_import_archive": True}}
        )
        self.assertEqual(status, 403)
        self.assertFalse(payload["ok"])

    def test_dev_switch_persists_only_allowed_boolean_features(self):
        status, payload = self.post_json(
            "/api/dev/funct", {"values": {"allow_compat_import_archive": True}}
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["values"]["allow_compat_import_archive"])
        saved = json.loads((self.root / "web" / "funct.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["edition"], "dev")
        self.assertTrue(saved["allow_compat_import_archive"])
        self.assertFalse((self.data_root / "web" / "funct.json").exists())

        status, payload = self.post_json(
            "/api/dev/funct", {"values": {"allow_compat_import_archive": "yes"}}
        )
        self.assertEqual(status, 400)
        self.assertFalse(payload["ok"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
