# 🛠️ Work-i-Go Admin Dashboard

ระบบสำหรับ **ผู้ดูแล (Admin)** ใช้ในการตรวจสอบและจัดการภาพรวมของแพลตฟอร์ม

---

## 📌 ภาพรวม (Overview)

Admin Dashboard เป็น Sub Application สำหรับ Monitor และควบคุมระบบทั้งหมดของ Work-i-Go

ช่วยให้ผู้ดูแลสามารถ:

* ดูภาพรวมของระบบ
* วิเคราะห์ข้อมูลการใช้งาน
* จัดการผู้ใช้และงาน

---

## 🔗 ความเชื่อมโยงในระบบ

```text
Main Web
    ↓
Employer Dashboard (Data Source)
    ↓
Admin Dashboard (Visualization / Control)
```

---

## ✨ ฟีเจอร์หลัก (Features)

* 📊 Dashboard แสดงสถิติ (Users / Jobs)
* 👥 จัดการผู้ใช้งาน (User Management)
* 📄 จัดการประกาศงาน
* 🔍 ตรวจสอบกิจกรรมในระบบ
* 🚨 Monitoring และตรวจสอบความผิดปกติ

---

## 🛠️ เทคโนโลยี (Tech Stack)

* Node.js
* Express.js
* Dashboard UI (Chart, Table)
* Database

---

## ⚙️ การติดตั้ง (Installation)

```bash
git clone <repo-url>
cd work_i_go_admin
npm install
```

---

## ▶️ การรันระบบ (Run)

```bash
npm start
```

หรือ

```bash
npm run dev
```

---

## 🌐 Environment Variables

```env
PORT=4000
DB_URI=your_database_url
ADMIN_SECRET=your_admin_secret
```

---

## 📊 หน้าที่ของระบบ (System Role)

Admin Dashboard ทำหน้าที่:

* ดึงข้อมูลจาก Employer Dashboard
* วิเคราะห์และแสดงผลข้อมูล

---

## 📁 โครงสร้างโปรเจค (ตัวอย่าง)

```bash
.
├── routes/
├── controllers/
├── services/
├── dashboard/
└── server.js
```

---

## 🔐 ความปลอดภัย (Security)

* จำกัดสิทธิ์เฉพาะ Admin เท่านั้น
* ใช้ Authentication / Authorization

---

## 📌 หมายเหตุ

* ใช้สำหรับผู้ดูแลระบบเท่านั้น (ไม่เปิดให้ user ทั่วไป)
* สามารถต่อยอดเพิ่ม Analytics ได้ในอนาคต

---
