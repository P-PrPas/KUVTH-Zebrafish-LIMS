from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
O=Path(__file__).resolve().parent
old=(O.parent/'handover-20261111/report.html').read_text('utf-8')
css=re.search(r'<style>(.*?)</style>',old,re.S).group(1)
logo=re.search(r'<img class="brand" src="([^"]+)"',old).group(1)
data=json.loads((O/'browser-results.json').read_text('utf-8'))
def page(title,body):
 return f'<section><img class="brand" src="{logo}"><p class="eyebrow">KUVACB AqLIMS · PR #47 · ae4b4b7 · 11 พฤศจิกายน 2026</p><h2>{title}</h2>{body}</section>'
def table(head,rows):
 return '<table><tr>'+''.join('<th>'+x+'</th>' for x in head)+'</tr>'+''.join('<tr>'+''.join('<td>'+str(x)+'</td>' for x in r)+'</tr>' for r in rows)+'</table>'
pages=[page('ผล review และ QA รอบล่าสุด','''<div class="hero"><h1>ไม่พบ blocker<br>ในขอบเขตที่ตรวจรอบนี้</h1><div class="score">85 / 100</div><p>คงคะแนนเชิงคุณภาพจากรอบก่อน<br>เพิ่มหลักฐานยืนยัน rollback และ acceptance</p></div><p>ตรวจ commit <b>ae4b4b787aa186cb145d3345bb4a42b301a84aaf</b> ใน PR #47 เปรียบเทียบกับ a1c27ef และตรวจความเชื่อมโยงกับโค้ดเดิม โดยเน้นความปลอดภัยของข้อมูลจากการย้อน import v5</p><h3>ข้อสรุปสำหรับผู้ส่งมอบ</h3><p>การย้อน experiment, registry และ aggregate ที่มี manifest ทำงานได้ การแก้ไขข้อมูลหรือสร้างรายการอ้างอิงภายหลังทำให้ rollback ถูกปฏิเสธ โดยข้อมูลเดิมยังอยู่ครบตาม assertions ที่ทดสอบ</p><p>CI ของ head นี้ผ่าน app, contract, PostgreSQL และ MySQL ทั้ง push/PR runs; publish ถูกข้ามตาม workflow ไม่ได้ merge หรือ deploy production</p><div class="note warn">85/100 เป็นคะแนนคุณภาพและความพร้อมตามขอบเขตเดิม ไม่ใช่อัตรา tests ผ่าน และไม่ใช่การรับรองว่าทุก feature ผ่าน end-to-end ครบทุกกรณีบน production</div>'''),
page('หลักฐานที่รันทดสอบใหม่',table(['ชุดทดสอบ','ผล','ขอบเขต'],[
('PostgreSQL rollback','3 ผ่าน / 3 ข้าม','Experiment, registry, aggregate; duplicate; later edit; dependent row; existing data preserved. Memory mode ข้ามโดยตั้งใจ'),
('Backend acceptance','63 ผ่าน','v5 parser/validation + embryo → fish → specimen → disposition → export; SMTP invitation/OTP/login/logout ผ่าน local SMTP'),
('Frontend','270 ผ่าน / 35 files','ชุด Vitest ปัจจุบัน รวม UI และ offline behavior ที่อยู่ใน suite'),
('Docker build','ผ่าน','Build api/frontend จาก head ล่าสุด; Compose healthy; ใช้ volume เดิม ไม่ reseed'),
('CI','ผ่าน','app / contract / postgres / mysql; หลักฐานใน ci.json'),
('Browser',f"{len(data['pages'])} checkpoints",'Admin / member / guest; navigation และ dashboard 1440/375/320px; รายละเอียดใน browser-results.json')])+'''<h3>วิธีประเมิน</h3><p>ใช้ PostgreSQL 16 แยกชั่วคราวสำหรับ import rollback และข้อมูลสังเคราะห์ใน tests ใช้ Chromium/Playwright กับ Compose localhost:5173 สำหรับ UI โดยสร้าง session เฉพาะบัญชี QA เดิมตามสิทธิ์ bypass ที่ได้รับ แล้วเพิกถอนเมื่อจบ</p><p>UI รอบนี้เป็น navigation/render และ role-access smoke test ส่วน lifecycle/SMTP/import commit-revert ทดสอบผ่าน API/test client ไม่ใช่การคลิกครบทุก mutation ผ่าน UI</p>'''),
page('ผลตรวจโค้ดและข้อจำกัด', '''<h3>การแก้ไขที่ยืนยันแล้ว</h3><p>Manifest บันทึก fingerprint ของแถวที่ import สร้างขึ้นใหม่ การ rollback ใช้ transaction และ shared write lock ตรวจ fingerprint, pending correction และ foreign-key references ก่อน soft-delete ทั้งชุด ลิงก์ specimen ที่ลบจำกัดเฉพาะ import_job_id นั้น</p><p>Tests ยืนยัน 409 หลังแก้แถวเดิมหรือเพิ่ม dependent row และ job ยังคง committed จากนั้น rollback สำเร็จเมื่อเอา dependency ที่สร้างเพื่อทดสอบออก</p><h3>UI-01 · Mobile navigation เบียดกัน (ไม่เป็น blocker)</h3><p>เปิด dashboard ด้วย member ที่ 320/375px: task reminder รูปนกและข้อความงานค้างเบียดกับเมนูสรุปผลด้านบน ควรจัด reminder เป็นแถวแยกหรือ compact badge และตรวจขอบเขตปุ่ม/ข้อความ ไม่ใช้เพียง scrollWidth ตัดสิน responsive ผ่าน หลักฐาน: member-mobile-375.png และ member-mobile-320.png เป็นจุดที่พบเพิ่มจาก visual QA ไม่ได้เกิดจาก diff rollback ล่าสุด</p><h3>ข้อจำกัดที่ยังต้องรับทราบ</h3>'''+table(['ประเด็น','สถานะ / งานต่อ'],[
('Import เก่าหรือแตะข้อมูลเดิม','งานก่อนมี manifest และงานที่แก้ existing rows ไม่ได้รับความสามารถ rollback ใหม่นี้ ต้องใช้ behavior เดิมแบบ conservative; ไม่ใช่ regression ใหม่'),
('SMTP production','ทดสอบ transport กับ localhost แล้ว แต่ยังไม่ยืนยัน TLS/credential/deliverability ของผู้ให้บริการจริง'),
('Offline หลายอุปกรณ์','Frontend tests ผ่าน แต่ไม่ได้จำลอง conflict พร้อมกันหลายอุปกรณ์ใน browser รอบนี้'),
('Correction / timing','เปิดหน้าและทดสอบ suite ที่เกี่ยวข้องตามที่มี ไม่ได้ทำทุก reject/withdraw/concurrency และ timing version scenario ใหม่'),
('ข้อมูลวิทยาศาสตร์และระบบจริง','ต้องมี golden dataset ที่ลูกค้ารับรอง และ acceptance ของ TLS/load/monitoring/restore/customer browsers; รอบนี้ไม่ได้ทำ restore ใหม่')])+'''<p class="small">ไม่พบ defect ใหม่ที่ยืนยันเป็น blocker จึงไม่มีข้อเสนอแก้ application source ในรอบนี้ ข้อจำกัดข้างต้นเป็นขอบเขต acceptance ที่เหลือ ไม่ใช่หลักฐานว่าระบบล้มเหลว</p>'''),
page('ภาพหลักฐานและการส่งมอบ','''<h3>Admin · นำเข้าข้อมูล</h3><img style="width:100%;max-height:108mm;object-fit:contain;border:1px solid #d7e4df" src="admin-imports.png"><h3>ไฟล์ตรวจสอบย้อนกลับ</h3><p>rollback-tests.xml · acceptance-tests.xml · frontend-tests.log · build.log · ci.json · browser-results.json · browser_check.py และภาพหน้าจอรายหน้า</p><p>ใช้สี teal/lime โลโก้ KUVACB และฟอนต์ของรายงานเดิมตาม design system ของโครงการ รายงานเก่ายังคงอยู่เพื่ออ้างอิงผลก่อนหน้า</p><p>ไม่มีการแก้ source ของแอป ไม่มีการ merge PR และไม่มีการเปลี่ยนบัญชีจริง เก็บ application containers/volume เดิมไว้ ลบเฉพาะ container ฐานข้อมูลทดสอบที่สร้างในรอบนี้หลังจบ</p>''')]
(O/'report.html').write_text('<!doctype html><html lang="th"><meta charset="utf-8"><title>KUVACB PR47 QA ae4b4b7</title><style>'+css+'</style><body>'+''.join(pages)+'</body></html>',encoding='utf-8')
with sync_playwright() as p:
 b=p.chromium.launch();q=b.new_page();q.goto((O/'report.html').as_uri());q.evaluate('document.fonts.ready');q.pdf(path=str(O/'QA-PR47-ae4b4b7.pdf'),prefer_css_page_size=True,print_background=True);b.close()
