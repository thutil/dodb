# dodb - macOS Native Database Manager

dodb เป็นแอปพลิเคชันบริหารจัดการฐานข้อมูลรูปแบบ Native macOS สำหรับ PostgreSQL และ MySQL/MariaDB ออกแบบด้วยดีไซน์เรียบหรูสไตล์ macOS พร้อมฟีเจอร์ระดับมืออาชีพครบถ้วน ทั้ง Data Explorer (Full CRUD), SQL Console, Process Manager, Export/Backup, และ ER Diagram แบบ Drag & Drop

---

## คุณสมบัติหลัก (Key Features)

### 1. การเชื่อมต่อและการสลับฐานข้อมูล (Connection Manager)
- รองรับทั้ง **PostgreSQL** และ **MySQL / MariaDB**
- บันทึกโปรไฟล์การเชื่อมต่อ (Connection Profiles) และทดสอบการเชื่อมต่อได้ล่วงหน้า
- สลับฐานข้อมูลย่อย (Database Switcher) บน Header และ Sidebar ได้เรียลไทม์

### 2. ระบบส่องดูและจัดการข้อมูล (Data Explorer & Full CRUD)
- **Data Grid**: แสดงผลข้อมูลตารางแบบตั้งหน้า (Pagination), กรองค้นหาเรียลไทม์ (Filter)
- **Inline Cell Editing**: ดับเบิลคลิกแก้ไขค่าในช่องตารางได้ทันที
- **Row Edit Modal**: ปุ่มแก้ไขข้อมูลรายแถวพร้อมตัวเลือกดูค่า JSON/Text ยาว
- **Atomic Database Transaction Bar**: มีระบบกักเก็บรายการเปลี่ยนแปลง (Pending Inserts, Updates, Deletes) พร้อมปุ่ม **Commit Changes** (Execute Transaction) และ **Rollback (Discard)** เมื่อเกิดข้อผิดพลาด

### 3. ระบบแผนผังความสัมพันธ์ตาราง (Drag & Drop ER Diagram)
- นำไลบรารี **`@xyflow/react` (React Flow 12)** มาพัฒนาเป็นผังความสัมพันธ์ตาราง (ER Diagram)
- คลิกและลากวางการ์ดตาราง (Table Nodes) ได้อย่างอิสระทุกจุดบน Canvas
- เส้นโยง Foreign Key เคลื่อนที่ตามการลากวางการ์ดตารางแบบเรียลไทม์
- สลับสี Canvas ตามธีมของระบบปฏิบัติการอัตโนมัติ (Light / Dark Mode Adaptation)

### 4. ระบบผู้ดูแลเซิร์ฟเวอร์ (Database Admin & Process Manager)
- **Database Management**: สร้างและลบฐานข้อมูล (Create / Drop Database)
- **User & Privileges**: สร้างผู้ใช้ใหม่ กำหนดสิทธิ์ Superuser และลบผู้ใช้ (Create / Drop User)
- **Process Manager**: ตรวจดูรายการ Process / Active Queries ที่กำลังทำงานบนเซิร์ฟเวอร์ พร้อมปุ่ม **Kill Process** เพื่อยุติคำสั่งที่ค้างอยู่

### 5. ระบบส่งออกและสำรองข้อมูล (Export SQL & CSV)
- **Export SQL Dump**: สร้างไฟล์สคริปต์ ANSI SQL Dump ครอบคลุมทั้งโครงสร้างตาราง (`CREATE TABLE`) และชุดข้อมูล (`INSERT INTO`)
- **Export CSV**: ส่งออกตารางเป็นไฟล์ CSV พร้อมปุ่มดาวน์โหลดลงเครื่องผ่าน GUI

### 6. การปรับแต่งธีม (System Theme Auto-Sync)
- ตรวจจับโหมดธีมสว่าง/มืดของระบบปฏิบัติการ macOS อัตโนมัติ (`prefers-color-scheme`)
- สามารถสลับธีม Dark / Light ด้วยตนเองผ่านปุ่มสลับบนแถบนิเวศด้านบน

---

## สถาปัตยกรรมระบบ (Architecture)

- **Desktop Shell**: Electron 43.4.0 (macOS `hiddenInset` native traffic lights bar)
- **Frontend UI**: Next.js 15 (React 19), `@xyflow/react`, `lucide-react`, Vanilla CSS tokens
- **Backend Service**: Express.js REST API, `pg` (PostgreSQL client pool), `mariadb` (MariaDB/MySQL connection pool)

---

## ขั้นตอนการติดตั้งและการพัฒนา (Development Setup)

### ความต้องการของระบบ (Requirements)
- macOS (Apple Silicon / Intel)
- Node.js 18+
- pnpm package manager

### การติดตั้ง Dependencies

```bash
# ติดตั้ง dependencies สำหรับ backend และ frontend
pnpm install
pnpm --prefix ui install
```

### การรันโปรแกรมในโหมดพัฒนา (Development Mode)

```bash
# รันแอปพลิเคชัน Desktop Native
pnpm desktop
```

หรือรันแยกส่วน:

```bash
# รัน Backend API (Port 3000)
pnpm dev

# รัน Frontend Next.js UI (Port 3001)
pnpm ui:dev
```

---

## การบิลด์แพ็กเกจติดตั้ง `.dmg` (Packaging Production DMG)

หากต้องการบิลด์แพ็กเกจติดตั้งไฟล์ `.dmg` สำหรับส่งให้ผู้อื่นทดสอบใช้งาน:

```bash
pnpm dist:mac
```

ไฟล์ติดตั้ง `.dmg` จะถูกสร้างขึ้นที่โฟลเดอร์ `dist-dmg/dodb-1.0.0-macOS.dmg`

---

## ใบอนุญาต (License)

MIT License
