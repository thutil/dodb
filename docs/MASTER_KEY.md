# master key ของ dodb เก็บที่ไหน และทำไม

เอกสารนี้เขียนไว้อ่านเอง สรุปสิ่งที่ทดลองจริงบน macOS แล้วเจอ

## คีย์นี้ใช้ทำอะไร

`~/.dodb/profiles.json` เก็บ connection ทั้งหมด **แบบ plaintext ทุกฟิลด์** ยกเว้นรหัสผ่าน
รหัสผ่านถูกเข้ารหัสด้วย AES-256-GCM เป็นสตริงหน้าตา `enc:v2:<iv>:<tag>:<ciphertext>`
คีย์ AES มาจาก master key (สุ่ม 256-bit ครั้งเดียวต่อเครื่อง) ผ่าน HKDF-SHA256

แปลว่า ใครได้ `profiles.json` ไปเฉย ๆ จะรู้ host / port / user / database ของคุณทั้งหมด
แต่จะถอดรหัสผ่านไม่ได้ถ้าไม่มี master key

| ระบบ | master key อยู่ที่ |
|---|---|
| macOS | `~/.dodb/.master_key` (ไฟล์ permission `0600`) |
| Windows | Credential Manager (`com.thutil.dodb` / `master-key`) |
| Linux / อื่น ๆ | `~/.dodb/.master_key` (`0600`) |

## ทำไม macOS ไม่ใช้ Keychain (ทั้งที่ตอนแรกทำไปแล้ว)

เคยย้ายเข้า Keychain แล้วเจอว่า **แอปขอ keychain password ทุกครั้งที่เปิด** และกด
*Always Allow* ก็ไม่ช่วย สาเหตุ:

```
codesign -dvvv /Applications/dodb.app
  flags=0x20002(adhoc,linker-signed)
  TeamIdentifier=not set
  designated => cdhash H"1ae584..."
```

keychain item ทุกอันมี ACL ที่บันทึกว่า "โค้ดตัวไหนอ่านได้" โดยอ้างจาก designated requirement
ของแอป แต่ build ที่ไม่ได้เซ็นด้วย certificate จะมี DR เป็นแค่ `cdhash` เปล่า ๆ ที่เปลี่ยนทุกครั้ง
ที่ compile ⇒ macOS ไม่มีอะไรที่เสถียรให้จำ *Always Allow* จึงไม่ติด

สิ่งที่ทดลองแล้ว **ไม่ได้ผล**:

| วิธี | ผล |
|---|---|
| `security add-generic-password -A` (item แบบไม่จำกัด ACL) แล้วให้แอป ad-hoc อ่าน in-process | ยังเด้ง prompt |
| ให้แอปสร้าง item แล้วอ่านผ่าน `/usr/bin/security` | ยังเด้ง prompt |

ตัวกั้นจริงคือ code identity ของ process ที่มาขอ ไม่ใช่แค่ ACL — ต้องเป็นโค้ดที่ Apple เซ็น หรือ
แอปที่เซ็นด้วย certificate จริงเท่านั้นที่อ่านได้เงียบ ๆ **แอปที่ยังไม่เซ็นจึงใช้ Keychain แบบไม่มี
prompt ไม่ได้เลย ไม่ว่าจะเขียนโค้ดอย่างไร** จึงถอยกลับมาใช้ไฟล์

## ระดับการป้องกันที่ได้จริง

| กันได้ | กันไม่ได้ |
|---|---|
| — | สำเนา `$HOME` (Time Machine, dotfile sync, cloud sync, `tar ~/.dodb`) |
| — | process อื่นของ user เดียวกัน |
| user อื่นบนเครื่องเดียวกัน (permission `0600`) | — |

พูดตรง ๆ คือบน macOS/Linux ตอนนี้ได้แค่ "user อื่นอ่านไม่ได้" เท่านั้น ส่วน Windows ได้เพิ่มคือ
DPAPI เข้ารหัสที่ rest และผูกกับ login account จึงไม่ติดไปกับ backup ไฟล์ — แต่ก็ยังไม่กัน
process ของ user เดียวกันเหมือนกัน

ถ้าไม่อยากให้รหัสผ่านลงดิสก์เลย: ติ๊ก **Save password** ออก แล้วรหัสจะอยู่แค่ในหน่วยความจำของ
session นั้น (`runtime_passwords` ใน `db_core.rs`)

## ตัวแปรที่คุมได้

