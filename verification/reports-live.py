"""Verify deployed report metadata and access boundaries without printing secrets."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import urllib.error
import urllib.request

ROOT = Path('/home/ubuntu/.local/state/open-connector-reports-backup-2026-10-22')
API = 'https://api.cloudflare.com/client/v4/accounts/0f6475716c1a85bfa0a5956792e85b52'


def call(path, body=None):
    request = urllib.request.Request(API + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=40) as response:
        result = json.load(response)
    assert result['success']
    return result['result']


def query(sql, params=None):
    return call('/d1/database/528e7976-6cb1-4d9f-9fdd-29f4ad7edac8/query', {'sql': sql, 'params': params or []})[0]['results']


before = sqlite3.connect(':memory:')
before.row_factory = sqlite3.Row
before.executescript((ROOT / 'd1-before.sql').read_text())
counts = {}
for table in ['connections', 'runtime_tokens', 'runtime_policy']:
    columns = [row[1] for row in before.execute('pragma table_info(' + table + ')')]
    sql = 'select ' + ','.join('"' + column + '"' for column in columns) + ' from ' + table + ' order by 1'
    old = [dict(row) for row in before.execute(sql)]
    new = query(sql)
    assert len(old) == len(new), table + ' count differs; inspect privately'
    changes = {column for a, b in zip(old, new) for column in columns if a[column] != b[column]}
    assert not changes or (table == 'runtime_tokens' and changes <= {'last_used_at'}), table + ' configuration changed'
    counts[table] = len(new)

stats = query('select count(*) as count, min(started_at) as earliest, max(started_at) as latest from usage_events')[0]
missing = query('select count(*) as count from runs r left join usage_events u on u.id = r.id where u.id is null')[0]['count']
assert missing == 0
probe = query("select u.action_id, u.caller, u.ok, length(u.runtime_token_id) > 0 as attributed from usage_events u where u.action_id = 'github.get_current_user' and u.started_at >= (select recording_started_at from usage_report_meta where id = 1) order by u.started_at desc limit 1")
assert probe and probe[0]['ok'] == 1 and probe[0]['attributed'] == 1
if len(sys.argv) > 1:
    exact = query('select ok, caller, length(runtime_token_id) > 0 as attributed from usage_events where id = ?', [sys.argv[1]])
    assert exact and exact[0]['ok'] == 1 and exact[0]['attributed'] == 1 and exact[0]['caller'] == 'mcp'
columns = {row['name'] for row in query('pragma table_info(usage_events)')}
assert not columns.intersection({'value', 'input_summary', 'output_summary', 'secret', 'token', 'profile'})

versions = {}
for worker in ['open-connector', 'open-connector-console']:
    versions[worker] = call('/workers/scripts/' + worker + '/deployments')['deployments'][0]['versions']
    settings = call('/workers/scripts/' + worker + '/settings')
    old = json.loads((ROOT / (worker + '-settings.backup')).read_text())['result']
    assert {b['name'] for b in old['bindings'] if b['type'] == 'secret_text'} <= {b['name'] for b in settings['bindings'] if b['type'] == 'secret_text'}
domain = next(item for item in call('/workers/domains') if item['hostname'] == 'connect.yishaik.com')
assert domain['service'] == 'open-connector-console'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


statuses = {}
for path in ['/reports', '/api/reports/weekly']:
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request('https://connect.yishaik.com' + path, headers={'User-Agent': 'OpenWebUI-Verification/1.0'}), timeout=30) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    assert status == 302, 'Existing Access login must protect ' + path
    statuses[path] = status

report = {'date': '2026-10-22', 'url': 'https://connect.yishaik.com/reports', 'versions': versions,
    'inventory_counts': counts, 'credentials_and_access_grants_unchanged': True, 'domain_owner_preserved': True,
    'secret_bindings_preserved': True, 'archive': stats, 'retained_runs_missing_from_archive': missing,
    'live_read_only_mcp_action_archived_with_key_attribution': True, 'unauthenticated_routes': statuses,
    'exact_live_probe_found_without_backfill': len(sys.argv) > 1,
    'human_access_login_tested': False, 'provider_writes_executed': False}
Path('verification/reports-live.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
