"""Check the isolated CPU staging Worker; save summaries without credentials or provider payloads."""
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ORIGIN = 'https://open-connector-cpu-staging-20261023.yishai-k.workers.dev'
REPORT = Path('verification/perf-staging-probe.json')


def verify(name, status, value):
    assert status == 200, f'{name}: HTTP {status}'
    if name.startswith('initialize-'):
        assert value['result']['protocolVersion'] == '2025-03-26'
    elif name.startswith('tools/list-'):
        assert {t['name'] for t in value['result']['tools']} == {
            'list_apps', 'list_connections', 'search_actions', 'get_action_guide', 'execute_action'
        }
    elif not name.startswith('/'):
        result = json.loads(next(c['text'] for c in value['result']['content'] if c['type'] == 'text'))
        if name.startswith('execute_action-'):
            assert result['ok'] is False and result['error']['code'] == 'invalid_input'
        else:
            assert result['ok'] is True, f'{name}: tool failure'
        if name.startswith('get_action_guide-'):
            assert 'hackernews.get_item' in result['data']['markdown']
        if name.startswith('search_actions-'):
            assert any(a['id'] == 'hackernews.get_item' for a in result['data'])
    elif name == '/api/providers':
        assert len(value) == 1650
        assert all('inputSchema' not in a for p in value for a in p['actions'])
    elif name in ['/api/actions/hackernews.get_item', '/v1/actions/hackernews.get_item']:
        action = value['data'] if name.startswith('/v1/') else value
        expected = next(a for a in json.loads(Path('catalog/apps/hackernews.json').read_text())['actions']
                        if a['id'] == 'hackernews.get_item')
        assert action['inputSchema'] == expected['inputSchema']
        assert action['outputSchema'] == expected['outputSchema']
    elif name == '/api/providers/hackernews':
        assert value['service'] == 'hackernews' and value['actions']
    elif name.startswith('/v1/actions?'):
        assert value['success'] and value['data']
    elif name.startswith('/openapi.json'):
        assert value['openapi'] == '3.1.0' and value['paths']
    elif name.endswith('/agent.md'):
        assert isinstance(value, str) and value


def main():
    secret = json.loads(Path('/home/ubuntu/.local/state/open-connector-cpu-20261023/staging-secrets.json').read_text())['PERF_TOKEN']
    report = []

    def probe(name, path='/mcp', payload=None):
        headers = {'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json',
                   'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26',
                   'User-Agent': 'Mozilla/5.0'}
        request = urllib.request.Request(ORIGIN + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        start = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, body = response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            status, body = error.code, error.read().decode()
        if body.startswith('event:'):
            body = ''.join(line[5:].strip() for line in body.splitlines() if line.startswith('data:'))
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = body
        verify(name, status, parsed)
        row = {'name': name, 'status': status, 'wallMs': round((time.monotonic()-start)*1000, 1),
               'verified': True, 'responseBytes': len(body.encode()), 'responseSha256': hashlib.sha256(body.encode()).hexdigest()}
        report.append(row)
        print(json.dumps(row), flush=True)

    for i in range(3):
        probe(f'initialize-{i}', payload={'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'cpu-verification', 'version': '1'}}})
        probe(f'tools/list-{i}', payload={'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
        for name, args in [('list_connections', {}), ('list_apps', {'query': 'github'}),
                           ('get_action_guide', {'actionId': 'hackernews.get_item'}),
                           ('search_actions', {'query': 'get item', 'service': 'hackernews', 'limit': 3}),
                           ('execute_action', {'actionId': 'hackernews.get_item', 'input': {}})]:
            probe(f'{name}-{i}', payload={'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}})
    for path in ['/api/providers', '/api/actions/hackernews.get_item', '/api/providers/hackernews',
                 '/v1/actions/hackernews.get_item', '/v1/actions?service=hackernews',
                 '/api/actions/hackernews.get_item/agent.md', '/openapi.json?actionId=hackernews.get_item']:
        probe(path, path)
    REPORT.write_text(json.dumps({'date': '2026-10-23', 'origin': ORIGIN, 'requests': report}, indent=2) + '\n')


if __name__ == '__main__':
    main()
