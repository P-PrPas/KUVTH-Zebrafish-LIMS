# Local Docker SMTP and antivirus certificate inspection

If Windows can connect to SMTP but the API container fails with
`self-signed certificate in certificate chain`, inspect the certificate issuer
and API logs. On the investigated development machine, AVG Web/Mail Shield
re-issued the SMTP certificate. Windows trusted the AVG root; the Linux image
did not. The API now reports this as `email_tls_verification_failed`.

Compose already passes the `MAIL_*` settings from the root `.env`. Loading
`.env` with uv is relevant to a separate Python process, not this Docker issue.

## Configure a trusted local CA

Obtain the antivirus/proxy root CA from the machine's trusted Windows root
store or the network administrator, and export the public certificate in
Base-64 X.509 / PEM format. Verify its identity before using it. Do not export a
private key or use the SMTP server's leaf certificate as a new trust anchor.
Keep this machine-specific file outside Git; `.cache/smtp-ca/` is ignored by
both Git and the Docker build context. Do not bake it into the production image.

For this development machine, the already Windows-verified AVG root was
prepared at `.cache/smtp-ca/local-smtp-root.pem`. This is local setup material,
not a portable repository dependency.

With the existing database stack already running, use the repository root in
PowerShell and choose the matching stack:

```powershell
$env:SMTP_CA_FILE = (Resolve-Path .cache/smtp-ca/local-smtp-root.pem).Path

# PostgreSQL stack
docker compose -f compose.yaml -f compose.smtp-ca.yaml up -d --no-deps api

# Or, for the separate MySQL stack
docker compose -f compose.mysql.yaml -f compose.mysql.smtp-ca.yaml --profile mysql up -d --no-deps api-mysql
```

These commands recreate only the selected API service if its configuration
changes. They do not delete databases or volumes. Use the same Compose project
name and base files that originally created your stack; do not start a second
project accidentally. The commands above have not been applied to the existing
application containers as part of this work.

The overrides mount the selected file read-only and set Python's standard
`SSL_CERT_FILE`. Missing files are not auto-created. TLS, hostname checking and
`CERT_REQUIRED` remain enabled. Use this override only on a machine/network
where that specific CA is approved; normal deployments use the default trust
store without this override.

Then sign in and use **Members → System sender settings → Send a test email
to me**. Check the inbox and spam folder. SMTP accepting the envelope alone
does not establish that a message reached the inbox.

## Investigation evidence

- The stopped `vetku-pr43-api-1` container's stored SMTP settings match the
  current resolved Compose settings. Its 2026-10-14 logs record certificate
  verification failure in `connection.starttls()`.
- A new disposable container using that exact image reproduced OpenSSL error
  19 without changing the application container or its data.
- The Windows-verified SMTP certificate chain was issued by AVG Web/Mail
  Shield. The root's exact DER bytes were matched against the Windows ROOT
  store with server-authentication trust before exporting its public CA.
- With that CA mounted, the same image passed STARTTLS with hostname/certificate
  verification enabled, SMTP authentication, MAIL FROM and RCPT TO (250).
  The transaction was reset before DATA: no real email was sent.

This verifies the Docker TLS trust failure and its local configuration fix;
the available logs do not identify the exact registration attempt mentioned
in the feedback.

References: [Docker CA certificates](https://docs.docker.com/engine/network/ca-certs/),
[Python default verification paths](https://docs.python.org/3.13/library/ssl.html#ssl.get_default_verify_paths).
