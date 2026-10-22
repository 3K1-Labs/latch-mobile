import { useQuery } from '@tanstack/react-query';

import { getUsdFxRates } from '@/src/api/fx-rates';

export function useFxRates() {
  return useQuery({
    queryKey: ['fx-rates', 'USD'],
    queryFn: getUsdFxRates,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}