| ตัวแปร | ผล |
|---|---|
| `DODB_KEY_BACKEND=file` | บังคับใช้ไฟล์ (ค่า default ของ macOS/Linux อยู่แล้ว) |
| `DODB_KEY_BACKEND=keychain` | บังคับใช้ Keychain — จะย้ายไฟล์เข้า Keychain ให้ แต่ **จะกลับไปเจอ prompt ทุกครั้งที่เปิด** ถ้า build ยังไม่เซ็น |
| `DODB_DATA_DIR=/path` | ย้ายทั้ง `profiles.json` และ `.master_key` ไปที่อื่น (ใช้ตอน dev) |
| `DODB_ENCRYPTION_KEY=...` | ใส่ secret เอง ไม่แตะทั้งไฟล์และ Keychain (ค่านี้ถูก stretch ด้วย PBKDF2 100k รอบก่อน เพราะอาจเป็น passphrase ที่ entropy ต่ำ) |

ตอน dev แนะนำ `DODB_KEY_BACKEND=file DODB_DATA_DIR=/tmp/dodb-dev make dev` เพื่อไม่ให้ปนกับ
ข้อมูลจริง

## คำสั่งตรวจและซ่อมด้วยมือ

```sh
# คีย์อยู่ไหม / permission ถูกไหม
ls -l ~/.dodb/.master_key

# ยังมี item ค้างใน Keychain จากรุ่นก่อนไหม (คำสั่งนี้ไม่ขอสิทธิ์อ่านข้อมูล จึงไม่เด้ง prompt)
security find-generic-password -s com.thutil.dodb -a master-key

# ลบ item ที่ค้าง (ลบไม่ต้องขอสิทธิ์อ่าน จึงไม่เด้ง prompt)
security delete-generic-password -s com.thutil.dodb -a master-key

# สำรองคีย์ไว้ (ถ้าไฟล์นี้หาย รหัสผ่านที่บันทึกไว้ทั้งหมดถอดไม่ออก)
cp ~/.dodb/.master_key ~/backup-dodb-master-key.txt
```

ถ้าไฟล์คีย์หายไปแล้วไม่มีสำรอง: แอปจะสุ่มคีย์ใหม่ ค่า `enc:` เดิมใน `profiles.json` จะถอดไม่ออก
โค้ดจะ log warning และเคลียร์ช่องรหัสผ่านให้ (`profilestore.go`) แล้วแอปจะถามรหัสผ่านใหม่ตอนเชื่อมต่อ —
ข้อมูลอื่นของ connection ไม่หาย

## การกู้คีย์อัตโนมัติ (เผื่อเจอในอนาคต)

`internal/crypto/crypto.go` → `decideFileAction()` ทำงานตามนี้ตอนหาคีย์:

| สถานะ | การกระทำ |
|---|---|
| มีไฟล์ | ใช้ไฟล์ (ไม่แตะ Keychain เลย จึงไม่มี prompt) |
| ไม่มีไฟล์ แต่ Keychain มีคีย์ | ดึงกลับมาเขียนเป็นไฟล์ (เด้ง prompt ครั้งเดียว) แล้วลบ item ทิ้งด้วย `security delete-generic-password` |
| ไม่มีทั้งคู่ | สุ่มคีย์ใหม่ |
| Keychain มีคีย์แต่อ่านไม่ได้ (กด Deny / keychain ล็อก) | **error ชัดเจน ไม่สุ่มคีย์ใหม่ทับ** แอปจะเด้ง toast บอก ไม่ใช่แสดง connection ว่าง ๆ |

## ถ้าวันหนึ่งมี certificate แล้วอยากกลับไปใช้ Keychain

1. เซ็นแอปด้วย certificate ที่คงที่ (Developer ID หรือ self-signed — ดู [`SIGNING.md`](SIGNING.md))
2. ทดสอบก่อนว่า prompt หายจริง: เปิดแอปที่เซ็นแล้ว 2 รอบ และ build ใหม่อีกรอบแล้วเปิด ต้องไม่ถามเลย
3. ถ้าผ่าน ค่อยแก้ `defaultBackend()` ใน `internal/crypto/crypto.go` ให้ macOS คืนค่า
   `BackendKeychain` — โค้ดฝั่ง Keychain (`keychainSecret()` / `adoptOrGenerate()`) ยังอยู่ครบ
   และย้ายไฟล์เข้า Keychain ให้เองพร้อมอ่านกลับมาเทียบก่อนลบไฟล์
4. ทางที่ดีกว่าคือเช็คลายเซ็นตอน runtime แล้วเลือก backend เอง (build ที่เซ็น = Keychain,
   build ad-hoc = ไฟล์) ซึ่งต้องเขียน FFI เรียก `SecCodeCopySigningInformation` เพราะ
   `security-framework-sys` ที่มีอยู่ยังไม่ export ให้
