import React, { createContext, type ReactNode, useEffect, useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { WizardContextValue, WizardProviderProps } from './types.js';

// Use any here for the context since it will be cast properly when used
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WizardContext = createContext<WizardContextValue<any> | null>(null);

export function WizardProvider({
  steps,
  initialData = {} as unknown,
  onComplete,
  onCancel,
  children,
  title,
  showStepCounter = true
}: WizardProviderProps): ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [wizardData, setWizardData] = useState(initialData);
  const [isCompleted, setIsCompleted] = useState(false);
  const [navigationHistory, setNavigationHistory] = useState<number[]>([]);
  useExitOnCtrlCDWithKeybindings();

  useEffect(() => {
    if (isCompleted) {
      setNavigationHistory([]);
      onComplete(wizardData);
    }
  }, [isCompleted, wizardData, onComplete]);

  const goNext = () => {
    if (currentStepIndex < steps.length - 1) {
      if (navigationHistory.length > 0) {
        setNavigationHistory(prev => [...prev, currentStepIndex]);
      }
      setCurrentStepIndex(prev => prev + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const goBack = () => {
    if (navigationHistory.length > 0) {
      const previousStep = navigationHistory[navigationHistory.length - 1];
      if (previousStep !== undefined) {
        setNavigationHistory(prev => prev.slice(0, -1));
        setCurrentStepIndex(previousStep);
      }
    } else {
      if (currentStepIndex > 0) {
        setCurrentStepIndex(prev => prev - 1);
      } else {
        if (onCancel) {
          onCancel();
        }
      }
    }
  };

  const goToStep = (index: number) => {
    if (index >= 0 && index < steps.length) {
      setNavigationHistory(prev => [...prev, currentStepIndex]);
      setCurrentStepIndex(index);
    }
  };

  const cancel = () => {
    setNavigationHistory([]);
    if (onCancel) {
      onCancel();
    }
  };

  const updateWizardData = (updates: object) => {
    setWizardData((prev: object) => ({
      ...prev,
      ...updates
    }));
  };

  const contextValue = {
    currentStepIndex,
    totalSteps: steps.length,
    wizardData,
    setWizardData,
    updateWizardData,
    goNext,
    goBack,
    goToStep,
    cancel,
    title,
    showStepCounter
  };

  const CurrentStepComponent = steps[currentStepIndex];
  if (!CurrentStepComponent || isCompleted) {
    return null;
  }

  return <WizardContext.Provider value={contextValue}>{children || <CurrentStepComponent />}</WizardContext.Provider>;
}
