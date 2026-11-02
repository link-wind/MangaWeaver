"""只检查输出包装兼容，不修补业务内容或模拟模型通过审查。"""
import unittest
from pydantic import ValidationError
from mangaweaver.clients.json_output import parse_json
from mangaweaver.schemas import CharacterList


class JsonOutputTest(unittest.TestCase):
    def test_unique_fenced_result_after_analysis(self):
        body='{"characters":[{"character_id":"C1","description":"黑发少年"}]}'
        for text in [body, f'```json\n{body}\n```', f'**Analyzing Character Details**\n分析文字。\n```json\n{body}\n```\n']:
            self.assertEqual(parse_json(text,CharacterList).characters[0].character_id,'C1')
        with self.assertRaisesRegex(ValueError,'多个 JSON'):
            parse_json(f'```json\n{body}\n```\n```json\n{body}\n```',CharacterList)
        for invalid in ['分析文字\n```json\n{"characters": [', '分析文字\n```json\n{"characters": []}\n```', '分析文字\n```json\n{"characters": [{"name":"C1"}]}\n```']:
            with self.assertRaises(ValidationError):parse_json(invalid,CharacterList)
