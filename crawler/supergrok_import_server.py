"""브라우저 클립보드의 SuperGrok JSON을 토큰 없이 가져오는 로컬 전용 화면."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json

from import_supergrok_posts import prepare_rows
from utils.supabase_client import get_supabase


PAGE = b"""<!doctype html><meta charset=utf-8><title>SuperGrok import</title>
<style>body{font:16px system-ui;max-width:800px;margin:40px auto}textarea{width:100%;height:55vh}button{font-size:18px;padding:12px 24px}pre{white-space:pre-wrap}</style>
<h1>SuperGrok JSON import</h1>
<textarea id=data placeholder='Grok response JSON'></textarea><p><button id=send>Validate and save</button></p><pre id=result></pre>
<script>send.onclick=async()=>{result.textContent='saving';const r=await fetch('/import',{method:'POST',headers:{'content-type':'application/json'},body:data.value});result.textContent=await r.text()}</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != '/import':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 1 <= length <= 2_000_000:
                raise ValueError('본문 크기 오류')
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            sb = get_supabase()
            rows, rejected = prepare_rows(payload, sb)
            if not rows:
                raise ValueError(f'통과한 글 없음 · 제외 {len(rejected)}건')
            saved = sb.table('auto_board_posts').insert(rows).execute().data or []
            if len(saved) != len(rows):
                raise RuntimeError(f'저장 건수 불일치({len(saved)}/{len(rows)})')
            response = {'saved': len(saved), 'rejected': len(rejected), 'reasons': rejected}
            status = 200
        except Exception as exc:  # noqa: BLE001
            response = {'error': str(exc)}
            status = 400
        body = json.dumps(response, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


if __name__ == '__main__':
    print('SuperGrok importer: http://127.0.0.1:8765')
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
