import { VerifiedIAP } from '../types';
import { VerificationResult } from './verifier';

const disabledPaymentError = () =>
  new Error('OpenReadest has disabled in-app purchase services.');

export type VerifiedPurchase = VerifiedIAP & {
  transactionId: string;
  originalTransactionId: string;
  purchaseDate?: string;
  expiresDate?: string | null;
  quantity: number;
  environment: string;
  bundleId: string;
  webOrderLineItemId?: string;
  subscriptionGroupIdentifier?: string;
  type?: string;
  revocationDate?: string | null;
  revocationReason?: number | null;
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
  verificationResult: VerificationResult,
): Promise<VerifiedPurchase> {
  void user;
  void verificationResult;
  throw disabledPaymentError();
}
