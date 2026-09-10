export interface GoPayRawTransaction {
  id?: string;
  order_id?: string;
  wallstreet_transaction_id?: string;
  gross_amount?: number | string;
  real_gross_amount?: number | string;
  amount?: {
    value?: number | string;
  } | number | string;
  transaction_status?: string;
  transaction_time?: string;
  settlement_time?: string;
  created_at?: string;
  time?: string;
  qris_provider_aspi_issuer?: string;
  payment_type?: string;
  transaction_source?: string;
}

export interface GoPayTransactionsResponse {
  transactions?: GoPayRawTransaction[];
  data?: {
    transactions?: GoPayRawTransaction[];
  } | GoPayRawTransaction[];
}

export interface FormattedTransaction {
  amount: number;
  gross_amount_raw: number;
  status: string;
  time: string;
  issuer: string;
  order_id?: string;
  transaction_id?: string;
}
