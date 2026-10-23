import json,os,time,urllib.request,urllib.error
from pathlib import Path
rows=[]
for method,params in [
 ('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'repair-verification','version':'1'}}),
 ('tools/list',{}),
 ('tools/call',{'name':'list_connections','arguments':{}}),
 ('tools/call',{'name':'list_apps','arguments':{'query':'googlechat'}}),
 ('tools/call',{'name':'get_action_guide','arguments':{'actionId':'googlechat.list_messages'}}),
 ('tools/call',{'name':'search_actions','arguments':{'query':'get item','service':'hackernews','limit':3}}),
]:
 name=params.get('name',method)
 req=urllib.request.Request('https://connect.yishaik.com/mcp',data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'Authorization':'Bearer '+os.environ['OPENCONNECTOR_MCP_TOKEN'],'Content-Type':'application/json','Accept':'application/json, text/event-stream','User-Agent':'OpenWebUI-Verification/1.0'})
 start=time.monotonic()
 try:
  with urllib.request.urlopen(req,timeout=60) as f:status=f.status;body=f.read().decode()
 except urllib.error.HTTPError as e:status=e.code;body=e.read().decode()
 if body.startswith('event:'):body=''.join(line[5:].strip() for line in body.splitlines() if line.startswith('data:'))
 try:parsed=json.loads(body)
 except ValueError:parsed={}
 result=parsed.get('result',{});tool=None
 if 'content' in result:
  tool=json.loads(next(c['text'] for c in result['content'] if c.get('type')=='text'))
 row={'name':name,'status':status,'wallMs':round((time.monotonic()-start)*1000,1),'jsonRpcError':parsed.get('error'),'toolOk':None if tool is None else tool.get('ok'),'toolError':None if tool is None else tool.get('error',{}).get('code')}
 if method=='tools/list':row['tools']=[t['name'] for t in result.get('tools',[])]
 rows.append(row);print(json.dumps(row),flush=True)
Path('verification/perf-live-'+os.environ.get('PERF_LABEL','after')+'.json').write_text(json.dumps({'date':'2026-10-23','requests':rows},indent=2)+'\n')

assert all(r["status"] == 200 and not r["jsonRpcError"] and r["toolOk"] is not False for r in rows), "Live MCP verification failed"
