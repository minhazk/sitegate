# Security policy

## Supported versions

Until Sitegate reaches 1.0, security fixes are released for the latest minor version only. Consumers
should pin a compatible range and keep the package current.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private
[vulnerability reporting](https://github.com/minhazk/sitegate/security/advisories/new) for this
repository and include:

- the affected version or commit;
- the deployment/runtime involved;
- reproduction steps or a minimal proof of concept;
- the security impact and any known workarounds.

Do not include real passwords, signing secrets, production tokens, or private deployment URLs.
Reports will be acknowledged as soon as practical. A coordinated disclosure date will be agreed
after impact and remediation are understood.

## Scope reminder

Sitegate is a shared-password boundary for staging and preview sites. Missing per-user authorization,
MFA, account recovery, audit trails, and individual session revocation are documented limitations,
not vulnerabilities. Authentication bypass, secret disclosure, token forgery, cross-site login,
open redirects, or protection failures on matched routes are in scope.
