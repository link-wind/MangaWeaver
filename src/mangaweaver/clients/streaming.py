"""SSE 传输与公开 JSON 字符串读取；部分动作永不执行。"""
import json
import subprocess


class StreamHTTPError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f'流式接口 HTTP {status}，未自动切换模型或接口')


class StreamTransportError(RuntimeError):
    def __init__(self, code, received_headers=False):
        self.code = code
        reason = {5:'代理地址解析失败', 6:'服务器地址解析失败', 7:'无法连接服务器',
                  18:'响应数据不完整', 28:'连接或响应超时', 35:'TLS 连接失败', 52:'服务器未返回响应',
                  55:'发送失败', 56:'接收连接中断', 60:'TLS 证书校验失败'}.get(code, '连接失败')
        phase = '响应流未完整接收' if received_headers else '未收到完整的 HTTP 响应头'
        # 不直接展示 stderr，避免带出请求 URL、代理凭据等信息。
        super().__init__(f'流式{reason}（curl {code}），{phase}；未自动切换模型或接口')


def sse_events(lines):
    data = []
    for line in lines:
        line = line.rstrip('\r\n')
        if not line:
            if data:
                value = '\n'.join(data)
                data.clear()
                if value == '[DONE]':
                    return
                yield json.loads(value)
        elif line.startswith('data:'):
            data.append(line[5:].lstrip(' '))
    if data:
        raise ValueError('响应流在事件结束前中断')


def curl_events(url, body, headers, timeout=180):
    settings = 'url = ' + json.dumps(url) + '\n'
    for key, value in headers.items():
        settings += 'header = ' + json.dumps(key + ': ' + value) + '\n'
    settings += 'data = ' + json.dumps(json.dumps(body, ensure_ascii=False), ensure_ascii=False) + '\n'
    child = subprocess.Popen(['curl', '--silent', '--show-error', '--no-buffer', '--include',
                              '--max-time', str(timeout), '--config', '-'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, encoding='utf-8')
    try:
        child.stdin.write(settings)
        child.stdin.close()
        # curl 可能先输出代理 CONNECT 或 100 Continue 的头。
        status = 0
        content_type = ''
        tunnel = False
        received_headers = False
        for line in child.stdout:
            if line.startswith('HTTP/'):
                status = int(line.split()[1])
                content_type = ''
                tunnel = status == 200 and 'connection established' in line.lower()
            elif line.lower().startswith('content-type:'):
                content_type = line.split(':', 1)[1].strip().lower()
            elif not line.strip() and status:
                if tunnel or 100 <= status < 200:
                    status = 0
                    content_type = ''
                    continue
                received_headers = True
                break
        if not received_headers:
            code = child.wait(timeout=2)
            if code:
                raise StreamTransportError(code)
            raise ValueError('流式连接未收到完整的 HTTP 响应头；未自动切换模型或接口')
        if not 200 <= status < 300:
            raise StreamHTTPError(status)
        if 'text/event-stream' not in content_type:
            raise ValueError('当前接口未返回 SSE 流；未改用非流式响应')

        def response_lines():
            yield from child.stdout
            code = child.wait(timeout=2)
            if code:
                raise StreamTransportError(code, received_headers=True)

        yield from sse_events(response_lines())
    finally:
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        child.stdout.close()
        child.stderr.close()


def request_events(url, body, headers, timeout=180):
    import requests
    with requests.post(url, headers=headers, json=body, timeout=(30, timeout), stream=True) as response:
        if not response.ok:
            raise StreamHTTPError(response.status_code)
        if 'text/event-stream' not in response.headers.get('Content-Type', '').lower():
            raise ValueError('当前接口未返回 SSE 流；未改用非流式响应')
        response.encoding = 'utf-8'
        yield from sse_events(response.iter_lines(chunk_size=1, decode_unicode=True))


class PublicText:
    """仅解析顶层 text 字符串。转义未闭合时等待，不猜测字段与参数。"""
    def __init__(self, field='text'):
        self.raw = ''
        self.text = ''
        self.field = field

    def feed(self, delta):
        self.raw += delta
        raw = self.raw.lstrip()
        if not raw.startswith('{'):
            return ''
        decoder = json.JSONDecoder()
        pos = 1
        while pos < len(raw):
            pos += len(raw[pos:]) - len(raw[pos:].lstrip())
            try:
                key, end = decoder.raw_decode(raw, pos)
            except ValueError:
                return ''
            pos = end
            pos += len(raw[pos:]) - len(raw[pos:].lstrip())
            if pos >= len(raw) or raw[pos] != ':':
                return ''
            pos += 1
            pos += len(raw[pos:]) - len(raw[pos:].lstrip())
            if key == self.field:
                if pos >= len(raw) or raw[pos] != '"':
                    return ''
                start = pos + 1
                end = start
                while end < len(raw):
                    char = raw[end]
                    if char == '"':
                        break
                    if char == '\\':
                        width = 6 if raw[end:end+2] == '\\u' else 2
                        if end + width > len(raw):
                            break
                        end += width
                    else:
                        end += 1
                try:
                    value = json.loads('"' + raw[start:end] + '"')
                except ValueError:
                    return ''
                # 不发出未配对的 UTF-16 代理字符。
                if value and 0xD800 <= ord(value[-1]) <= 0xDBFF:
                    value = value[:-1]
                addition = value[len(self.text):]
                self.text = value
                return addition
            try:
                _, pos = decoder.raw_decode(raw, pos)
            except ValueError:
                return ''
            pos += len(raw[pos:]) - len(raw[pos:].lstrip())
            if pos >= len(raw) or raw[pos] != ',':
                return ''
            pos += 1
        return ''
