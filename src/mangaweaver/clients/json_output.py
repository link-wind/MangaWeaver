"""移除模型输出的展示包装，业务字段仍由原 Schema 严格校验。"""
import re


def parse_json(text, schema):
    text = text.strip()
    if not text.startswith(('{', '[')):
        blocks = [body for language, body in re.findall(r'```([^\r\n`]*)\r?\n(.*?)\r?\n[ \t]*```', text, re.DOTALL)
                  if language.strip().lower() in {'', 'json'}]
        if len(blocks) > 1:
            raise ValueError('响应包含多个 JSON 代码块，无法确定唯一结果；原始响应已保留')
        if blocks:
            text = blocks[0]
    return schema.model_validate_json(text)
