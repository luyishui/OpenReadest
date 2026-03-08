import { PlanType } from '@/types/quota';
import { IAPError, IAPStatus } from '../types';

export interface AppleIAPConfig {
  keyId: string;
  issuerId: string;
  bundleId: string;
  privateKey: string;
  environment: 'sandbox' | 'production';
}

export interface VerificationResult {
  success: boolean;
  verified?: boolean;
  status?: IAPStatus;
  planType?: PlanType;
  transaction?: unknown;
  environment?: string;
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: Date;
  expiresDate?: Date | null;
  quantity?: number;
  type?: string;
  revocationDate?: Date | null;
  revocationReason?: number;
  webOrderLineItemId?: string;
  subscriptionGroupIdentifier?: string;
  error?: string;
}

const createDisabledIAPError = () =>
  new Error('OpenReadest has disabled Apple in-app purchase verification services.');

export class AppleIAPVerifier {
  private bundleId: string;
  private environment: 'sandbox' | 'production';

  constructor(config: AppleIAPConfig) {
    this.bundleId = config.bundleId;
    this.environment = config.environment;
    void config;
  }

  async verifyTransaction(originalTransactionId: string): Promise<VerificationResult> {
    void originalTransactionId;
    return {
      success: false,
      verified: false,
      bundleId: this.bundleId,
      environment: this.environment,
      error: createDisabledIAPError().message || IAPError.UNKNOWN_ERROR,
    };
  }
}

export const createAppleIAPVerifier = (config: AppleIAPConfig) => new AppleIAPVerifier(config);

let defaultIAPVerifier: AppleIAPVerifier | undefined;
export const getAppleIAPVerifier = () => {
  if (!defaultIAPVerifier) {
    defaultIAPVerifier = createAppleIAPVerifier({
      keyId: process.env['APPLE_IAP_KEY_ID']!,
      issuerId: process.env['APPLE_IAP_ISSUER_ID']!,
      bundleId: process.env['APPLE_IAP_BUNDLE_ID']!,
      privateKey: Buffer.from(
        process.env['APPLE_IAP_PRIVATE_KEY_BASE64']! || '',
        'base64',
      ).toString('utf-8'),
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    });
  }
  return defaultIAPVerifier;
};
