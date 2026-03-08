import { StripeProductMetadata } from '@/types/payment';
import { AvailablePlan, PlanType } from '@/types/quota';

const disabledPaymentError = () =>
  new Error('OpenReadest has disabled Stripe payment and subscription services.');

export const getStripe = () => {
  return Promise.resolve(null);
};
const SUBSCRIPTION_SUCCESS_PATH = '/user/subscription/success';

export interface StripeCheckoutResponse {
  sessionId?: string;
  clientSecret?: string;
  url?: string;
}

export type StripeAvailablePlan = AvailablePlan & {
  metadata?: StripeProductMetadata;
  product?: unknown;
};

export const fetchStripePlans = async () => {
  return [] as StripeAvailablePlan[];
};

export const createStripeCheckoutSession = async (
  productId: string,
  planType: PlanType = 'subscription',
): Promise<StripeCheckoutResponse> => {
  void productId;
  void planType;
  throw disabledPaymentError();
};

export const redirectToStripeCheckout = async (sessionId?: string, url?: string): Promise<void> => {
  void sessionId;
  void url;
  throw disabledPaymentError();
};

export const createStripePortalSession = async () => {
  throw disabledPaymentError();
};

export const redirectToStripePortal = async (url: string): Promise<void> => {
  void url;
  throw disabledPaymentError();
};

export const handleStripeCheckoutError = (error: string) => {
  console.error(error);
};

export const getSubscriptionSuccessUrl = (sessionId: string) => {
  const params = new URLSearchParams({
    payment: 'stripe',
    session_id: sessionId,
  });
  return `${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`;
};
