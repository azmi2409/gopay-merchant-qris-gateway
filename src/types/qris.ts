export interface EMVCoTag {
  tag: string;
  val: string;
}

export interface DynamicQRISResult {
  qris_payload: string;
  amount: number;
}
