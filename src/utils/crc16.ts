/**
 * Calculate EMVCo standard CRC16-CCITT checksum for QRIS payloads.
 * Polynomial: 0x1021, Initial Value: 0xFFFF
 *
 * @param payload The QRIS string excluding the 4-hex-digit checksum
 * @returns 4-character uppercase hexadecimal string
 */
export function calculateCRC16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
