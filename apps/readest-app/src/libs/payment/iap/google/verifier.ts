import { IAPStatus } from '../types';

export interface VerifyPurchaseParams {
  orderId: string;
  purchaseToken: string;
  productId: string;
  packageName: string;
}

export interface SubscriptionPurchase {
  kind?: string | null;
  startTimeMillis?: string | null;
  expiryTimeMillis?: string | null;
  autoRenewing?: boolean | null;
  priceCurrencyCode?: string | null;
  priceAmountMicros?: string | null;
  countryCode?: string | null;
  developerPayload?: string | null;
  paymentState?: number | null;
  cancelReason?: number | null;
  userCancellationTimeMillis?: string | null;
  orderId?: string | null;
  linkedPurchaseToken?: string | null;
  purchaseType?: number | null;
  acknowledgementState?: number | null;
  purchaseState?: number | null;
  quantity?: number | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
}

export interface ProductPurchase {
  kind?: string | null;
  purchaseTimeMillis?: string | null;
  purchaseState?: number | null;
  consumptionState?: number | null;
  developerPayload?: string | null;
  orderId?: string | null;
  purchaseType?: number | null;
  acknowledgementState?: number | null;
  purchaseToken?: string | null;
  productId?: string | null;
  quantity?: number | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
  regionCode?: string | null;
}

type PurchaseType = 'subscription' | 'product';

export interface VerificationResult {
  success: boolean;
  error?: string;
  status?: IAPStatus;
  purchaseDate?: Date;
  expiresDate?: Date | null;
  revocationDate?: Date | null;
  revocationReason?: number | null;
  purchaseData?: SubscriptionPurchase | ProductPurchase;
  purchaseType?: PurchaseType;
}

const createDisabledIAPError = () =>
  new Error('OpenReadest has disabled Google Play in-app purchase verification services.');

export class GoogleIAPVerifier {
  constructor() {
  }

  async verifyPurchase(params: VerifyPurchaseParams): Promise<VerificationResult> {
    void params;
    return {
      success: false,
      error: createDisabledIAPError().message,
    };
  }

  async acknowledgePurchase(params: VerifyPurchaseParams): Promise<void> {
    void params;
    throw createDisabledIAPError();
  }

  async cancelSubscription(params: VerifyPurchaseParams): Promise<void> {
    void params;
    throw createDisabledIAPError();
  }

  async refundSubscription(params: VerifyPurchaseParams): Promise<void> {
    void params;
    throw createDisabledIAPError();
  }

  async deferSubscription(
    params: VerifyPurchaseParams & {
      desiredExpiryTimeMillis: string;
    },
  ): Promise<void> {
    void params;
    throw createDisabledIAPError();
  }
}

// Singleton instance
let verifierInstance: GoogleIAPVerifier | null = null;

export function getGoogleIAPVerifier(): GoogleIAPVerifier {
  if (!verifierInstance) {
    verifierInstance = new GoogleIAPVerifier();
  }
  return verifierInstance;
}
