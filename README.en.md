<p align="center"><img src="assets/icon.svg" width="72" alt="SkinLoom"></p>

<h1 align="center">SkinLoom Registry · 云织插件与主题市场</h1>

<p align="center">Official GitOps static signed plugin &amp; theme registry for SkinLoom</p>

<p align="center">
  <a href="https://github.com/Entropy-Increase-Team/skinloom-registry/actions/workflows/pr-check.yml"><img src="https://img.shields.io/github/actions/workflow/status/Entropy-Increase-Team/skinloom-registry/pr-check.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=PR%20Audit" alt="PR Audit"></a>
  <a href="https://github.com/Entropy-Increase-Team/skinloom-registry/actions/workflows/publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/Entropy-Increase-Team/skinloom-registry/publish.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=Publish" alt="Publish"></a>
  <img src="https://img.shields.io/badge/Signing-Ed25519-0F766E?style=flat-square&logo=letsencrypt&logoColor=white" alt="Ed25519 Signed">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Entropy-Increase-Team/skinloom-registry?style=flat-square" alt="License"></a>
  <a href="https://github.com/Entropy-Increase-Team/skinloom-registry/stargazers"><img src="https://img.shields.io/github/stars/Entropy-Increase-Team/skinloom-registry?style=flat-square&logo=github" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/create-skinloom-plugin"><img src="https://img.shields.io/npm/v/create-skinloom-plugin?style=flat-square&logo=npm&label=create-skinloom-plugin&color=CB3837" alt="create-skinloom-plugin"></a>
  <a href="https://www.npmjs.com/package/@skinloom/cli"><img src="https://img.shields.io/npm/v/@skinloom/cli?style=flat-square&logo=npm&label=%40skinloom%2Fcli&color=CB3837" alt="@skinloom/cli"></a>
  <img src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/Go-1.27-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.27">
</p>

<p align="center">
  <a href="https://docs.skinloom.cn/docs/plugins/overview">Docs (Chinese)</a> ·
  <a href="CONTRIBUTING.md">Submission Guide</a> ·
  <a href="SECURITY.md">Security Policy</a> ·
  <a href="https://github.com/Entropy-Increase-Team/skinloom">SkinLoom Repo</a> ·
  <a href="README.md">简体中文</a>
</p>

---

This repository is the canonical source for the **[SkinLoom](https://github.com/Entropy-Increase-Team/skinloom) Official Plugin & Theme Market** (GitOps Static Signed Registry · Mode A). All official and community **Tier 1 Sandbox Plugins (`runtime: "js"`)**, **Tier 2 Native Go Plugins (`runtime: "native"`)**, and **Themes (`kind: "theme"`)** are submitted here via Pull Requests as source-only manifests, audited, compiled in isolated official runners, and signed with the SkinLoom Official Ed25519 key.

| I am a… | Quick Start |
| --- | --- |
| **Site Owner** | Browse, verify, and install packages with one click in **Admin → Plugins & Themes → Market** or **Admin → Appearance → Browse Theme Market**, or via CLI: `skinloom plugin search` / `skinloom plugin market-install <id>` |
| **Plugin / Theme Author** | Scaffold with `bunx create-skinloom-plugin` → Fork this repo and register your immutable 40-char Commit SHA in `manifests/<id>.yaml` → Open a PR (see [Quick Submission Guide](#quick-submission-guide) & [CONTRIBUTING.md](CONTRIBUTING.md)) |
| **Security Researcher** | Report malicious packages or critical vulnerabilities via the [Malicious Package Report Issue](../../issues/new?template=malicious-package-report.yml) or privately per [SECURITY.md](SECURITY.md) to trigger network-wide hot-disabling via [`blocked.yaml`](blocked.yaml) |

---

## Supply-Chain Security Architecture

```text
Author opens PR (manifests/<id>.yaml with https:// Git URL + immutable 40-char Commit SHA)
        │
        ▼
┌──────────────────── 1. PR Validation & Tiered Audit (pr-check.yml) ─────────────┐
│ • Unit tests + Schema / Permission catalog / Commit SHA / Diff-aware gate       │
│ • Isolated checkout of changed releases verifying plugin.json == manifest YAML  │
│ • Existing JS/Theme update without new elevated permissions → Fast-track        │
│ • First publish / elevated permission / Tier 2 Native Go → Manual review +      │
│   go vet + govulncheck + CodeQL security scan                                   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Merged to main
                                        ▼
┌──────────────────── 2. Controlled Build & Ed25519 Signing (publish.yml) ────────┐
│ • Protected environment (production-signing) checks out exact Commit SHA        │
│ • Tier 2 (Native Go) cross-compiled (CGO_ENABLED=0) for 5 OS/Arch targets       │
│ • Official Ed25519 private key signs every .slp archive and index.v1.json       │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ Dual-mirror sync
                                        ▼
         Primary CDN (registry.skinloom.cn)  +  GitHub Fallback (dist branch)
                                        │
                                        ▼
┌──────────────────── 3. Host Verification & 5D Compatibility Filter ─────────────┐
│ • SkinLoom host verifies index.v1.json.sig & .slp against OfficialPublicKeyPEM  │
│ • Matches apiVersion, host SemVer, GOOS/GOARCH, Go baseline & dependency tree   │
│ • Enforces blocked.yaml every 6h: hot-disables revoked plugins & alerts admins  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Submission Guide

1. **Fork this repository** and create or update `manifests/<id>.yaml` (see [`examples/invitation-codes.yaml`](examples/invitation-codes.yaml) for Tier 1 JS/WASM or [`examples/bs-importer.yaml`](examples/bs-importer.yaml) for Tier 2 Native Go).
2. Ensure `id`, `kind`, `runtime`, `version`, `apiVersion`, and `permissions` match your repository's `plugin.json`, `repository` uses `https://`, and `commit` is the **full 40-character lowercase hex Git Commit SHA**.
3. Validate locally (zero external dependencies, requires Node.js 22+):
   ```bash
   # Run registry script unit tests & manifest validation
   npm test
   npm run validate

   # Simulate CI source checkout & plugin.json consistency check
   node scripts/audit-changed.mjs --manifest manifests/<id>.yaml
   ```
4. Open a Pull Request and complete the checklist. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for full rules.

---

## Repository Layout

```text
skinloom-registry/
├── .github/
│   ├── ISSUE_TEMPLATE/                   # Malicious package report & submission help forms
│   ├── workflows/                        # pr-check.yml (audit) & publish.yml (build + sign)
│   ├── CODEOWNERS                        # Maintainer protection for registry infrastructure
│   └── PULL_REQUEST_TEMPLATE.md          # Submission checklist
├── assets/
│   └── icon.svg                          # SkinLoom brand icon
├── examples/                             # Reference manifests (Tier 1 JS & Tier 2 Native Go)
├── manifests/                            # Published package manifests (<id>.yaml)
├── schema/                               # JSON Schemas for manifests & index.v1.json
├── scripts/                              # validate-manifests, audit-changed, build-index, tests
├── blocked.yaml                          # Emergency security revocation blocklist
├── package.json                          # Zero-dependency Node.js 22+ scripts
├── CONTRIBUTING.md                       # Detailed submission requirements
├── SECURITY.md                           # Security policy & emergency revocation SLA
└── LICENSE                               # MIT License
```

## License

[MIT](LICENSE).
