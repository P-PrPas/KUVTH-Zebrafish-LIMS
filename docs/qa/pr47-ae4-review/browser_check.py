"""Read-only UI regression; sessions only for previously created QA accounts."""
from pathlib import Path
import hashlib, json, secrets, subprocess
from datetime import datetime, timedelta, UTC
from sqlalchemy import create_engine, text
from playwright.sync_api import sync_playwright
from chronofish.runtime.values import uuid7

O = Path(__file__).resolve().parent
def db(code):
    source = "import os,json\nfrom sqlalchemy import create_engine,text\nfrom datetime import datetime,timedelta,UTC\nengine=create_engine(os.environ['DATABASE_URL'])\nwith engine.begin() as c:\n" + ''.join('    '+line+'\n' for line in code.splitlines())
    return subprocess.check_output(['docker','exec','-i','vetku-api-1','python','-c',source],text=True).strip()
results = {'pages': [], 'errors': [], 'permissions': []}
sessions = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for role in ('admin', 'member', 'guest'):
            token, sid = secrets.token_urlsafe(32), uuid7()
            now = datetime.now(UTC).replace(tzinfo=None)
            db(f"uid=c.execute(text('SELECT id FROM auth_user WHERE email=:email'), {{'email':'qa-pr47-a1c27ef-{role}@example.com'}}).scalar_one()\nnow=datetime.now(UTC).replace(tzinfo=None)\nc.execute(text('INSERT INTO auth_session (id,token_hash,user_id,device_id,created_at,last_seen_at,absolute_expires_at) VALUES (:id,:hash,:uid,:device,:now,:now,:expires)'),dict(id='{sid}',hash='{hashlib.sha256(token.encode()).hexdigest()}',uid=uid,device='qa-ae4-browser',now=now,expires=now+timedelta(hours=1)))")
            sessions.append(sid)
            context = browser.new_context(viewport={'width':1440,'height':1000})
            context.add_cookies([dict(name='chronofish_session',value=token,url='http://localhost:5173',httpOnly=True,sameSite='Lax')])
            page = context.new_page()
            page.on('pageerror',lambda e: results['errors'].append(str(e)))
            page.goto('http://localhost:5173/admin' if role=='admin' else 'http://localhost:5173')
            page.wait_for_selector('.auth-shell--guest' if role=='guest' else 'main[data-page]')
            page.wait_for_load_state('networkidle')
            for summary in page.locator('.sidebar details:not([open]) > summary:visible').all():
                summary.click()
            labels = page.locator('.sidebar button.nav-link:visible').all_text_contents()
            if role=='guest':
                results['pages'].append(dict(role=role,page='guest',contentLength=len(page.locator('main').inner_text()),overflow=False))
                page.screenshot(path=str(O/'guest-dashboard.png'),full_page=True)
            for index,label in enumerate(labels):
                page.locator('.sidebar button.nav-link:visible').nth(index).click()
                page.wait_for_timeout(700)
                page.wait_for_load_state('networkidle')
                key = page.locator('main').get_attribute('data-page')
                body = page.locator('main').inner_text()
                assert len(body)>10, (role,key,body)
                results['pages'].append(dict(role=role,page=key,label=label.strip(),contentLength=len(body),overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth')))
                page.screenshot(path=str(O/f'{role}-{key}.png'),full_page=True)
            for path in ('auth/admin/users','imports','audit-log','fish','batches'):
                response = context.request.get(f'http://localhost:5173/api/v1/{path}')
                results['permissions'].append(dict(role=role,path=path,status=response.status))
            for width in (375,320):
                page.set_viewport_size({'width':width,'height':850})
                page.goto('http://localhost:5173/#dashboard')
                page.wait_for_selector('.auth-shell--guest' if role=='guest' else 'main[data-page]')
                page.wait_for_load_state('networkidle')
                results['pages'].append(dict(role=role,page='dashboard',width=width,overflow=page.evaluate('document.documentElement.scrollWidth > innerWidth')))
                page.screenshot(path=str(O/f'{role}-mobile-{width}.png'),full_page=True)
            context.close()
        browser.close()
finally:
    for sid in sessions:
        db(f"c.execute(text('UPDATE auth_session SET revoked_at=:now WHERE id=:id'),dict(id='{sid}',now=datetime.now(UTC).replace(tzinfo=None)))")
    results['sessionsRevoked']=len(sessions)
    (O/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pages':len(results['pages']),'errors':results['errors'],'sessionsRevoked':len(sessions)}))
