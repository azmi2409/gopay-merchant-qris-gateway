import { calculateCRC16 } from './crc16';
import { EMVCoTag } from '../types/qris';

/**
 * Parses an EMVCo QRIS payload string into an array of TLV (Tag-Length-Value) tokens.
 *
 * @param payload The raw QRIS string
 * @returns Array of parsed EMVCoTag objects
 */
export function parseEMVCoTags(payload: string): EMVCoTag[] {
  if (!payload) return [];
  let cleanPayload = payload.trim();

  // Strip existing Tag 63 (CRC) if present
  const idx63 = cleanPayload.indexOf('6304');
  if (idx63 !== -1) {
    cleanPayload = cleanPayload.substring(0, idx63);
  }

  const tags: EMVCoTag[] = [];
  let i = 0;
  try {
    while (i < cleanPayload.length) {
      const tag = cleanPayload.substring(i, i + 2);
      const length = parseInt(cleanPayload.substring(i + 2, i + 4), 10);
      if (isNaN(length) || length < 0) break;
      const val = cleanPayload.substring(i + 4, i + 4 + length);
      if (val.length !== length) break;
      tags.push({ tag, val });
      i += 4 + length;
    }
  } catch {
    return [];
  }

  return tags;
}

/**
 * Converts a static QRIS template into a dynamic QRIS string with a specified amount
 * according to the ASPI / Bank Indonesia EMVCo QRIS specification.
 *
 * - Updates Tag 01 (Point of Initiation Method) from '11' (Static) to '12' (Dynamic)
 * - Injects or updates Tag 54 (Transaction Amount)
 * - Computes and appends Tag 63 with a valid CRC16-CCITT checksum
 *
 * @param staticTemplate The static QRIS string
 * @param amount The payment amount in IDR
 * @returns The new dynamic QRIS string or null if invalid
 */
export function generateDynamicQRIS(
  staticTemplate: string | undefined | null,
  amount: number | string
): string | null {
  if (!staticTemplate || !amount) return null;

  const parsedAmount = typeof amount === 'number' ? amount : parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount <= 0) return null;

  const tags = parseEMVCoTags(staticTemplate);
  if (tags.length === 0) return null;

  const amountStr = parsedAmount.toString();
  const newTags: EMVCoTag[] = [];
  let hasTag54 = false;

  for (const item of tags) {
    if (item.tag === '01') {
      // Change Static (11) to Dynamic (12)
      newTags.push({ tag: '01', val: '12' });
    } else if (item.tag === '54') {
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
    } else if (item.tag === '58' && !hasTag54) {
      // By standard, Tag 54 precedes Tag 58 (Country Code 'ID')
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
      newTags.push(item);
    } else {
      newTags.push(item);
    }
  }

  if (!hasTag54) {
    newTags.push({ tag: '54', val: amountStr });
  }

  let result = '';
  for (const item of newTags) {
    const lenStr = item.val.length.toString().padStart(2, '0');
    result += `${item.tag}${lenStr}${item.val}`;
  }

  result += '6304';
  const checksum = calculateCRC16(result);
  return result + checksum;
}
