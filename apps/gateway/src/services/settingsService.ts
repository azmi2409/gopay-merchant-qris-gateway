import { decryptPayload, encryptPayload } from '../utils/crypto';
import { getDatabase } from '../utils/db';

const SETTINGS_KEY = 'gateway_settings';

export interface GatewaySettings {
  qrisStatic: string | null;
  merchantId: string | null;
}

export async function getGatewaySettings(): Promise<GatewaySettings> {
  const result = await getDatabase().execute({
    sql: 'SELECT data FROM app_settings WHERE key = ?',
    args: [SETTINGS_KEY]
  });
  if (!result.rows[0]?.data) return { qrisStatic: null, merchantId: null };
  return decryptPayload<GatewaySettings>(String(result.rows[0].data));
}

export async function updateGatewaySettings(
  update: Partial<GatewaySettings>
): Promise<GatewaySettings> {
  const settings = { ...(await getGatewaySettings()), ...update };
  await getDatabase().execute({
    sql: 'INSERT OR REPLACE INTO app_settings (key, data, updated_at) VALUES (?, ?, ?)',
    args: [SETTINGS_KEY, encryptPayload(settings), Date.now()]
  });
  return settings;
}

export async function getQrisStatic(): Promise<string | null> {
  return (await getGatewaySettings()).qrisStatic || process.env.QRIS_STATIC || null;
}

export async function getMerchantId(): Promise<string | null> {
  return (await getGatewaySettings()).merchantId || process.env.GOPAY_MERCHANT_ID || null;
}
