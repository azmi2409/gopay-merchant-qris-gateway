import readline from 'readline';
import axios from 'axios';
import * as sessionManager from './services/sessionManager';
import { MASTER_KEY_FILE } from './utils/crypto';
import { GoBizOtpRequestResponse, GoBizTokenResponse } from './types/session';

export const GOBIZ_REQUEST_OTP_URL = 'https://api.gobiz.co.id/goid/login/request';
export const GOBIZ_VERIFY_OTP_URL = 'https://api.gobiz.co.id/goid/token';
export const GOBIZ_USER_CONFIG_URL = 'https://api.gobiz.co.id/goresto/v5/public/users/config';

/**
 * Normalizes phone input into national format without leading zero or 62
 * e.g. '085119772671' -> '85119772671'
 */
export function parsePhoneInput(rawPhone: string): string {
  if (!rawPhone) return '';
  let digits = String(rawPhone).trim().replace(/\D/g, '');
  if (digits.startsWith('62')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Ask question in terminal via Readline
 */
export function askQuestion(query: string, rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Executes the interactive GoBiz OTP login flow.
 * Returns true if authentication and session saving succeeded, false otherwise.
 */
export async function runLoginFlow(existingRl?: readline.Interface): Promise<boolean> {
  const shouldCloseRl = !existingRl;
  const rl =
    existingRl ||
    readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

  console.log('\n====================================================');
  console.log('   GOPAY MERCHANT / GOFOOD MERCHANT LOGIN OTP CLI   ');
  console.log('====================================================\n');

  const sessionHeaders = sessionManager.getStandardGoBizHeaders();

  try {
    // 1. Input Phone Number
    const rawPhone = await askQuestion(
      '>> Enter GoBiz/GoFood Merchant Phone Number (e.g., 085119772671): ',
      rl
    );
    const nationalPhone = parsePhoneInput(rawPhone);

    if (!nationalPhone || nationalPhone.length < 8) {
      console.log('[-] Invalid phone number. Please try again.');
      if (shouldCloseRl) rl.close();
      return false;
    }

    const formattedInternationalPhone = `+62${nationalPhone}`;
    console.log(`[*] Sending OTP request to: ${formattedInternationalPhone}...`);

    // 2. Request OTP from GoBiz
    let requestOtpResponse;
    try {
      requestOtpResponse = await axios.post<GoBizOtpRequestResponse>(
        GOBIZ_REQUEST_OTP_URL,
        {
          client_id: 'go-biz-web-new',
          phone_number: nationalPhone,
          country_code: '62'
        },
        {
          headers: sessionHeaders,
          timeout: 15000
        }
      );
    } catch (requestError: any) {
      const errorDetail = requestError.response
        ? JSON.stringify(requestError.response.data)
        : requestError.message;
      console.log(`[-] Failed to request OTP from GoBiz server: ${errorDetail}`);
      if (shouldCloseRl) rl.close();
      return false;
    }

    const requestData = (requestOtpResponse.data?.data || requestOtpResponse.data || {}) as any;
    const otpToken = requestData.otp_token || requestData.login_token;
    const expiresIn = requestData.expires_in || 720;

    if (!otpToken) {
      console.log('[-] GoBiz response did not return an OTP token.');
      if (shouldCloseRl) rl.close();
      return false;
    }

    console.log('[+] OTP code (4 digits) sent via SMS successfully!');
    console.log(`[*] Valid for ${expiresIn} seconds.\n`);

    // 3. Input OTP Code
    const otpCode = await askQuestion('>> Enter OTP Code (4 digits): ', rl);

    if (!otpCode || otpCode.trim().length === 0) {
      console.log('[-] OTP code cannot be empty.');
      if (shouldCloseRl) rl.close();
      return false;
    }

    console.log('[*] Verifying OTP code...');

    // 4. Verify OTP
    let verifyResponse;
    try {
      verifyResponse = await axios.post<GoBizTokenResponse>(
        GOBIZ_VERIFY_OTP_URL,
        {
          client_id: 'go-biz-web-new',
          grant_type: 'otp',
          data: {
            otp: otpCode.trim(),
            otp_token: otpToken
          }
        },
        {
          headers: sessionHeaders,
          timeout: 15000
        }
      );
    } catch (verifyError: any) {
      const errorDetail = verifyError.response
        ? JSON.stringify(verifyError.response.data)
        : verifyError.message;
      console.log(`[-] Failed to verify OTP: ${errorDetail}`);
      if (shouldCloseRl) rl.close();
      return false;
    }

    const tokenData = (verifyResponse.data?.data || verifyResponse.data || {}) as any;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const tokenExpiresIn = tokenData.expires_in || 86400;

    if (!accessToken) {
      console.log('[-] Verification succeeded but access_token was not found.');
      if (shouldCloseRl) rl.close();
      return false;
    }

    // 5. Fetch Merchant & Outlet Info
    console.log('[*] Fetching merchant & outlet info...');
    let merchantId: string | null = null;
    let outletName = 'Merchant GoPay';

    try {
      const configResponse = await axios.get(GOBIZ_USER_CONFIG_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'authentication-type': 'go-id',
          Origin: 'https://portal.gofoodmerchant.co.id',
          Referer: 'https://portal.gofoodmerchant.co.id/',
          'User-Agent': sessionHeaders['user-agent']
        },
        timeout: 10000
      });

      const configData = configResponse.data?.data || configResponse.data || {};
      const merchants = configData.merchants || [];
      const restaurants = configData.restaurants || [];
      const singleMerchant = configData.merchant || null;

      if (singleMerchant?.id) {
        merchantId = singleMerchant.id;
        outletName = singleMerchant.name || singleMerchant.brand_name || outletName;
      } else if (merchants.length > 0 && merchants[0]?.id) {
        merchantId = merchants[0].id;
        outletName = merchants[0].name || merchants[0].brand_name || outletName;
      } else if (restaurants.length > 0 && restaurants[0]?.id) {
        merchantId = restaurants[0].id;
        outletName = restaurants[0].name || restaurants[0].brand_name || outletName;
      }
    } catch {
      console.warn(
        '[!] Warning: Unable to fetch outlet name details from GoBiz (using default).'
      );
    }

    // 6. Save encrypted session
    const tokenExpirationIso = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();
    const cookieString = `access_token=${accessToken}; refresh_token=${
      refreshToken || ''
    }; auth_method=goid`;

    try {
      sessionManager.saveSession({
        phone_number: formattedInternationalPhone,
        merchant_id: merchantId,
        outlet_name: outletName,
        access_token: accessToken,
        refresh_token: refreshToken,
        cookie: cookieString,
        expires_at: tokenExpirationIso
      });
    } catch (saveError: any) {
      console.log(
        `[-] Failed to encrypt and save session file ${sessionManager.SESSION_FILE}: ${saveError.message}`
      );
      if (shouldCloseRl) rl.close();
      return false;
    }

    console.log('\n====================================================');
    console.log('   [SUCCESS] LOGIN SUCCESSFUL & SESSION ENCRYPTED!  ');
    console.log('====================================================');
    console.log(`Session File : gopay_session (AES-256-GCM Encrypted)`);
    console.log(`Master Key   : ${MASTER_KEY_FILE}`);
    console.log(`Phone Number : ${formattedInternationalPhone}`);
    console.log(`Merchant ID  : ${merchantId || '-'}`);
    console.log(`Outlet Name  : ${outletName}`);
    console.log(`Token Exp    : ${tokenExpirationIso}`);
    console.log('\nSession will be automatically refreshed by the gateway.\n');

    if (shouldCloseRl) rl.close();
    return true;
  } catch (unexpectedError: any) {
    console.error('[-] Unexpected error occurred:', unexpectedError.message);
    if (shouldCloseRl) rl.close();
    return false;
  }
}

export async function main(): Promise<void> {
  await runLoginFlow();
}

if (require.main === module) {
  main();
}
