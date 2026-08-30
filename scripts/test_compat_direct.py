#!/usr/bin/env python3
"""Regression tests for direct Haixia compatibility-mode discovery."""

import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from local_server import create_server


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def write_route(route_dir: Path, name: str, stations=("甲站", "乙站")) -> None:
    route_dir.mkdir(parents=True, exist_ok=True)
    (route_dir / "线路信息.ini").write_text(
        "\n".join([
            "[线路]",
            f"线路名={name}",
            "所属公司=测试公司",
            "[上行]",
            f"上行车站={'|'.join(stations)}",
            "上行特殊服务语=",
            "[下行]",
            f"下行车站={'|'.join(reversed(stations))}",
            "下行特殊服务语=",
            "[报站器提示语]",
            "提示语1=",
            "[报站器到站设置]",
            "前奏=",
            "到站报站1=",
            "[报站器出站设置]",
            "前奏=",
            "出站报站1=",
            "[报站器终点设置]",
            "前奏=",
            "终点报站1=",
        ]),
        encoding="utf-8",
    )
    (route_dir / "甲站.mp3").write_bytes(b"ID3-test-audio")


class CompatDirectApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="tabbss-compat-")
        self.install_root = Path(self.temp.name)
        self.data_root = self.install_root / "报站线路文件库"
        self.compat_root = self.install_root / "兼容模式-海峡报站器文件库"
        self.data_root.mkdir()
        self.compat_root.mkdir()
        self.httpd = create_server("127.0.0.1", 0, PROJECT_ROOT, self.data_root)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def get_json(self, path: str):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_empty_library_does_not_require_output(self):
        self.assertFalse((self.install_root / "output" / "index.json").exists())
        status, payload = self.get_json("/api/compat/index")
        self.assertEqual(status, 200)
        self.assertEqual(payload["routes"], [])
        self.assertEqual(payload["source"], "direct")

    def test_newly_copied_route_appears_without_conversion_or_restart(self):
        _, before = self.get_json("/api/compat/index")
        self.assertEqual(before["routes"], [])
        write_route(self.compat_root / "运行中新增线路", "运行中新增线路")
        _, after = self.get_json("/api/compat/index")
        self.assertEqual([route["id"] for route in after["routes"]], ["运行中新增线路"])
        self.assertEqual(after["routes"][0]["source"], "direct")

        query = urllib.parse.urlencode({"id": "运行中新增线路"})
        _, route = self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(route["id"], "运行中新增线路")
        self.assertEqual(route["name"], "运行中新增线路")
        self.assertEqual(route["directions"]["up"]["stations"], ["甲站", "乙站"])
        self.assertEqual(route["station_audio_map"]["甲站"], "甲站.mp3")

    def test_nested_duplicate_leaf_names_keep_unique_ids(self):
        write_route(self.compat_root / "甲公司" / "同名线路", "甲线")
        write_route(self.compat_root / "乙公司" / "同名线路", "乙线")
        _, payload = self.get_json("/api/compat/index")
        ids = {route["id"] for route in payload["routes"]}
        self.assertEqual(ids, {"甲公司/同名线路", "乙公司/同名线路"})

        query = urllib.parse.urlencode({"id": "乙公司/同名线路"})
        _, route = self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(route["id"], "乙公司/同名线路")
        self.assertEqual(route["name"], "乙线")

    def test_invalid_folder_is_ignored_and_traversal_is_rejected(self):
        (self.compat_root / "无线路信息").mkdir()
        _, payload = self.get_json("/api/compat/index")
        self.assertEqual(payload["routes"], [])

        query = urllib.parse.urlencode({"id": "../报站线路文件库"})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(caught.exception.code, 400)
        caught.exception.close()

    def test_ini_playback_is_not_prefixed_by_inferred_welcome_audio(self):
        route_dir = self.compat_root / "严格按INI播放"
        write_route(route_dir, "严格按INI播放")
        ini_path = route_dir / "线路信息.ini"
        text = ini_path.read_text(encoding="utf-8")
        text = text.replace("提示语1=", "提示语1=共享欢迎语.mp3")
        text = text.replace("出站报站1=", "出站报站1=普通预报.mp3")
        ini_path.write_text(text, encoding="utf-8")
        (route_dir / "共享欢迎语.mp3").write_bytes(b"welcome")
        (route_dir / "K1欢迎语.mp3").write_bytes(b"welcome-k1")
        (route_dir / "普通预报.mp3").write_bytes(b"forecast")

        query = urllib.parse.urlencode({"id": route_dir.name})
        _, route = self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(route["templates"]["depart"], ["普通预报.mp3"])
        self.assertEqual(route["first_departure_forecast"], {"shared": [], "up": [], "down": []})

    def test_repeated_concurrent_selection_is_consistent_and_cache_invalidates(self):
        route_dir = self.compat_root / "快速切换线路"
        write_route(route_dir, "快速切换线路")
        query = urllib.parse.urlencode({"id": route_dir.name})

        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(lambda _: self.get_json(f"/api/compat/route?{query}")[1], range(36)))
        self.assertTrue(all(r["name"] == "快速切换线路" for r in results))
        self.assertTrue(all(r["directions"]["up"]["stations"] == ["甲站", "乙站"] for r in results))

        ini_path = route_dir / "线路信息.ini"
        ini_path.write_text(ini_path.read_text(encoding="utf-8").replace("快速切换线路", "缓存已刷新"), encoding="utf-8")
        _, refreshed = self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(refreshed["name"], "缓存已刷新")

        (route_dir / "乙站.wav").write_bytes(b"RIFF-new-audio")
        _, refreshed_audio = self.get_json(f"/api/compat/route?{query}")
        self.assertEqual(refreshed_audio["station_audio_map"]["乙站"], "乙站.wav")


if __name__ == "__main__":
    unittest.main(verbosity=2)
