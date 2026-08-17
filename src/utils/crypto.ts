import * as crypto from "crypto";

const SECRET = process.env.ENCRYPTION_KEY || "dodb-mac-secure-master-key-v1";
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  return crypto.pbkdf2Sync(SECRET, "dodb-salt-salt-v1", 100000, 32, "sha256");
}

export function encryptPassword(plainText: string): string {
  if (!plainText) return "";
  if (plainText.startsWith("enc:")) return plainText; // Already encrypted

  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return `enc:${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("Encryption error:", err);
    return plainText;
  }
}

export function decryptPassword(cipherText: string): string {
  if (!cipherText) return "";
  if (!cipherText.startsWith("enc:")) return cipherText; // Return plain text as-is for legacy profiles

  try {
    const parts = cipherText.split(":");
    if (parts.length !== 4) return cipherText;

    const iv = Buffer.from(parts[1], "hex");
    const authTag = Buffer.from(parts[2], "hex");
    const encryptedText = parts[3];

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption error:", err);
    return cipherText;
  }
}
