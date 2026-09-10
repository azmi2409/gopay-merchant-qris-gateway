import { describe, it, expect } from 'vitest';
import { calculateCRC16 } from '../src/utils/crc16';
import { parseEMVCoTags, generateDynamicQRIS } from '../src/utils/qris';

describe('EMVCo CRC16 Checksum', () => {
  it('should calculate valid 4-digit hexadecimal CRC16 checksum', () => {
    // Standard test with arbitrary string
    const checksum = calculateCRC16('0002010102126304');
    expect(checksum).toHaveLength(4);
    expect(/^[0-9A-F]{4}$/.test(checksum)).toBe(true);
  });

  it('should be deterministic for the same input', () => {
    const input = '00020101021153033605802ID5909Merchant6007Jakarta6304';
    const c1 = calculateCRC16(input);
    const c2 = calculateCRC16(input);
    expect(c1).toBe(c2);
  });
});

describe('EMVCo TLV Parsing', () => {
  const sampleStaticQRIS =
    '00020101021153033605802ID5913TEST MERCHANT6007JAKARTA63042E07';

  it('should parse TLV tags correctly', () => {
    const tags = parseEMVCoTags(sampleStaticQRIS);
    expect(tags.length).toBeGreaterThan(0);

    const tag00 = tags.find((t) => t.tag === '00');
    expect(tag00).toBeDefined();
    expect(tag00?.val).toBe('01'); // Format indicator

    const tag01 = tags.find((t) => t.tag === '01');
    expect(tag01).toBeDefined();
    expect(tag01?.val).toBe('11'); // Static

    const tag58 = tags.find((t) => t.tag === '58');
    expect(tag58).toBeDefined();
    expect(tag58?.val).toBe('ID'); // Country code
  });

  it('should return empty array for empty or corrupt payload', () => {
    expect(parseEMVCoTags('')).toEqual([]);
    expect(parseEMVCoTags('CORRUPT_NOT_TLV')).toEqual([]);
  });
});

describe('Dynamic QRIS Generation', () => {
  const sampleStaticQRIS =
    '00020101021153033605802ID5913TEST MERCHANT6007JAKARTA63042E07';

  it('should convert static QRIS to dynamic QRIS with Tag 54 amount', () => {
    const amount = 50000;
    const dynamicQRIS = generateDynamicQRIS(sampleStaticQRIS, amount);

    expect(dynamicQRIS).not.toBeNull();
    expect(typeof dynamicQRIS).toBe('string');

    const parsed = parseEMVCoTags(dynamicQRIS!);
    // Tag 01 should now be '12' (Dynamic)
    const tag01 = parsed.find((t) => t.tag === '01');
    expect(tag01?.val).toBe('12');

    // Tag 54 should exist with value '50000'
    const tag54 = parsed.find((t) => t.tag === '54');
    expect(tag54).toBeDefined();
    expect(tag54?.val).toBe('50000');

    // Checksum at the end should match calculated CRC16
    const withoutCRC = dynamicQRIS!.substring(0, dynamicQRIS!.length - 4);
    const expectedCRC = calculateCRC16(withoutCRC);
    const actualCRC = dynamicQRIS!.substring(dynamicQRIS!.length - 4);
    expect(actualCRC).toBe(expectedCRC);
  });

  it('should reject invalid amounts', () => {
    expect(generateDynamicQRIS(sampleStaticQRIS, 0)).toBeNull();
    expect(generateDynamicQRIS(sampleStaticQRIS, -500)).toBeNull();
    expect(generateDynamicQRIS(sampleStaticQRIS, NaN)).toBeNull();
    expect(generateDynamicQRIS('', 50000)).toBeNull();
  });
});
