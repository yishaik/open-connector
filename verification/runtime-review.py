"""Check live routing and policy denial without executing provider writes."""
import json,sys,urllib.request,urllib.error
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/git/open-webui-ops')
from owui_api import Client
from connector_client import tool
api=Client()
c=next(c for c in api.request('/api/v1/configs/tool_servers')['TOOL_SERVER_CONNECTIONS'] if c['info']['id']=='openconnector')
checks={}
for action in ['googledrive.files.delete','googlesheets.values_update']:
 _,result=tool(c,'execute_action',{'actionId':action,'input':{}})
 assert not result['ok'] and result['error']['code']=='action_not_allowed'
 checks[action]=result['error']['code']
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None
opener=urllib.request.build_opener(NoRedirect)
statuses={}
for path in ['/workspace','/runs','/api/connections']:
 try:
  with opener.open(urllib.request.Request('https://connect.yishaik.com'+path,headers={'User-Agent':'OpenWebUI-Verification/1.0'}),timeout=30) as response: status=response.status
 except urllib.error.HTTPError as error: status=error.code
 assert status==302
 statuses[path]=status
request=urllib.request.Request('https://connect.yishaik.com/mcp',data=b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',headers={'Content-Type':'application/json','User-Agent':'OpenWebUI-Verification/1.0'})
try:
 with opener.open(request,timeout=30) as response: status=response.status
except urllib.error.HTTPError as error: status=error.code
assert status==401
report={'date':datetime.now(timezone.utc).date().isoformat(),'denied_actions':checks,'unauthenticated_admin_routes':statuses,'mcp_without_key_status':status,'real_provider_writes_executed':False,'human_cloudflare_or_oauth_login_tested':False}
Path('verification/runtime-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
