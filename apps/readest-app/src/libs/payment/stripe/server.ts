import { PaymentStatus } from '@/types/payment';

const disabledPaymentError = () =>
  new Error('OpenReadest has disabled Stripe payment and subscription services.');

export const getStripe = () => {
  throw disabledPaymentError();
};

export const createOrUpdateSubscription = async (
  userId: string,
  customerId: string,
  subscriptionId: string,
) => {
  void userId;
  void customerId;
  void subscriptionId;
  throw disabledPaymentError();
};

export const COMPLETED_PAYMENT_STATUSES: PaymentStatus[] = ['completed', 'succeeded'];

export const createOrUpdatePayment = async (
  userId: string,
  customerId: string,
  checkoutSessionId: string,
) => {
  void userId;
  void customerId;
  void checkoutSessionId;
  throw disabledPaymentError();
};
