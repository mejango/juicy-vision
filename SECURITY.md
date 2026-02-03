# Security Policy

## Security Reviews

For findings from our security audits, see [SECURITY_FINDINGS.md](./SECURITY_FINDINGS.md).

For the complete security architecture including authentication modes, key management, and transaction signing, see the [Architecture document](./ARCHITECTURE.md#security-considerations).

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Email the maintainers directly or use GitHub's private vulnerability reporting feature
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for resolution.

## Scope

This policy applies to:
- The Juicy Vision frontend application
- The Juicy Vision backend API
- Smart contract integrations (read-only interactions)

## Out of Scope

- Third-party services (Stripe, Anthropic, The Graph, etc.)
- Juicebox protocol contracts (report to [Juicebox security](https://github.com/jbx-protocol/juice-contracts-v4/security))
- Social engineering attacks

## Security Practices

This project follows these security practices:

- **No hardcoded secrets**: All API keys and credentials are stored server-side or in environment variables
- **Proxy endpoints**: Sensitive API keys are never exposed to the frontend
- **Input validation**: All user inputs are validated before processing
- **CORS restrictions**: API only accepts requests from allowed origins
- **Secure headers**: Standard security headers are applied to all responses

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities.
