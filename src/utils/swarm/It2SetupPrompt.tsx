import React, { useCallback, useEffect, useState } from 'react';
import { type OptionWithDescription, Select } from '../../components/CustomSelect/index.js';
import { Pane } from '../../components/design-system/Pane.js';
import { Spinner } from '../../components/Spinner.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to proceed through setup steps
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { detectPythonPackageManager, getPythonApiInstructions, installIt2, markIt2SetupComplete, type PythonPackageManager, setPreferTmuxOverIterm2, verifyIt2Setup } from './backends/it2Setup.js';
type SetupStep = 'initial' | 'installing' | 'install-failed' | 'verify-api' | 'api-instructions' | 'verifying' | 'success' | 'failed';
type Props = {
  onDone: (result: 'installed' | 'use-tmux' | 'cancelled') => void;
  tmuxAvailable: boolean;
};
export function It2SetupPrompt({
  onDone,
  tmuxAvailable
}: Props) {
  const [step, setStep] = useState<SetupStep>("initial");
  const [packageManager, setPackageManager] = useState<PythonPackageManager | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exitState = useExitOnCtrlCDWithKeybindings();
  useEffect(() => {
    detectPythonPackageManager().then(pm => {
      setPackageManager(pm);
    });
  }, []);
  const handleCancel = useCallback(() => {
    onDone("cancelled");
  }, [onDone]);
  useKeybinding("confirm:no", handleCancel, {
    context: "Confirmation",
    isActive: step !== "installing" && step !== "verifying"
  });
  useInput((_input, key) => {
    if (step === "api-instructions" && key.return) {
      setStep("verifying");
      verifyIt2Setup().then(result => {
        if (result.success) {
          markIt2SetupComplete();
          setStep("success");
          setTimeout(onDone, 1500, "installed" as const);
        } else {
          setError(result.error || "Verification failed");
          setStep("failed");
        }
      });
    }
  });
  const handleInstall = useCallback(async function handleInstall() {
    if (!packageManager) {
      setError("No Python package manager found (uvx, pipx, or pip)");
      setStep("failed");
      return;
    }
    setStep("installing");
    const result = await installIt2(packageManager);
    if (result.success) {
      setStep("api-instructions");
    } else {
      setError(result.error || "Installation failed");
      setStep("install-failed");
    }
  }, [packageManager]);
  const handleUseTmux = useCallback(function handleUseTmux() {
    setPreferTmuxOverIterm2(true);
    onDone("use-tmux");
  }, [onDone]);
  const renderContent = () => {
    switch (step) {
      case "initial":
        {
          return renderInitialPrompt();
        }
      case "installing":
        {
          return renderInstalling();
        }
      case "install-failed":
        {
          return renderInstallFailed();
        }
      case "api-instructions":
        {
          return renderApiInstructions();
        }
      case "verifying":
        {
          return renderVerifying();
        }
      case "success":
        {
          return renderSuccess();
        }
      case "failed":
        {
          return renderFailed();
        }
      default:
        {
          return null;
        }
    }
  };
  function renderInitialPrompt() {
    const options: OptionWithDescription[] = [{
      label: "Install it2 now",
      value: "install",
      description: packageManager ? `Uses ${packageManager} to install the it2 CLI tool` : "Requires Python (uvx, pipx, or pip)"
    }];
    if (tmuxAvailable) {
      options.push({
        label: "Use tmux instead",
        value: "tmux",
        description: "Opens teammates in a separate tmux session"
      });
    }
    options.push({
      label: "Cancel",
      value: "cancel",
      description: "Skip teammate spawning for now"
    });
    return <Box flexDirection="column" gap={1}><Text>To use native iTerm2 split panes for teammates, you need the{" "}<Text bold={true}>it2</Text> CLI tool.</Text><Text dimColor={true}>This enables teammates to appear as split panes within your current window.</Text><Box marginTop={1}><Select options={options} onChange={value => {
          bb61: switch (value) {
            case "install":
              {
                handleInstall();
                break bb61;
              }
            case "tmux":
              {
                handleUseTmux();
                break bb61;
              }
            case "cancel":
              {
                onDone("cancelled");
              }
          }
        }} onCancel={() => onDone("cancelled")} /></Box></Box>;
  }
  function renderInstalling() {
    return <Box flexDirection="column" gap={1}><Box><Spinner /><Text> Installing it2 using {packageManager}…</Text></Box><Text dimColor={true}>This may take a moment.</Text></Box>;
  }
  function renderInstallFailed() {
    const options: OptionWithDescription[] = [{
      label: "Try again",
      value: "retry",
      description: "Retry the installation"
    }];
    if (tmuxAvailable) {
      options.push({
        label: "Use tmux instead",
        value: "tmux",
        description: "Falls back to tmux for teammate panes"
      });
    }
    options.push({
      label: "Cancel",
      value: "cancel",
      description: "Skip teammate spawning for now"
    });
    return <Box flexDirection="column" gap={1}><Text color="error">Installation failed</Text>{error && <Text dimColor={true}>{error}</Text>}<Text dimColor={true}>You can try installing manually:{" "}{packageManager === "uvx" ? "uv tool install it2" : packageManager === "pipx" ? "pipx install it2" : "pip install --user it2"}</Text><Box marginTop={1}><Select options={options} onChange={value => {
          bb89: switch (value) {
            case "retry":
              {
                handleInstall();
                break bb89;
              }
            case "tmux":
              {
                handleUseTmux();
                break bb89;
              }
            case "cancel":
              {
                onDone("cancelled");
              }
          }
        }} onCancel={() => onDone("cancelled")} /></Box></Box>;
  }
  function renderApiInstructions() {
    const instructions = getPythonApiInstructions();
    return <Box flexDirection="column" gap={1}><Text color="success">✓ it2 installed successfully</Text><Box flexDirection="column" marginTop={1}>{instructions.map(_temp)}</Box><Box marginTop={1}><Text dimColor={true}>Press Enter when ready to verify…</Text></Box></Box>;
  }
  function renderVerifying() {
    return <Box><Spinner /><Text> Verifying it2 can communicate with iTerm2…</Text></Box>;
  }
  function renderSuccess() {
    return <Box flexDirection="column"><Text color="success">✓ iTerm2 split pane support is ready</Text><Text dimColor={true}>Teammates will now appear as split panes.</Text></Box>;
  }
  function renderFailed() {
    const options: OptionWithDescription[] = [{
      label: "Try again",
      value: "retry",
      description: "Verify the connection again"
    }];
    if (tmuxAvailable) {
      options.push({
        label: "Use tmux instead",
        value: "tmux",
        description: "Falls back to tmux for teammate panes"
      });
    }
    options.push({
      label: "Cancel",
      value: "cancel",
      description: "Skip teammate spawning for now"
    });
    return <Box flexDirection="column" gap={1}><Text color="error">Verification failed</Text>{error && <Text dimColor={true}>{error}</Text>}<Text>Make sure:</Text><Box flexDirection="column" paddingLeft={2}><Text>· Python API is enabled in iTerm2 preferences</Text><Text>· You may need to restart iTerm2 after enabling</Text></Box><Box marginTop={1}><Select options={options} onChange={value => {
          bb115: switch (value) {
            case "retry":
              {
                setStep("verifying");
                verifyIt2Setup().then(result => {
                  if (result.success) {
                    markIt2SetupComplete();
                    setStep("success");
                    setTimeout(onDone, 1500, "installed" as const);
                  } else {
                    setError(result.error || "Verification failed");
                    setStep("failed");
                  }
                });
                break bb115;
              }
            case "tmux":
              {
                handleUseTmux();
                break bb115;
              }
            case "cancel":
              {
                onDone("cancelled");
              }
          }
        }} onCancel={() => onDone("cancelled")} /></Box></Box>;
  }
  return <Pane color="permission"><Box flexDirection="column" gap={1} paddingBottom={1}><Text bold={true} color="permission">iTerm2 Split Pane Setup</Text>{renderContent()}{step !== "installing" && step !== "verifying" && step !== "success" && <Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Esc to cancel</>}</Text>}</Box></Pane>;
}
function _temp(line: string, i: number) {
  return <Text key={i}>{line}</Text>;
}
