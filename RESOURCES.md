# SMTP Setup Resources

## Knowledge

- [KU-Google Account services — Office of Computer Service, Kasetsart University](https://ocs.ku.ac.th/en/ku-google-account-services-en/)
  ยืนยันว่า `@ku.th` เป็น KU-Google และเข้าใช้ผ่าน `mail.ku.th`; ใช้ตรวจว่าบัญชีอยู่ในบริการใด
- [Send email from a printer, scanner, or app — Google Workspace Help](https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app)
  ค่า `smtp.gmail.com`, พอร์ต TLS 587 และ App Password; ใช้ตั้งค่า SMTP client
- [Sign in with app passwords — Google Account Help](https://support.google.com/accounts/answer/185833?hl=en)
  เงื่อนไข 2-Step Verification และกรณีบัญชีโรงเรียน/องค์กรอาจไม่มีเมนู App Password
- [Email Services — Office of Computer Service, Kasetsart University](https://ocs.ku.ac.th/en/email-services-en/)
  ช่องทางอีเมลสำหรับระบบและข้อจำกัดการส่งที่ OCS เผยแพร่; ใช้พิจารณาผู้ส่งระยะยาว

## Wisdom (Communities)

- [AskMe KU](https://askme.ku.th/)
  ช่องทางสอบถามฝ่ายสนับสนุน KU หากนโยบาย KU-Google ไม่อนุญาต App Password หรือ SMTP relay

## Gaps

- ยังไม่มีเอกสารสาธารณะของ KU ที่ยืนยันว่า `@ku.th` ทุกบัญชีเปิด SMTP AUTH/App Password ได้ จึงต้องตรวจในบัญชีจริงหรือถาม KU IT
- SMTP relay ต้องให้ผู้ดูแล Google Workspace ตั้งนโยบายและอาจต้องอนุญาต IP ของเครื่อง backend
