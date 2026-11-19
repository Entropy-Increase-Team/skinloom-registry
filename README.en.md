# SkinLoom Official Plugin & Theme Registry (`skinloom-registry`)

**English** | [简体中文](./README.md)

This repository is the canonical source for the **SkinLoom Official Plugin & Theme Market** (GitOps Static Signed Registry · Mode A). All official and community **Tier 1 Sandbox Plugins (`runtime: "js"`)**, **Tier 2 Native Go Plugins (`runtime: "native"`)**, and **Themes (`kind: "theme"`)** are submitted here via Pull Requests as source-only manifests, audited, compiled in isolated official runners, and signed with the SkinLoom Official Ed25519 key.

---

## 1. Supply-Chain Security Architecture

1. **Source-Only Submissions (`manifests/<id>.yaml`)**:
   - Pre-compiled `.slp` archives or binaries are never accepted in Pull Requests.
   - Each manifest in `manifests/<id>.yaml` references a public open-source Git repository and an **immutable 40-character hex Git Commit SHA** (`commit`).
2. **Tiered Pull Request Auditing (`.github/workflows/pr-check.yml`)**:
   - **Fast-Track Updates**: Existing `runtime: "js"` plugins or `kind: "theme"` packages that do not add `sensitive` or `high_risk` permissions are automatically validated and linted via `skinloom-plugin lint`.
   - **Mandatory Manual Security Review (`needs-security-review`)**: First-time submissions, any release adding sensitive/high-risk permissions, and **every release of a `runtime: "native"` Go plugin** are automatically labeled `needs-security-review` and scanned with `go vet`, `govulncheck`, and CodeQL before a SkinLoom Security Reviewer approves the merge.
3. **Controlled Multi-Platform Compilation & Ed25519 Signing (`.github/workflows/publish.yml`)**:
   - Upon merge to `main`, an isolated GitHub Actions runner checks out the exact `commit` SHA.
   - Tier 2 native plugins are cross-compiled with `CGO_ENABLED=0` for 5 platforms (`linux/amd64`, `linux/arm64`, `windows/amd64`, `darwin/arm64`, `darwin/amd64`) into split `.slp` archives.
   - Every `.slp` archive and the root `index.v1.json` (`index.v1.json.sig`) are signed using `SKINLOOM_REGISTRY_PRIVATE_KEY` and synced to the primary domestic CDN (`https://registry.skinloom.cn`) and the GitHub fallback branch (`dist`).
4. **Emergency Revocation & Blocklist (`blocked.yaml`)**:
   - Compromised or vulnerable releases added to [`blocked.yaml`](./blocked.yaml) are included in the signed `index.v1.json`.
   - All SkinLoom servers enforce the verified blocklist every 6 hours (and on manual market refresh), immediately hot-disabling affected plugins, writing an `audit_logs` entry, and notifying all super administrators.

---

## 2. Validating Locally

```bash
# Validate all manifests in manifests/, examples/, and blocked.yaml
node scripts/validate-manifests.mjs

# Build dist/index.v1.json locally
node scripts/build-index.mjs
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for submission rules and [`SECURITY.md`](./SECURITY.md) for vulnerability reporting.
