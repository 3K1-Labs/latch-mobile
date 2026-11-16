import Box from '@/src/components/shared/Box';
import React from 'react';

interface Props {
  currentStep: number;
  totalSteps: number;
}

/** Dots with the current step stretched into a green pill. */
const StepIndicator = ({ currentStep, totalSteps }: Props) => (
  <Box flexDirection="row" alignItems="center" justifyContent="flex-end" gap="xs" width={40}>
    {Array.from({ length: totalSteps }).map((_, index) => {
      const active = index + 1 === currentStep;
      return (
        <Box
          key={index}
          width={active ? 18 : 6}
          height={6}
          borderRadius={3}
          backgroundColor={active ? 'accentGreen' : 'inputOutline'}
        />
      );
    })}
  </Box>
);

export default StepIndicator;
