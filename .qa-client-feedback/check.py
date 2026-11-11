from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
import json
import httpx
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
API = 'http://127.0.0.1:8082/api/v1'
operator = '00000000-0000-7000-8000-000000000001'
run = uuid4().hex[:8]

def write(path, data):
    response = httpx.post(API + path, json=data, headers={
        'X-Operator-Id': operator, 'X-Device-Id': 'feedback-qa', 'X-Idempotency-Key': str(uuid4()),
    })
    response.raise_for_status()
    return response.json()

site = write('/sites', {'code':f'QA{run[:6]}', 'name':'มหาวิทยาลัยเกษตรศาสตร์ QA'})
group = write('/experiment-groups', {'code':f'CLONING-{run}', 'name':'โครงการวิจัยการโคลนปลาม้าลาย', 'description':'การทดลองเพื่อพัฒนาธนาคารเซลล์'})
donor = write('/donor-cell-lines', {'strain':'AB', 'preparation':'CHUNKS', 'batchCode':f'QA-{run}'})
treatment = write('/treatment-groups', {'code':f'SCNT-{run}', 'name':'Somatic cell transfer', 'armType':'SCNT'})
batch = write('/batches', {'batchCode':f'KU-CLONE-{run}', 'experimentDate':datetime.now().date().isoformat(), 'replicateNo':1, 'siteId':site['id'], 'operatorId':operator, 'protocolId':'01900000-0000-7000-8000-000000000001', 'treatmentGroupId':treatment['id'], 'experimentGroupId':group['id']})
lot = write(f"/batches/{batch['id']}/injection-lots", {'lotNo':'1', 'donorCellLineId':donor['id'], 'nActivated':36, 'activatedAt':(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat()})
(ROOT/'seed.json').write_text(json.dumps({'group':group,'batch':batch,'lot':lot}), encoding='utf-8')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':820,'height':1180}, device_scale_factor=1, is_mobile=True, has_touch=True, accept_downloads=True)
    context.add_init_script(f"sessionStorage.setItem('chronofish.operator_id', '{operator}')")
    context.route('**/api/v1/**', lambda route: route.fulfill(response=route.fetch(url=route.request.url.replace('http://127.0.0.1:5174','http://127.0.0.1:8082'))))
    page = context.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto('http://127.0.0.1:5174/#due')
    expect(page.get_by_text(batch['batchCode'], exact=False)).to_have_count(1)
    page.get_by_text(batch['batchCode'], exact=False).click()
    expect(page.locator('.well-cell--unassigned')).to_have_count(36)
    expect(page.locator('.checkpoint-draft-panel')).to_be_visible()
    page.locator('.well-cell').nth(17).click()
    page.locator('#active-stage').select_option('stage_03_4C')
    page.locator('.checkpoint-notes summary').click()
    page.locator('#active-notes').fill('ร่างผลตรวจบน iPad')
    selected = page.locator('.well-cell[aria-pressed=true]').get_attribute('id')
    page.reload()
    page.screenshot(path=str(ROOT/'ipad-reload-debug.png'),full_page=True)
    expect(page.locator('.well-cell[aria-pressed=true]')).to_have_attribute('id',selected)
    expect(page.locator('#active-stage')).to_have_value('stage_03_4C')
    expect(page.locator('#active-notes')).to_have_value('ร่างผลตรวจบน iPad')
    expect(page.locator('.checkpoint-draft-panel')).to_be_visible()
    expect(page.locator('.checkpoint-action-bar button')).to_be_disabled()
    page.get_by_role('button', name='Save draft now').click()
    page.screenshot(path=str(ROOT/'ipad-draft.png'),full_page=True)
    page.locator('#active-outcome').select_option('ALIVE')
    page.locator('.checkpoint-action-bar button').click()
    expect(page.locator('.checkpoint-action-bar button')).to_be_disabled()
    page.reload()
    expect(page.locator('.checkpoint-action-bar button')).to_be_disabled()
    expect(page.locator('#active-stage')).to_be_disabled()
    # Keep using the same actual API, with a single isolated in-memory dataset.
    page.goto('http://127.0.0.1:5174/#batches')
    page.locator('.record-toolbar select').select_option(group['id'])
    expect(page.locator('.list-row')).to_have_count(1)
    page.screenshot(path=str(ROOT/'ipad-groups.png'),full_page=True)
    page.goto('http://127.0.0.1:5174/#export')
    age_inputs=page.locator('.export-clean-form input')
    for index, age in enumerate([7,30,90]): age_inputs.nth(index).fill(str(age))
    page.screenshot(path=str(ROOT/'ipad-export.png'),full_page=True)
    with page.expect_download() as info: page.locator('.export-clean-form button').click()
    download=info.value
    download.save_as(ROOT/download.suggested_filename)
    for width,height in [(768,1024),(820,1180),(1024,768),(1180,820),(1366,1024),(390,844),(1440,1000)]:
        page.set_viewport_size({'width':width,'height':height})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), (width,height,'overflow')
    assert not errors, errors
    browser.close()
    print('PASS: actual API, iPad reload draft + save reconciliation + parent filter + clean download; 7 export viewport widths, no JS errors')
