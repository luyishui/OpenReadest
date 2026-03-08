import { useEffect, useState } from 'react';
import { AvailablePlan } from '@/types/quota';
import { stubTranslation as _ } from '@/utils/misc';

interface UseAvailablePlansParams {
  hasIAP: boolean;
  onError?: (message: string) => void;
}

export const useAvailablePlans = ({ hasIAP, onError }: UseAvailablePlansParams) => {
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [iapAvailable, setIapAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const disabledError = new Error('Subscription and payment flows are disabled in OpenReadest.');
    setAvailablePlans([]);
    setIapAvailable(false);
    setError(disabledError);
    if (onError) {
      onError(_('Failed to load subscription plans.'));
    }
    setLoading(false);
  }, [hasIAP, onError]);

  return { availablePlans, iapAvailable, loading, error };
};
