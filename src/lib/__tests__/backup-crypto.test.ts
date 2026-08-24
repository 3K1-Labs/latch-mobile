import {
  encryptBackup,
  decryptBackup,
  encryptBackupAsync,
  decryptBackupAsync,
} from '../backup-crypto';

jest.mock('react-native-quick-crypto', () => {
  const actualCrypto = jest.requireActual('crypto');
  return {
    ...actualCrypto,
    default: {
      ...actualCrypto,
      argon2Sync: (algo: string, options: any) => {
        return actualCrypto.pbkdf2Sync(
          options.message,
          options.nonce,
          options.passes || 1,
          options.tagLength || 32,
          'sha256'
        );
      },
      argon2: (algo: string, options: any, callback: (err: any, key: any) => void) => {
        actualCrypto.pbkdf2(
          options.message,
          options.nonce,
          options.passes || 1,
          options.tagLength || 32,
          'sha256',
          (err: Error | null, derivedKey: Buffer) => {
            callback(err, derivedKey);
          }
        );
      },
    },
    argon2Sync: (algo: string, options: any) => {
      return actualCrypto.pbkdf2Sync(
        options.message,
        options.nonce,
        options.passes || 1,
        options.tagLength || 32,
        'sha256'
      );
    },
    argon2: (algo: string, options: any, callback: (err: any, key: any) => void) => {
      actualCrypto.pbkdf2(
        options.message,
        options.nonce,
        options.passes || 1,
        options.tagLength || 32,
        'sha256',
        (err: Error | null, derivedKey: Buffer) => {
          callback(err, derivedKey);
        }
      );
    },
  };
});

describe('backup-crypto', () => {
  const password = 'super-secret-password-123!';
  const plaintext = JSON.stringify({
    mnemonic: 'illness spike retreat truth genius clock brain pass fit cave bargain toe',
    accounts: [{ index: 0, name: 'Account 1', smartAccountAddress: 'CB...' }],
  });

  describe('Synchronous API', () => {
    it('should encrypt and decrypt a payload correctly', () => {
      const encrypted = encryptBackup(plaintext, password);
      expect(encrypted.version).toBe('2');
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();

      const decrypted = decryptBackup(encrypted, password);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error for incorrect password', () => {
      const encrypted = encryptBackup(plaintext, password);
      expect(() => decryptBackup(encrypted, 'wrong-password')).toThrow();
    });
  });

  describe('Asynchronous API', () => {
    it('should encrypt and decrypt a payload correctly', async () => {
      const encrypted = await encryptBackupAsync(plaintext, password);
      expect(encrypted.version).toBe('2');
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();

      const decrypted = await decryptBackupAsync(encrypted, password);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error for incorrect password', async () => {
      const encrypted = await encryptBackupAsync(plaintext, password);
      await expect(decryptBackupAsync(encrypted, 'wrong-password')).rejects.toThrow();
    });
  });

  describe('Cross-Compatibility', () => {
    it('should decrypt a synchronously encrypted payload asynchronously', async () => {
      const encryptedSync = encryptBackup(plaintext, password);
      const decryptedAsync = await decryptBackupAsync(encryptedSync, password);
      expect(decryptedAsync).toBe(plaintext);
    });

    it('should decrypt an asynchronously encrypted payload synchronously', async () => {
      const encryptedAsync = await encryptBackupAsync(plaintext, password);
      const decryptedSync = decryptBackup(encryptedAsync, password);
      expect(decryptedSync).toBe(plaintext);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty plaintext strings', async () => {
      const emptyPlaintext = '';
      const encrypted = await encryptBackupAsync(emptyPlaintext, password);
      const decrypted = await decryptBackupAsync(encrypted, password);
      expect(decrypted).toBe(emptyPlaintext);
    });

    it('should handle special unicode characters', async () => {
      const complexPlaintext = '🔥 Latch Wallet 🔐 Stellar 🚀 Sparkles ✨ 🪐 Unicode';
      const encrypted = await encryptBackupAsync(complexPlaintext, password);
      const decrypted = await decryptBackupAsync(encrypted, password);
      expect(decrypted).toBe(complexPlaintext);
    });
  });
});
