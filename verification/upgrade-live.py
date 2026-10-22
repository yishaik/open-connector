"""Verify deployment and old D1 fields without exposing stored credentials."""
import json
import os
from pathlib import Path
import sqlite3
import urllib.request

ROOT = Path('/home/ubuntu/.local/state/open-connector-backup-2026-10-22')
API = 'https://api.cloudflare.com/client/v4/accounts/0f6475716c1a85bfa0a5956792e85b52'


def call(path, body=None):
    request = urllib.request.Request(
        API + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'],
            'Content-Type': 'application/json',
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    assert result['success'], 'Cloudflare verification request failed'
    return result['result']


before = sqlite3.connect(':memory:')
before.row_factory = sqlite3.Row
before.executescript((ROOT / 'd1-before.sql').read_text())
counts = {}
for table in ['connections', 'runtime_tokens', 'runtime_policy']:
    columns = [row[1] for row in before.execute('pragma table_info(' + table + ')')]
    query = 'select ' + ','.join('"' + column + '"' for column in columns) + ' from ' + table + ' order by 1'
    expected = [dict(row) for row in before.execute(query)]
    actual = call('/d1/database/528e7976-6cb1-4d9f-9fdd-29f4ad7edac8/query', {'sql': query})[0]['results']
    if actual != expected:
        assert len(actual) == len(expected), table + ' record count changed'
        changed = {column for old, new in zip(expected, actual) for column in columns if old[column] != new[column]}
        assert table == 'runtime_tokens' and changed <= {'last_used_at'}, table + ' changed fields: ' + ', '.join(sorted(changed))
    counts[table] = len(actual)

versions = {}
for name in ['open-connector', 'open-connector-console']:
    versions[name] = call('/workers/scripts/' + name + '/deployments')['deployments'][0]['versions']
    baseline = json.loads((ROOT / (name + '-settings.backup')).read_text())['result']
    secret_names = {b['name'] for b in baseline['bindings'] if b['type'] == 'secret_text'}
    settings = call('/workers/scripts/' + name + '/settings')
    assert secret_names <= {b['name'] for b in settings['bindings'] if b['type'] == 'secret_text'}
domain = next(d for d in call('/workers/domains') if d['hostname'] == 'connect.yishaik.com')
assert domain['service'] == 'open-connector-console'
report = {
    'date': '2026-10-22',
    'versions': versions,
    'domain_owner': domain['service'],
    'credentials_and_access_policy_unchanged': True,
    'runtime_token_last_use_may_advance': True,
    'secret_bindings_preserved': True,
    'counts': counts,
}
Path('verification/upgrade-live.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
