// BYOK vault: provider API keys AES-256-GCM encrypted at rest.
// Master key: ANALYTIKUL_VAULT_KEY (32-byte hex, env only). Decrypted values are
// returned only to the internal /vault/key endpoint caller (the Express backend),
// never cached, never logged.
import crypto from 'node:crypto';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString:
    process.env.BILLING_PG_URI ?? 'postgresql://myuser:mypassword@vectordb:5432/mydatabase',
  max: 5,
});

const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS billing;
CREATE TABLE IF NOT EXISTS billing.vault (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, provider)
);
`;

export async function migrateVault() {
  await pool.query(MIGRATION);
}

function masterKey() {
  const hex = process.env.ANALYTIKUL_VAULT_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ANALYTIKUL_VAULT_KEY must be 32 bytes hex (64 chars)');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export async function putKey({ orgId, userId, provider, apiKey }) {
  const { ciphertext, iv, authTag } = encrypt(apiKey);
  const hint = `…${apiKey.slice(-4)}`;
  await pool.query(
    `INSERT INTO billing.vault (org_id, user_id, provider, ciphertext, iv, auth_tag, key_hint)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, user_id, provider) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag, key_hint = EXCLUDED.key_hint, created_at = now()`,
    [orgId, userId, provider, ciphertext, iv, authTag, hint],
  );
  return { provider, hint };
}

export async function getKey({ orgId, userId, provider }) {
  const { rows } = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM billing.vault
     WHERE org_id = $1 AND user_id = $2 AND provider = $3`,
    [orgId, userId, provider],
  );
  if (rows.length === 0) {
    return null;
  }
  return decrypt({
    ciphertext: rows[0].ciphertext,
    iv: rows[0].iv,
    authTag: rows[0].auth_tag,
  });
}

export async function listKeys({ orgId, userId }) {
  const { rows } = await pool.query(
    `SELECT provider, key_hint, created_at FROM billing.vault
     WHERE org_id = $1 AND user_id = $2 ORDER BY provider`,
    [orgId, userId],
  );
  return rows;
}

export async function deleteKey({ orgId, userId, provider }) {
  const { rowCount } = await pool.query(
    `DELETE FROM billing.vault WHERE org_id = $1 AND user_id = $2 AND provider = $3`,
    [orgId, userId, provider],
  );
  return rowCount > 0;
}
