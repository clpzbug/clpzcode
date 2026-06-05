# Install on Windows

## 1. Install Node.js

Download the LTS installer from [nodejs.org](https://nodejs.org) and run it.

Or install via **winget**:
```powershell
winget install OpenJS.NodeJS.LTS
```

Or via **Chocolatey**:
```powershell
choco install nodejs-lts
```

Confirm:
```powershell
node --version   # should be 18+
npm --version
```

## 2. Install Bun (optional, faster)

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Restart your terminal after installation.

## 3. Install clpzcode

```powershell
npm install -g @clpz/clpzcode
```

Confirm:
```powershell
clpzcode --version
```

> **Note:** If you get an execution policy error, run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

## 4. Configure a provider

### xAI Grok (recommended)

Get your key at [console.x.ai](https://console.x.ai).

**PowerShell (current session):**
```powershell
$env:XAI_API_KEY = "your_key_here"
clpzcode
```

**Persist permanently (System Environment Variables):**
```powershell
[System.Environment]::SetEnvironmentVariable("XAI_API_KEY", "your_key_here", "User")
```
Then restart your terminal.

Or authenticate with OAuth inside the app (no key needed):
```
> /login xai
```

### Local model via Ollama (no API key required)

Download Ollama from [ollama.com](https://ollama.com/download/windows).

```powershell
ollama pull llama3
clpzcode    # select Ollama when prompted
```

### OpenAI

```powershell
$env:OPENAI_API_KEY = "your_key_here"
clpzcode
```

## 5. Run your first pentest

```powershell
clpzcode
```

Inside the session:
```
> target: https://app.example.com
```

## Useful shortcuts

| Key | Action |
|---|---|
| `ctrl+t` | Open activity tray (agents, shells) |
| `ctrl+o` | Expand last tool result |
| `ctrl+c` | Stop current operation |
| `/model` | Switch model mid-session |
| `/provider` | Change API provider |

## Recommended terminal

clpzcode runs best in [Windows Terminal](https://aka.ms/terminal) — download it from the Microsoft Store. Avoid running inside old `cmd.exe`.

## Build from source

```powershell
git clone https://github.com/clpzbug/clpzcode
cd clpzcode
bun install
bun run build
.\bin\clpzcode
```
