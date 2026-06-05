export const NUCLEI_TOOL_NAME = 'Nuclei'

export const TEMPLATES_BASE = '/home/clpz/nuclei-templates'

export const PROFILE_MAP: Record<string, string> = {
  pentest:        `${TEMPLATES_BASE}/profiles/pentest.yml`,
  recommended:    `${TEMPLATES_BASE}/profiles/recommended.yml`,
  cves:           `${TEMPLATES_BASE}/profiles/cves.yml`,
  'default-login':`${TEMPLATES_BASE}/profiles/default-login.yml`,
  misconfigs:     `${TEMPLATES_BASE}/profiles/misconfigurations.yml`,
  wordpress:      `${TEMPLATES_BASE}/profiles/wordpress.yml`,
  cloud:          `${TEMPLATES_BASE}/profiles/cloud.yml`,
  compliance:     `${TEMPLATES_BASE}/profiles/compliance.yml`,
  kev:            `${TEMPLATES_BASE}/profiles/kev.yml`,
  windows:        `${TEMPLATES_BASE}/profiles/windows-audit.yml`,
  osint:          `${TEMPLATES_BASE}/profiles/osint.yml`,
  'priv-esc':     `${TEMPLATES_BASE}/profiles/privilege-escalation.yml`,
  takeovers:      `${TEMPLATES_BASE}/profiles/subdomain-takeovers.yml`,
  ai:             `${TEMPLATES_BASE}/profiles/ai.yml`,
  all:            `${TEMPLATES_BASE}/profiles/all.yml`,
  // Cloud-provider specific profiles (for cloud pentest)
  'aws':          `${TEMPLATES_BASE}/profiles/aws-cloud-config.yml`,
  'gcp':          `${TEMPLATES_BASE}/profiles/gcp-cloud-config.yml`,
  'azure':        `${TEMPLATES_BASE}/profiles/azure-cloud-config.yml`,
  'alibaba':      `${TEMPLATES_BASE}/profiles/alibaba-cloud-config.yml`,
  'k8s':          `${TEMPLATES_BASE}/profiles/k8s-cluster-security.yml`,
}

export const TEMPLATE_SHORTCUT_MAP: Record<string, string> = {
  // HTTP
  'http/cves':              `${TEMPLATES_BASE}/http/cves`,
  'http/vulnerabilities':   `${TEMPLATES_BASE}/http/vulnerabilities`,
  'http/exposures':         `${TEMPLATES_BASE}/http/exposures`,
  'http/misconfiguration':  `${TEMPLATES_BASE}/http/misconfiguration`,
  'http/default-logins':    `${TEMPLATES_BASE}/http/default-logins`,
  'http/exposed-panels':    `${TEMPLATES_BASE}/http/exposed-panels`,
  'http/technologies':      `${TEMPLATES_BASE}/http/technologies`,
  'http/takeovers':         `${TEMPLATES_BASE}/http/takeovers`,
  'http/fuzzing':           `${TEMPLATES_BASE}/http/fuzzing`,
  'http/osint':             `${TEMPLATES_BASE}/http/osint`,
  'http/token-spray':       `${TEMPLATES_BASE}/http/token-spray`,
  // DAST (dynamic application security testing)
  dast:                     `${TEMPLATES_BASE}/dast`,
  'dast/vulnerabilities':   `${TEMPLATES_BASE}/dast/vulnerabilities`,
  // DAST sub-categories — targeted injection testing
  'dast/ssti':              `${TEMPLATES_BASE}/dast/vulnerabilities/ssti`,
  'dast/sqli':              `${TEMPLATES_BASE}/dast/vulnerabilities/sqli`,
  'dast/ssrf':              `${TEMPLATES_BASE}/dast/vulnerabilities/ssrf`,
  'dast/lfi':               `${TEMPLATES_BASE}/dast/vulnerabilities/lfi`,
  'dast/cmdi':              `${TEMPLATES_BASE}/dast/vulnerabilities/cmdi`,
  'dast/csti':              `${TEMPLATES_BASE}/dast/vulnerabilities/csti`, // client-side template injection
  'dast/rfi':               `${TEMPLATES_BASE}/dast/vulnerabilities/rfi`,
  'dast/redirect':          `${TEMPLATES_BASE}/dast/vulnerabilities/redirect`,
  // Network
  network:                  `${TEMPLATES_BASE}/network`,
  'network/cves':           `${TEMPLATES_BASE}/network/cves`,
  'network/default-login':  `${TEMPLATES_BASE}/network/default-login`,
  'network/detection':      `${TEMPLATES_BASE}/network/detection`,
  // SSL/TLS
  ssl:                      `${TEMPLATES_BASE}/ssl`,
  // DNS
  dns:                      `${TEMPLATES_BASE}/dns`,
  // Cloud
  cloud:                    `${TEMPLATES_BASE}/cloud`,
  // JavaScript protocol
  javascript:               `${TEMPLATES_BASE}/javascript`,
  // Headless
  headless:                 `${TEMPLATES_BASE}/headless`,
  'headless/cves':          `${TEMPLATES_BASE}/headless/cves`,
  // File-based
  file:                     `${TEMPLATES_BASE}/file`,
  'file/keys':              `${TEMPLATES_BASE}/file/keys`,
}
