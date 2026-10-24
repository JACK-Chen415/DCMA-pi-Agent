import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("import_knowledge", Path(__file__).with_name("import-knowledge.py"))
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportKnowledgeTest(unittest.TestCase):
    def test_pdf_continuation_variants_and_appendix_keep_their_own_context(self):
        pages = [
            "4.2 故障和报警列表\n2488 参数手册 , 06/2020, test\n"
            "F01030 控制权下的生命符号出错\n信息值： -\n驱动对象：SERVO\n原因：未收到生命符号。",
            "4.2 故障和报警列表\n参数手册 , 06/2020, test 2489\n处理：检查通讯。\n注意：保留注意事项。\n"
            "F01030 另一个驱动对象的定义\n信息值： -\n驱动对象：VECTOR\n处理：另一个处理。\n"
            "A05000 过热\n信息值： -\n处理：检查散热。",
            "附录\n参数手册 , 06/2020, test 2490\n这里不是过热的处理步骤。",
        ]
        entries, count, unique = importer.pdf_entries(pages, "fixture.pdf")
        self.assertEqual((count, unique), (3, 2))
        self.assertIn("PDF第1-2页；原书第2488-2489页", entries[0]["source"]["locator"])
        self.assertEqual(entries[0]["codes"][0]["steps"], ["检查通讯。\n注意：保留注意事项。"])
        self.assertIn("VECTOR", entries[1]["text"])
        self.assertEqual(entries[2]["codes"][0]["kind"], "alarm")
        self.assertNotIn("附录", entries[2]["text"])
        self.assertIn("这里不是", entries[3]["text"])
        self.assertEqual(len({item["id"] for item in entries}), 4)
        importer.validate(entries)

    def test_docx_sections_preserve_table_paragraphs_and_case_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.docx"
            with ZipFile(path, "w") as archive:
                archive.writestr("word/document.xml", '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>测试方案</w:t></w:r></w:p>
<w:p><w:r><w:t>2.1 故障现象</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>电流</w:t></w:r><w:r><w:t>偏高</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>''')
            entries = importer.docx_entries(path, "Synthetic", "M1", "原文未标注版本", "case")
            self.assertEqual(len(entries), 2)
            self.assertIn("电流偏高", entries[1]["text"])
            self.assertIn("章节：2.1 故障现象", entries[1]["source"]["locator"])
            self.assertEqual(entries[1]["kind"], "case")

    def test_oversized_sections_are_rejected_instead_of_silently_truncated(self):
        entries, _, _ = importer.pdf_entries([
            "4.2 故障和报警列表\nF01030 测试\n信息值： -\n" + "测试" * 11000,
        ], "fixture.pdf")
        with self.assertRaisesRegex(ValueError, "oversized"):
            importer.validate(entries)

    def test_only_explicit_configurable_fault_alarm_types_are_indexed(self):
        entries, _, _ = importer.pdf_entries([
            "4.2 故障和报警列表\nN01004 (F, A) 内部软件错误\n信息值： -\n处理：检查配置。\n"
            "C01711 安全监控通道故障\n信息值： -\n处理：检查监控。",
        ], "fixture.pdf")
        self.assertEqual({item["code"] for item in entries[0]["codes"]}, {"F01004", "A01004"})
        self.assertTrue(all("N01004 (F, A)" in item["meaning"] for item in entries[0]["codes"]))
        self.assertNotIn("codes", entries[1])


if __name__ == "__main__":
    unittest.main()
