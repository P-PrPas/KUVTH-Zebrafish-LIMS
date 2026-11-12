# Mission: ส่งอีเมลระบบ VETKU

## Why
ตั้งค่าอีเมลให้ระบบ VETKU ส่งรหัส OTP และคำเชิญสมาชิกได้จริง โดยเริ่มใช้บัญชี KU-Google `peerapas.c@ku.th` และเปลี่ยนไปใช้ผู้ส่งของระบบเมื่อพร้อมใช้งานจริง

## Success looks like
- กรอกค่า SMTP ใน `.env` ได้โดยไม่เปิดเผยรหัสลับ
- ขอรหัส OTP แล้วได้รับอีเมลทดสอบในกล่องจดหมาย
- รู้ว่าจะขอข้อมูลจาก KU IT อย่างไรเมื่อบัญชีไม่อนุญาต SMTP แบบ App Password

## Constraints
- ใช้อีเมล `@ku.th` ของ KU-Google ในช่วงเริ่มต้น
- ไม่ใช้หรือส่งรหัสผ่านบัญชี KU ปกติให้ระบบ
- ค่า SMTP password ต้องอยู่เฉพาะใน environment ของ backend

## Out of scope
- ตั้งค่า SMTP relay ใน Google Admin Console ซึ่งต้องใช้สิทธิ์ผู้ดูแลโดเมน
- เปลี่ยนผู้ส่งอีเมลในหน้า admin ของ VETKU
