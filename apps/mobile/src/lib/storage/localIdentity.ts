import { generateUuidV4 } from '../id';
import { getPreferenceSync, setPreferenceSync } from './localDb';
import { secureVault } from './secureVault';

const INSTALL_ID_KEY = 'local_installation_id';
let cachedInstallationId: string | null = null;

/**
 * Returns the persistent anonymous device installation ID synchronously.
 * Generated once on first app open and mirrored into Android Keystore (`secureVault`).
 * Replaces cloud user accounts with zero email, password, or registration required.
 */
export function getLocalInstallationIdSync(): string {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  const fromDb = getPreferenceSync<string>(INSTALL_ID_KEY);
  if (fromDb && fromDb.length >= 8) {
    cachedInstallationId = fromDb;
    return fromDb;
  }

  const created = `inst-${generateUuidV4().replace(/-/g, '').slice(0, 24)}`;
  cachedInstallationId = created;
  setPreferenceSync(INSTALL_ID_KEY, created);
  void secureVault.setSecret(INSTALL_ID_KEY, created).catch(() => {});
  return created;
}

/**
 * Hydrates installation ID from Android Keystore if SQLite preferences were cleared,
 * ensuring device identity remains stable across cache clears.
 */
export async function hydrateLocalInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }
  const fromVault = await secureVault.getSecret(INSTALL_ID_KEY).catch(() => null);
  if (fromVault && fromVault.length >= 8) {
    cachedInstallationId = fromVault;
    setPreferenceSync(INSTALL_ID_KEY, fromVault);
    return fromVault;
  }
  return getLocalInstallationIdSync();
}
