# Install on macOS

## 1. Install Node.js or Bun

**Bun (recommended — faster):**
```bash
curl -fsSL https://bun.sh/install | bash
# Restart terminal, then:
bun --version      # confirm: 1.1+
```

**Node.js via Homebrew:**
```bash
# Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
node --version     # confirm: 18+
```

**Node.js via nvm:**
```bash
brew install nvm
nvm install --lts
```

## 2. Install clpzcode

```bash
npm install -g @clpz/clpzcode
```

Confirm:
```bash
clpzcode --version
```

> **Note:** If you get a permission error, run `sudo npm install -g @clpz/clpzcode` or configure npm to use a user directory.

## 3. Configure a provider

### xAI Grok (recommended)

Get your key at [console.x.ai](https://console.x.ai).

```bash
export XAI_API_KEY=your_key_here
clpzcode
```

To persist across sessions:
```bash
echo 'export XAI_API_KEY=your_key_here' >> ~/.zshrc
source ~/.zshrc
```

Or authenticate with OAuth (no key needed):
```bash
clpzcode
# type: /login xai
```

### Local model via Ollama (no API key required)

```bash
brew install ollama
ollama serve &       # start Ollama in background
ollama pull llama3

clpzcode             # select Ollama when prompted
```

### OpenAI

```bash
export OPENAI_API_KEY=your_key_here
clpzcode
```

## 4. Run your first pentest

```bash
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

## Build from source

```bash
git clone https://github.com/clpzbug/clpzcode
cd clpzcode
bun install
bun run build
./bin/clpzcode
```
