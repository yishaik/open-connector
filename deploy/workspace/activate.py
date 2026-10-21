"""Switch the console hostname; leave the original runtime deployed unchanged."""
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

API='https://api.cloudflare.com/client/v4/accounts/0f6475716c1a85bfa0a5956792e85b52'
HOST='connect.yishaik.com'
STATE=Path.home()/'.local/state/open-connector-ui'

def call(path,body=None):
    req=urllib.request.Request(API+path,method='GET' if body is None else 'PUT',headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req,timeout=30) as response: data=json.load(response)
    except urllib.error.HTTPError as exc:
        # Cloudflare error messages contain no submitted credential values.
        error=json.loads(exc.read())
        raise RuntimeError('Cloudflare domain operation rejected: '+str(error.get('errors',[]))) from None
    assert data['success']
    return data['result']

def main():
    domains=call('/workers/domains')
    original=next(d for d in domains if d['hostname']==HOST)
    assert original['service']=='open-connector', 'Unexpected hostname owner; inspect before changing'
    baseline=call('/workers/scripts/open-connector/deployments')['deployments'][0]['versions']
    settings=call('/workers/scripts/open-connector-console/settings')
    assert any(b.get('type')=='service' and b.get('name')=='ORIGIN' and b.get('service')=='open-connector' for b in settings['bindings'])
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    (STATE/'original-domain.json').write_text(json.dumps(original,indent=2)+'\n')
    body={k:original[k] for k in ['hostname','zone_id','environment','enabled','previews_enabled']}
    body['service']='open-connector-console'
    body['override_existing_origin']=True
    try:
        call('/workers/domains',body)
        current=next(d for d in call('/workers/domains') if d['hostname']==HOST)
        assert current['service']=='open-connector-console'
        assert call('/workers/scripts/open-connector/deployments')['deployments'][0]['versions']==baseline
        sys.path.insert(0,'/home/ubuntu/git/open-webui-ops')
        from owui_api import Client
        from connector_client import tool
        api=Client()
        connection=next(c for c in api.request('/api/v1/configs/tool_servers')['TOOL_SERVER_CONNECTIONS'] if c['info']['id']=='openconnector')
        _,result=tool(connection,'list_connections')
        assert result['ok'] and len(result['data'])>=20
        _,denied=tool(connection,'execute_action',{'actionId':'googlesheets.values_update','input':{}})
        assert denied['error']['code']=='action_not_allowed'
        report={'hostname':HOST,'frontend_worker':current['service'],'backend_worker':'open-connector','backend_versions_unchanged':baseline,'mcp_live_verified':True,'write_restrictions_verified':True}
        Path('verification/deployment.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report))
    except BaseException:
        rollback={**body,'service':original['service']}
        call('/workers/domains',rollback)
        raise

if __name__=='__main__':main()
