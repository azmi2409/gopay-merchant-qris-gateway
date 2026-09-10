import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchTransaction,
  claimedTransactions,
  cleanExpiredTransactions,
  CLAIMED_CLEANUP_INTERVAL_MS
} from '../src/services/paymentService';
import { GoPayRawTransaction } from '../src/types/gopay';

describe('Payment Matching Service', () => {
  beforeEach(() => {
    claimedTransactions.clear();
  });

  const baseTime = Date.now();
  const sampleTransactions: GoPayRawTransaction[] = [
    {
      id: 'TX-GOPAY-1001',
      order_id: 'ORDER-1001',
      gross_amount: 5000000, // 50,000 IDR in sen (x100)
      transaction_status: 'SETTLEMENT',
      transaction_time: new Date(baseTime).toISOString(),
      qris_provider_aspi_issuer: 'BCA'
    },
    {
      id: 'TX-GOPAY-1002',
      order_id: 'ORDER-1002',
      gross_amount: 25000, // direct rupiah
      transaction_status: 'SETTLEMENT',
      transaction_time: new Date(baseTime).toISOString(),
      qris_provider_aspi_issuer: 'GoPay'
    }
  ];

  it('should match transaction with x100 sen currency scaling', () => {
    const matched = matchTransaction(sampleTransactions, 50000, baseTime - 1000, 'QRIS-A');
    expect(matched).not.toBeNull();
    expect(matched?.transaction_id).toBe('TX-GOPAY-1001');
    expect(matched?.amount).toBe(50000);
    expect(matched?.payer_issuer).toBe('BCA');
  });

  it('should match direct rupiah amounts without scaling', () => {
    const matched = matchTransaction(sampleTransactions, 25000, baseTime - 1000, 'QRIS-B');
    expect(matched).not.toBeNull();
    expect(matched?.transaction_id).toBe('TX-GOPAY-1002');
    expect(matched?.amount).toBe(25000);
  });

  it('should prevent double-claiming by another QRIS ID', () => {
    // First claim by QRIS-A
    const firstClaim = matchTransaction(sampleTransactions, 50000, baseTime - 1000, 'QRIS-A');
    expect(firstClaim).not.toBeNull();
    expect(firstClaim?.transaction_id).toBe('TX-GOPAY-1001');

    // Attempt to claim same transaction by QRIS-B
    const secondClaim = matchTransaction(sampleTransactions, 50000, baseTime - 1000, 'QRIS-B');
    expect(secondClaim).toBeNull();
  });

  it('should allow re-checking by the same QRIS ID', () => {
    // First claim
    const first = matchTransaction(sampleTransactions, 50000, baseTime - 1000, 'QRIS-A');
    expect(first).not.toBeNull();

    // Repeat check from same QRIS
    const second = matchTransaction(sampleTransactions, 50000, baseTime - 1000, 'QRIS-A');
    expect(second).not.toBeNull();
    expect(second?.transaction_id).toBe('TX-GOPAY-1001');
  });

  it('should ignore transactions before filterStartTimeMs', () => {
    const oldTransaction: GoPayRawTransaction[] = [
      {
        id: 'TX-OLD-1',
        gross_amount: 5000000,
        transaction_time: new Date(baseTime - 100000).toISOString()
      }
    ];

    const matched = matchTransaction(oldTransaction, 50000, baseTime, 'QRIS-NEW');
    expect(matched).toBeNull();
  });

  it('should clean up expired claimed transactions properly', () => {
    const oldTime = Date.now() - CLAIMED_CLEANUP_INTERVAL_MS - 1000;
    claimedTransactions.set('OLD-TX', { qrisId: 'Q1', claimedAt: oldTime });
    claimedTransactions.set('NEW-TX', { qrisId: 'Q2', claimedAt: Date.now() });

    const cleanedCount = cleanExpiredTransactions();
    expect(cleanedCount).toBe(1);
    expect(claimedTransactions.has('OLD-TX')).toBe(false);
    expect(claimedTransactions.has('NEW-TX')).toBe(true);
  });
});
