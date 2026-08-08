import { logger } from '@librechat/data-schemas';

/**
 * Analytikul CRM bridge — pushes a new free signup into Dolibarr as a prospect
 * ("third party", client=2) so marketing can nurture the lead. See the marketing
 * playbook `/marketing/playbooks/email-nurture`.
 *
 * Fully fail-soft and env-gated: if `CRM_API_URL`/`CRM_API_KEY` are unset, or the
 * call errors/times out, it logs and returns — it MUST NEVER throw, because it runs
 * inside the registration transaction and a throw there would roll back (delete) the
 * brand-new user. Activates automatically once the env vars are set.
 *
 * Dolibarr REST: POST {CRM_API_URL}/thirdparties with header `DOLAPIKEY`.
 * `CRM_API_URL` example: https://crm.phoenixtekk.com/api/index.php
 */
export interface CrmContact {
  email: string;
  name?: string;
  /** Free-form provenance label, e.g. "signup". */
  source?: string;
}

const CRM_URL = () => process.env.CRM_API_URL?.replace(/\/$/, '');
const CRM_KEY = () => process.env.CRM_API_KEY;

export async function createCrmContact(contact: CrmContact): Promise<{ ok: boolean; id?: string }> {
  const base = CRM_URL();
  const key = CRM_KEY();
  if (!base || !key) {
    return { ok: false }; // CRM not configured — silent no-op.
  }
  if (!contact?.email) {
    return { ok: false };
  }
  try {
    const source = contact.source ?? 'signup';
    const payload = {
      name: contact.name?.trim() || contact.email,
      email: contact.email,
      client: 2, // Dolibarr: 2 = prospect/lead
      status: 1, // active
      note_private: `Analytikul ${source} — created ${new Date().toISOString()}`,
    };
    const res = await fetch(`${base}/thirdparties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        DOLAPIKEY: key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn(`[analytikul:crm] Dolibarr create failed (${res.status}): ${body.slice(0, 200)}`);
      return { ok: false };
    }
    // Dolibarr returns the new third-party id (number) on success.
    const id = await res.json().catch(() => undefined);
    logger.info(`[analytikul:crm] Created Dolibarr prospect for ${contact.email} (id ${id})`);
    return { ok: true, id: id != null ? String(id) : undefined };
  } catch (err) {
    logger.warn(`[analytikul:crm] Dolibarr create errored for ${contact.email}:`, err);
    return { ok: false };
  }
}
