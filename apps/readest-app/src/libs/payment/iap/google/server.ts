import { VerifiedIAP } from '../types';
import {
  VerificationResult,
  VerifyPurchaseParams,
} from './verifier';

const disabledPaymentError = () =>
  new Error('OpenReadest has disabled in-app purchase services.');

export type VerifiedPurchase = VerifiedIAP & {
  purchaseToken: string;
  purchaseDate?: string;
  expiresDate?: string | null;
  quantity: number;
  environment: string;
  packageName: string;
  purchaseState?: number | null;
  acknowledgementState?: number | null;
  autoRenewing?: boolean | null;
  priceAmountMicros?: string | null;
  priceCurrencyCode?: string | null;
  countryCode?: string | null;
  developerPayload?: string | null;
  linkedPurchaseToken?: string | null;
  obfuscatedExternalAccountId?: string | null;
  obfuscatedExternalProfileId?: string | null;
  cancelReason?: number | null;
  userCancellationTimeMillis?: string | null;
};

export async function createOrUpdateSubscription(userId: string, purchase: VerifiedPurchase) {
  void userId;
  void purchase;
  throw disabledPaymentError();
}

export async function createOrUpdatePayment(userId: string, purchase: VerifiedPurchase) {
  void userId;
  void purchase;
  throw disabledPaymentError();
}

export async function processPurchaseData(
  user: { id: string; email?: string | undefined },
  verifyParams: VerifyPurchaseParams,
  verificationResult: VerificationResult,
): Promise<VerifiedPurchase> {
  void user;
  void verifyParams;
  void verificationResult;
  throw disabledPaymentError();
}
