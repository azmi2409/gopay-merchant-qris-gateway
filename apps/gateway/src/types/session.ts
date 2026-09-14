export interface GoPaySession {
  phone_number?: string | null;
  merchant_id?: string | null;
  outlet_name?: string | null;
  device_id?: string | null;
  access_token: string | null;
  refresh_token: string | null;
  cookie: string | null;
  updated_at: string;
  expires_at: string | null;
}

export interface GoBizTokenResponse {
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface GoBizOtpRequestResponse {
  success?: boolean;
  data?: {
    otp_token?: string;
    expires_in?: number;
  };
  errors?: Array<{
    code: string;
    message: string;
  }>;
}
