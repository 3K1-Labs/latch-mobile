import { Buffer } from '@craftzdog/react-native-buffer';
import QuickCrypto from 'react-native-quick-crypto';

// Argon2id params tuned for mobile: ~1s on mid-range hardware
const ARGON2_MEMORY = 16384; // 16 MB
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const KEY_LEN = 32; // 256-bit AES key
const SALT_LEN = 16;
const IV_LEN = 12; // 96-bit GCM IV

export interface EncryptedBackup {
  version: '2';
  salt: string; // hex
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return QuickCrypto.argon2Sync('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism: ARGON2_PARALLELISM,
    tagLength: KEY_LEN,
    memory: ARGON2_MEMORY,
    passes: ARGON2_PASSES,
  });
}

function deriveKeyAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    QuickCrypto.argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: KEY_LEN,
        memory: ARGON2_MEMORY,
        passes: ARGON2_PASSES,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(Buffer.from(derivedKey));
        }
      }
    );
  });
}

export function encryptBackup(plaintext: string, password: string): EncryptedBackup {
  const salt = QuickCrypto.randomBytes(SALT_LEN);
  const iv = QuickCrypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: '2',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export async function encryptBackupAsync(plaintext: string, password: string): Promise<EncryptedBackup> {
  const salt = QuickCrypto.randomBytes(SALT_LEN);
  const iv = QuickCrypto.randomBytes(IV_LEN);
  const key = await deriveKeyAsync(password, salt);

  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: '2',
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

// Throws if the password is wrong (GCM auth tag mismatch) or payload is malformed.
export function decryptBackup(payload: EncryptedBackup, password: string): string {
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');

  const key = deriveKey(password, salt);

  const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

// Throws if the password is wrong (GCM auth tag mismatch) or payload is malformed.
export async function decryptBackupAsync(payload: EncryptedBackup, password: string): Promise<string> {
  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');

  const key = await deriveKeyAsync(password, salt);

  const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

