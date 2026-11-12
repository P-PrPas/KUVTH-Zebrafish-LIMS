import json
from pathlib import Path
import fitz,openpyxl
O=Path(__file__).resolve().parent
d=json.loads((O/'browser-results.json').read_text('utf-8'));r={x['name']:x for x in d['results']}
checks={'no_browser_exceptions':not d['errors'],'no_harness_errors':not any('error' in x for x in r.values())}
checks['online_feedback']= 'ระบบจะซิงก์อัตโนมัติ' not in r['QA03-online']['text']
checks['offline_feedback']='ระบบจะซิงก์อัตโนมัติ' in r['QA03-offline']['text']
checks['sync_recovery']='ระบบจะซิงก์อัตโนมัติ' not in r['QA03-reconnected']['text'] and 'QA PR47 offline' in r['QA03-persisted']['text']
checks['bangkok_history']='(Asia/Bangkok)' in r['QA05-bangkok-history']['text']
for lang,terms in [('th',['0 ประเด็น','0 รายการ']),('en',['0 issues','0 records'])]:
 t=r['QA06-empty-'+lang]['text'];checks['empty_'+lang]=all(s in t for s in terms) and '1–0' not in t
for w in [1440,375,320]:
 layout=r['dashboard-'+str(w)]['layout'];checks['viewport_'+str(w)]=layout['width']==layout['scrollWidth']
perms=json.loads((O/'permissions.json').read_text('utf-8'))
for item in perms:
 role,path=item['role'],item['path'];expected=401 if role=='anonymous' else 200 if role=='admin' or path in ['/auth/me','/analytics/guest-dashboard'] or (role=='member' and path=='/batches') else 403
 checks['permission_'+role+path]=item['status']==expected
checks['audit_zero']=json.loads((O/'npm-audit.json').read_text('utf-8'))['metadata']['vulnerabilities']['total']==0
workbook=openpyxl.load_workbook(O/'clean.xlsx',read_only=True);rows=list(workbook.active.values);checks['xlsx_opens']=len(rows)>1
result={'checks':checks,'allPassed':all(checks.values()),'permissionCases':len(perms),'cleanWorkbookRows':len(rows),'pdfPages':{lang:len(fitz.open(O/f'meeting-{lang}.pdf')) for lang in ['th','en']}}
(O/'verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
