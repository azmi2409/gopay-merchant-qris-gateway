export type QRISStatus = 'PENDING' | 'PAID' | 'EXPIRED';

export interface VerifiedPayment {
  transaction_id: string;
  order_id?: string;
  amount: number;
  raw_amount: number;
  payer_issuer: string;
  payment_type: string;
  transaction_time: string;
}

export interface ClaimedTransactionRecord {
  qrisId: string | null;
  claimedAt: number;
}

export interface QRISRecord {
  id: string;
  trxId?: string;
  amount: number;
  data: string;
  reference?: string | null;
  attributes?: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date;
  status: QRISStatus;
  transaction?: VerifiedPayment | null;
}

export interface ActivityLog {
  id: number;
  timestamp: string;
  type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'SYSTEM';
  message: string;
  details?: unknown;
}
