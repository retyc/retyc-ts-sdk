# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

See our security policy and contact details at:
**https://retyc.com/.well-known/security.txt**

## Known limitations

- `FileTokenStore` persists the access token and refresh token as plain JSON. The file is
  created with owner-only permissions (`0600`), but it is not encrypted at rest: anyone who can
  read it as your OS user (or as root) can impersonate your session. On platforms without POSIX
  permissions (Windows), the file inherits the ACLs of its parent directory. Implement the
  `TokenStore` interface on top of an OS keychain or a secret manager if you need stronger
  guarantees.
- Unless `outputPath` is used, downloaded files are fully buffered in memory. Uploads always
  buffer one file at a time.
