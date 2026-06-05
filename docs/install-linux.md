# Install on Linux

## 1. Install Node.js or Bun

**Bun (recommended — faster):**
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # or ~/.zshrc
bun --version      # confirm: 1.1+
```

**Node.js via nvm:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install --lts
node --version     # confirm: 18+
```

**Node.js via package manager:**
```bash
# Ubuntu / Debian
sudo apt install nodejs npm

# Arch
sudo pacman -S nodejs npm

# Fedora / RHEL
sudo dnf install nodejs npm
```

## 2. Install clpzcode

```bash
npm install -g @clpz/clpzcode
```

Confirm:
```bash
clpzcode --version
```

## 3. Configure a provider

### xAI Grok (recommended)

Get your key at [console.x.ai](https://console.x.ai).

```bash
export XAI_API_KEY=your_key_here
clpzcode
```

To persist across sessions, add to your shell profile:
```bash
echo 'export XAI_API_KEY=your_key_here' >> ~/.bashrc  # or ~/.zshrc
source ~/.bashrc
```

Or authenticate interactively with OAuth (no key needed):
```bash
clpzcode
# type: /login xai
```

### Local model via Ollama (no API key required)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3

# Start clpzcode — select Ollama when prompted
clpzcode
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

clpzcode will run the full pipeline automatically.

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
