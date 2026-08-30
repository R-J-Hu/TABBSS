import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import updater


def write_index(path: Path, companies):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": "V1.6.1", "companies": companies}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def line(company, name):
    return {"name": name, "file": f"{company}/{name}.ini"}


class InstallerDataMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tabbss-migration-"))
        self.app = self.tmp / "app"
        self.data = self.app / "报站线路文件库"
        self.app.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_correct_upgrade_preserves_custom_data_and_adds_release_data(self):
        custom = self.data / "自有公司"
        custom.mkdir(parents=True)
        (custom / "自有线路.ini").write_text("user-route", encoding="utf-8")
        (custom / "自有音频.mp3").write_bytes(b"user-audio")
        builtin = self.data / "内置公司"
        builtin.mkdir()
        (builtin / "同名线路.ini").write_text("user-edited", encoding="utf-8")
        (builtin / "共享音频.mp3").write_bytes(b"user-edited-audio")
        write_index(self.data / "index.json", [
            {"name": "自有公司", "lines": [line("自有公司", "自有线路")]},
            {"name": "内置公司", "lines": [line("内置公司", "同名线路")]},
        ])

        payload = self.app / ".install_payload" / "报站线路文件库"
        (payload / "内置公司").mkdir(parents=True)
        (payload / "内置公司" / "同名线路.ini").write_text("release-version", encoding="utf-8")
        (payload / "内置公司" / "共享音频.mp3").write_bytes(b"release-audio")
        (payload / "内置公司" / "新增线路.ini").write_text("new-route", encoding="utf-8")
        (payload / "内置公司" / "新增站点.mp3").write_bytes(b"station-audio")
        write_index(payload / "index.json", [
            {"name": "内置公司", "lines": [line("内置公司", "同名线路"), line("内置公司", "新增线路")]},
        ])

        result = updater.merge_update_lines(self.app, self.data)

        self.assertEqual((custom / "自有线路.ini").read_text(encoding="utf-8"), "user-route")
        self.assertEqual((custom / "自有音频.mp3").read_bytes(), b"user-audio")
        self.assertEqual((builtin / "同名线路.ini").read_text(encoding="utf-8"), "user-edited")
        self.assertEqual((builtin / "共享音频.mp3").read_bytes(), b"user-edited-audio")
        self.assertEqual((builtin / "新增站点.mp3").read_bytes(), b"station-audio")
        files = {l["file"] for c in json.loads((self.data / "index.json").read_text(encoding="utf-8"))["companies"] for l in c["lines"]}
        self.assertEqual(files, {"自有公司/自有线路.ini", "内置公司/同名线路.ini", "内置公司/新增线路.ini"})
        self.assertTrue(result["removed_staging"])
        self.assertFalse((self.app / ".install_payload").exists())

    def test_legacy_staging_rescues_unreferenced_implicit_station_audio(self):
        staging = self.app / ".update_package" / "报站线路文件库" / "厦门BRT普通公交（地铁AI版）"
        staging.mkdir(parents=True)
        (staging / "公交机场专线.ini").write_text('到站规则={本站}>"到站.mp3"', encoding="utf-8")
        (staging / "BRT第一码头站.mp3").write_bytes(b"implicit-station")
        (staging / "到站.mp3").write_bytes(b"explicit-audio")
        write_index(staging.parent / "index.json", [{
            "name": "厦门BRT普通公交（地铁AI版）",
            "lines": [line("厦门BRT普通公交（地铁AI版）", "公交机场专线")],
        }])

        updater.merge_update_lines(self.app, self.data)

        installed = self.data / "厦门BRT普通公交（地铁AI版）"
        self.assertEqual((installed / "BRT第一码头站.mp3").read_bytes(), b"implicit-station")
        self.assertEqual((installed / "到站.mp3").read_bytes(), b"explicit-audio")
        self.assertFalse((self.app / ".update_package").exists())

    def test_damaged_index_is_backed_up_and_all_disk_routes_are_recovered(self):
        company = self.data / "幸存公司"
        company.mkdir(parents=True)
        (company / "线路甲.ini").write_text("survived", encoding="utf-8")
        (self.data / "index.json").write_text("{broken", encoding="utf-8")
        payload = self.app / ".install_payload" / "报站线路文件库"
        write_index(payload / "index.json", [])

        result = updater.merge_update_lines(self.app, self.data)

        self.assertFalse(result["existing_index_valid"])
        self.assertIn("幸存公司/线路甲.ini", result["recovered_lines"])
        self.assertTrue(result["index_backup"])
        self.assertEqual((self.data / result["index_backup"]).read_text(encoding="utf-8"), "{broken")

    def test_valid_but_empty_index_from_external_overwrite_recovers_disk_routes(self):
        company = self.data / "自有幸存公司"
        company.mkdir(parents=True)
        (company / "自有幸存线路.ini").write_text("survived", encoding="utf-8")
        write_index(self.data / "index.json", [])
        payload = self.app / ".install_payload" / "报站线路文件库"
        write_index(payload / "index.json", [])

        result = updater.merge_update_lines(self.app, self.data)

        self.assertTrue(result["existing_index_valid"])
        self.assertIn("自有幸存公司/自有幸存线路.ini", result["recovered_lines"])
        installed = json.loads((self.data / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(installed["companies"][0]["lines"][0]["file"], "自有幸存公司/自有幸存线路.ini")

    def test_real_brt_payload_installs_every_station_audio_file(self):
        release_data = Path(__file__).resolve().parent.parent / "Setup_output" / "build_release" / "报站线路文件库"
        if not release_data.exists():
            self.skipTest("release payload is not available")
        shutil.copytree(release_data, self.app / ".install_payload" / "报站线路文件库")
        source_brt = release_data / "厦门BRT普通公交（地铁AI版）"

        updater.merge_update_lines(self.app, self.data)

        installed_brt = self.data / source_brt.name
        source_files = {p.name: p.stat().st_size for p in source_brt.iterdir() if p.is_file()}
        installed_files = {p.name: p.stat().st_size for p in installed_brt.iterdir() if p.is_file()}
        self.assertEqual(installed_files, source_files)
        self.assertIn("BRT第一码头站.mp3", installed_files)
        self.assertIn("BRT双十中学站.mp3", installed_files)

    def test_repeat_upgrade_is_idempotent_and_preserves_existing_bytes(self):
        payload_src = self.tmp / "payload-src"
        company = payload_src / "报站线路文件库" / "公司"
        company.mkdir(parents=True)
        (company / "线路.ini").write_text("first", encoding="utf-8")
        write_index(company.parent / "index.json", [{"name": "公司", "lines": [line("公司", "线路")]}])
        shutil.copytree(payload_src, self.app / ".install_payload")
        updater.merge_update_lines(self.app, self.data)
        (self.data / "公司" / "线路.ini").write_text("user-change", encoding="utf-8")
        shutil.copytree(payload_src, self.app / ".install_payload")

        updater.merge_update_lines(self.app, self.data)

        self.assertEqual((self.data / "公司" / "线路.ini").read_text(encoding="utf-8"), "user-change")
        self.assertFalse((self.app / ".install_payload").exists())

    def test_later_release_updates_only_unchanged_managed_files(self):
        def stage(contents: str):
            payload = self.app / ".install_payload" / "报站线路文件库" / "官方公司"
            payload.mkdir(parents=True)
            (payload / "官方线路.ini").write_text(contents, encoding="utf-8")
            write_index(payload.parent / "index.json", [{
                "name": "官方公司", "lines": [line("官方公司", "官方线路")],
            }])

        stage("release-v1")
        updater.merge_update_lines(self.app, self.data)
        stage("release-v2")
        result = updater.merge_update_lines(self.app, self.data)
        installed = self.data / "官方公司" / "官方线路.ini"
        self.assertEqual(installed.read_text(encoding="utf-8"), "release-v2")
        self.assertIn("官方公司/官方线路.ini", result["updated_files"])

        installed.write_text("user-edited", encoding="utf-8")
        stage("release-v3")
        result = updater.merge_update_lines(self.app, self.data)
        self.assertEqual(installed.read_text(encoding="utf-8"), "user-edited")
        self.assertNotIn("官方公司/官方线路.ini", result["updated_files"])

    def test_unverified_unknown_staging_content_is_never_deleted(self):
        staging = self.app / ".update_package"
        staging.mkdir()
        (staging / "unknown-user-file.ini").write_text("must-survive", encoding="utf-8")

        with self.assertRaises(RuntimeError):
            updater.merge_update_lines(self.app, self.data)

        self.assertEqual((staging / "unknown-user-file.ini").read_text(encoding="utf-8"), "must-survive")

    def test_fresh_install_without_output_does_not_create_output(self):
        payload = self.app / ".install_payload"
        write_index(payload / "报站线路文件库" / "index.json", [])
        route = payload / "兼容模式-海峡报站器文件库" / "新装海峡线路"
        route.mkdir(parents=True)
        (route / "线路信息.ini").write_text("[线路]\n线路名=新装海峡线路", encoding="utf-8")

        result = updater.merge_update_lines(self.app, self.data)

        self.assertFalse((self.app / "output").exists())
        self.assertEqual(result["migrated_compat_files"], [])
        self.assertTrue((self.app / "兼容模式-海峡报站器文件库" / "新装海峡线路" / "线路信息.ini").is_file())

    def test_upgrade_preserves_output_and_recovers_original_haixia_files(self):
        legacy_route = self.app / "output" / "packages" / "旧海峡线路"
        legacy_audio = legacy_route / "audio"
        legacy_audio.mkdir(parents=True)
        (legacy_route / "线路信息.ini").write_text("[线路]\n线路名=旧海峡线路", encoding="utf-8")
        (legacy_route / "converted.route.json").write_text('{"legacy":true}', encoding="utf-8")
        (legacy_audio / "甲站.mp3").write_bytes(b"legacy-audio")
        output_index = self.app / "output" / "index.json"
        output_index.write_text('[{"id":"旧海峡线路"}]', encoding="utf-8")

        existing = self.app / "兼容模式-海峡报站器文件库" / "旧海峡线路"
        existing.mkdir(parents=True)
        (existing / "用户文件.txt").write_text("keep", encoding="utf-8")

        payload = self.app / ".install_payload"
        write_index(payload / "报站线路文件库" / "index.json", [])

        result = updater.merge_update_lines(self.app, self.data)

        self.assertEqual(output_index.read_text(encoding="utf-8"), '[{"id":"旧海峡线路"}]')
        self.assertEqual((legacy_route / "converted.route.json").read_text(encoding="utf-8"), '{"legacy":true}')
        self.assertEqual((existing / "用户文件.txt").read_text(encoding="utf-8"), "keep")
        self.assertTrue((existing / "线路信息.ini").is_file())
        self.assertEqual((existing / "甲站.mp3").read_bytes(), b"legacy-audio")
        self.assertIn("兼容模式-海峡报站器文件库/旧海峡线路/线路信息.ini", result["migrated_compat_files"])
        self.assertIn("兼容模式-海峡报站器文件库/旧海峡线路/甲站.mp3", result["migrated_compat_files"])

    def test_output_recovery_never_overwrites_existing_compat_files(self):
        legacy_route = self.app / "output" / "packages" / "用户已导入线路"
        legacy_audio = legacy_route / "audio"
        legacy_audio.mkdir(parents=True)
        (legacy_route / "线路信息.ini").write_text("legacy-ini", encoding="utf-8")
        (legacy_audio / "同名.mp3").write_bytes(b"legacy-audio")
        target = self.app / "兼容模式-海峡报站器文件库" / "用户已导入线路"
        target.mkdir(parents=True)
        (target / "线路信息.ini").write_text("user-ini", encoding="utf-8")
        (target / "同名.mp3").write_bytes(b"user-audio")
        payload = self.app / ".install_payload"
        write_index(payload / "报站线路文件库" / "index.json", [])

        updater.merge_update_lines(self.app, self.data)

        self.assertEqual((target / "线路信息.ini").read_text(encoding="utf-8"), "user-ini")
        self.assertEqual((target / "同名.mp3").read_bytes(), b"user-audio")


class InstallerTemplateSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = (Path(__file__).resolve().parent / "installer" / "installer.nsi.template").read_text(encoding="utf-8")

    def test_required_section_only_stages_data_and_never_deletes_legacy_payload(self):
        required = self.template.split('Section "!档案库报站模拟器 (必需)"', 1)[1].split("SectionEnd", 1)[0]
        self.assertIn('$INSTDIR\\.install_payload\\报站线路文件库', required)
        self.assertIn('--merge-update-only', required)
        self.assertNotIn('SetOutPath "$INSTDIR\\报站线路文件库"', required)
        self.assertNotIn('RMDir /r "$INSTDIR\\.update_package"', required)

    def test_output_is_installed_and_created_only_for_upgrade(self):
        required = self.template.split('Section "!档案库报站模拟器 (必需)"', 1)[1].split("SectionEnd", 1)[0]
        output_payload = required.index('SetOutPath "$INSTDIR\\.install_payload\\output"')
        output_create = required.index('CreateDirectory "$INSTDIR\\output"')
        before_payload = required[:output_payload]
        before_create = required[:output_create]
        self.assertGreater(before_payload.rfind('${If} $UpgradeMode == "1"'), before_payload.rfind('${EndIf}'))
        self.assertGreater(before_create.rfind('${If} $UpgradeMode == "1"'), before_create.rfind('${EndIf}'))

    def test_program_only_uninstall_preserves_unfinished_staging(self):
        program = self.template.split('Section "un.程序文件"', 1)[1].split("SectionEnd", 1)[0]
        user_data = self.template.split('Section /o "un.用户数据', 1)[1].split("SectionEnd", 1)[0]
        self.assertNotIn('RMDir /r "$INSTDIR\\.update_package"', program)
        self.assertNotIn('RMDir /r "$INSTDIR\\.install_payload"', program)
        self.assertIn('RMDir /r "$INSTDIR\\.update_package"', user_data)
        self.assertIn('RMDir /r "$INSTDIR\\.install_payload"', user_data)


if __name__ == "__main__":
    unittest.main()
