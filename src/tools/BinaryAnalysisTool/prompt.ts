import { BINARY_ANALYSIS_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Binary analysis: file info, symbols, strings, hex dump, disassembly, and security protections.`

export const PROMPT = `## ${BINARY_ANALYSIS_TOOL_NAME} — Binary analysis toolkit

### ESCALATION RULE — Binary analysis leads to privilege escalation:
1. file_info on SUID binary → no canary + no PIE → direct buffer overflow to root shell
2. symbols shows system() import → check strings for user-controlled input → command injection to root
3. strings finds hardcoded credentials → test on SSH, DB, web login immediately
4. Disabled NX → shellcode injection (generate via msfvenom, inject via overflow)
5. No RELRO + PIE disabled → GOT overwrite to hijack execution → arbitrary code execution

### Recommended analysis order (for CTF/binary exploitation):
1. file_info — get architecture, security protections (NX/PIE/Canary/RELRO/FORTIFY), linked libs
2. symbols — find dangerous functions: system, execve, gets, strcpy, strcat, sprintf, printf (format string)
3. strings — find passwords, flag formats, URLs, shellcode, addresses in text form
4. disassemble — read main(), vulnerable functions, or find ROP gadgets
5. hexdump/hex — view raw bytes at specific offset (find shellcode, check for bad chars)

### Security protections interpretation:
- NX disabled: shellcode injection possible (stack/heap executable)
- PIE disabled: fixed addresses → no ASLR needed for code sections
- No stack canary: stack overflow → RIP overwrite directly
- RELRO: none = GOT writable (GOT overwrite), partial = .got writable, full = all read-only
- No FORTIFY: unsafe libc functions not wrapped (getchar_unlocked, etc.)

### Post-privesc binary analysis: finding SUID-rooted exploitation paths
When PrivEscTool finds non-standard SUID binaries, use BinaryAnalysisTool to:
1. symbols: check for system(), popen(), execve() imports (shell injection possible)
2. strings: look for format strings, hardcoded commands, environment variable usage
3. disassemble .text: find vulnerable code paths (buffer overflows, command injection)

### Operations
- \`file_info\` — file type, architecture, linked libs, AND security protections
- \`symbols\` — dynamic symbols (imported/exported), static symbols via nm, PLT entries via objdump -T
- \`strings\` — extract printable strings
- \`hexdump\` — hex+ASCII dump of bytes
- \`disassemble\` — objdump disassembly (default .text, or specify section)
- \`hex\` — raw hex output via xxd

### Examples
- Start here: \`{ path: "/tmp/binary", operation: "file_info" }\`
- Find exploitable imports: \`{ path: "/tmp/binary", operation: "symbols" }\`
- Credential search: \`{ path: "/tmp/binary", operation: "strings", min_string_len: 8 }\`
- ROP in .text: \`{ path: "/tmp/binary", operation: "disassemble" }\`
- ROP in .plt: \`{ path: "/tmp/binary", operation: "disassemble", section: ".plt" }\`
- Check bytes at offset: \`{ path: "/tmp/binary", operation: "hexdump", offset: 4096, length: 64 }\`
`
