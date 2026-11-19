<p align="center"><img src="assets/icon.svg" width="72" alt="SkinLoom"></p>

<h1 align="center">云织插件与主题市场 · SkinLoom Registry</h1>

<p align="center">云织 SkinLoom 官方 GitOps 静态签名插件与主题注册中心</p>

<p align="center">
  <a href="https://docs.skinloom.cn/docs/plugins/overview">开发文档</a> ·
  <a href="CONTRIBUTING.md">上架指南</a> ·
  <a href="SECURITY.md">安全策略</a> ·
  <a href="https://github.com/Entropy-Increase-Team/skinloom">SkinLoom 主仓库</a> ·
  <a href="README.en.md">English</a>
</p>

---

本仓库是 [云织 SkinLoom](https://github.com/Entropy-Increase-Team/skinloom) 官方插件与主题市场的唯一权威源。所有上架至官方市场的 **Tier 1 轻量沙箱插件（`runtime: "js"`）**、**Tier 2 高性能原生插件（`runtime: "native"`）** 与 **五层主题扩展包（`kind: "theme"`）** 均在此通过 Pull Request 进行源码登记、分级安全审计、官方受控编译与 Ed25519 数字签名分发。

| 我是…… | 快速入口 |
| --- | --- |
| **皮肤站站长** | 无需手动下载：在 SkinLoom 后台 **「插件与主题 → 插件市场」** 或 **「外观 → 浏览主题市场」** 即可直接搜索、验签并一键安装；或使用命令行 `skinloom plugin search` / `skinloom plugin market-install <id>` |
| **插件 / 主题作者** | 使用 `bunx create-skinloom-plugin` 创建工程 → Fork 本仓库并在 `manifests/<id>.yaml` 登记源码 Commit SHA → 提交 PR 即可由官方流水线自动编译签名发布（详见[快速上架](#快速上架指南)与 [CONTRIBUTING.md](CONTRIBUTING.md)） |
| **安全研究人员** | 发现已上架插件存在恶意行为或高危漏洞，请提交[恶意包紧急举报 Issue](../../issues/new?template=malicious-package-report.yml) 或按 [SECURITY.md](SECURITY.md) 私下报告，触发 [`blocked.yaml`](blocked.yaml) 全网自动热停用 |

---

## 供应链安全架构

```text
开发者提交 PR (manifests/<id>.yaml，仅登记开源仓库 URL + 40 位不可变 Commit SHA)
        │
        ▼
┌──────────────────── 1. PR 自动校验与分级审计 (pr-check.yml) ────────────────────┐
│ • Schema 校验 & Commit SHA 格式检查                                             │
│ • Tier 1 常规无提权更新 → 自动运行 skinloom-plugin lint AST 扫描                 │
│ • 首次上架 / 新增敏感或高危权限 / Tier 2 原生插件 → 强制打标 needs-security-review │
│   并运行 go vet + govulncheck + CodeQL，需安全维护者人工审计源码 Diff            │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ 合并入 main
                                        ▼
┌──────────────────── 2. 官方受控编译与 Ed25519 签名 (publish.yml) ───────────────┐
│ • 隔离 Runner 精确检出指定 Commit SHA（拒绝任何预编译二进制黑盒）               │
│ • Tier 2 (Native Go) 自动 CGO_ENABLED=0 交叉编译 5 平台独立 .slp 分包           │
│ • 官方受保护私钥对全部 .slp 包与全局索引 index.v1.json 生成 Ed25519 签名        │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ 双源同步分发
                                        ▼
        国内主源 (registry.skinloom.cn)  +  GitHub 备用源 (dist 分支)
                                        │
                                        ▼
┌──────────────────── 3. SkinLoom 宿主验签与五维兼容匹配 ─────────────────────────┐
│ • 宿主强制使用内置 OfficialPublicKeyPEM 校验 index.v1.json.sig 与 .slp 签名     │
│ • 按 apiVersion / 宿主版本 / GOOS+GOARCH / 数据库方言 / 依赖树自动匹配最佳版本  │
│ • 每 6 小时巡检 blocked.yaml 黑名单，命中即自动热停用 + 写审计 + 通知超级管理员 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 四大安全支柱

| 机制 | 说明 |
| --- | --- |
| **纯源码登记（Source-Only）** | PR **严禁**提交预编译的 `.slp` 或二进制文件；`manifests/<id>.yaml` 只登记公开 Git 仓库地址与固定的 40 位 Commit SHA，消除源码与制品不一致的供应链投毒风险。 |
| **双轨分级审核** | 已上架的纯前端主题或普通 JS 插件在未新增敏感/高危权限时走自动化快速通道；**首次上架**、**权限提升**及**所有 `runtime: "native"` 原生插件版本**强制进入人工安全审计 + CodeQL 扫描。 |
| **五平台受控交叉编译** | `runtime: "native"` 插件由官方隔离 Runner 统一编译 `linux/amd64`、`linux/arm64`、`windows/amd64`、`darwin/arm64`、`darwin/amd64` 五个平台的分包，并用官方 Ed25519 私钥签名。 |
| **全网紧急熔断（`blocked.yaml`）** | 恶意或含严重漏洞的插件版本写入 [`blocked.yaml`](blocked.yaml) 后，所有接入官方源的 SkinLoom 实例会在 6 小时定时巡检或刷新市场时**自动热停用该插件**并向超级管理员告警。 |

---

## 快速上架指南

### 第 1 步：准备插件或主题仓库

确保你的开源仓库根目录（或 `subdir` 子目录）包含合法的 `plugin.json`，并在本地通过校验与测试：

```bash
bunx skinloom-plugin lint
bunx skinloom-plugin build
```

### 第 2 步：编写市场清单 `manifests/<id>.yaml`

Fork 本仓库，在 `manifests/<id>.yaml` 下新增或追加版本记录（完整示例见 [`examples/invitation-codes.yaml`](examples/invitation-codes.yaml) 与 [`examples/bs-importer.yaml`](examples/bs-importer.yaml)）：

```yaml
id: invitation-codes
kind: plugin              # plugin | theme
runtime: js               # js (Tier 1 轻量沙箱) | native (Tier 2 Go 原生子进程)
name:
  zh-CN: 邀请码注册
  en: Invitation Codes
description:
  zh-CN: 生成并校验注册邀请码，支持次数限制、过期时间与积分奖励。
  en: Require or reward invitation codes during user registration.
author:
  name: SkinLoom Team
  url: https://github.com/Entropy-Increase-Team
homepage: https://github.com/Entropy-Increase-Team/skinloom-plugins
repository: https://github.com/Entropy-Increase-Team/skinloom-plugins.git
license: MIT
categories:
  - auth
  - moderation
permissions:
  standard:
    - storage:rw
    - users:read
  sensitive:
    - score:write
  high_risk: []
versions:
  - version: 1.0.0
    commit: 4b825dc642cb6eb9a060e54bf8d69288fbee4904  # 必填：完整的 40 位小写 Git Commit SHA
    subdir: plugins/invitation-codes                  # 单仓单插件可省略
    minHostVersion: "0.1.0"
    apiVersion: 1
    changelog:
      zh-CN: 首个正式版本发布
      en: Initial stable release
```

> **提示**：对于 `runtime: "native"` 的 Go 原生插件，还需在版本条目中声明 `goVersion`、`protocolVersion: 1`、`platforms`（5 大目标平台）与可选的 `isolatedDb: true`（详见 [`examples/bs-importer.yaml`](examples/bs-importer.yaml)）。

### 第 3 步：本地自检并提交 PR

```bash
# 校验 manifests/、examples/ 与 blocked.yaml 的 Schema、Commit SHA 及权限分级
node scripts/validate-manifests.mjs
```

自检通过后提交 Pull Request，并按 PR 模板勾选检查项。完整的字段规范与审核标准见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

---

## 权限风险分级参考

清单中的 `permissions` 必须与插件源码 `plugin.json` 完全一致，并按风险级别归类：

| 级别 | 清单字段 | 包含权限 | 审核策略 |
| --- | --- | --- | --- |
| **标准权限** | `permissions.standard` | `storage:rw`、`files:rw`、`users:read`、`players:read`、`textures:read`、`closet:read`、`i18n:extend`、`ui:slots` | 已上架 JS/主题包未新增更高级权限时自动扫描通过 |
| **敏感权限** | `permissions.sensitive` | `users:write`、`score:write`、`players:write`、`textures:write`、`closet:write`、`notifications:send`、`mail:send`、`network:outbound` | 首次申请或新增时触发 `needs-security-review` 人工审计 |
| **高危权限** | `permissions.high_risk` | `auth:provider`、`yggdrasil:intercept`、`oauth:intercept`、`storage:driver`、`native:exec`、`db:isolated` | 每次发布均强制人工审计，且站长安装时需二次高危确认 |

---

## 仓库目录结构

```text
skinloom-registry/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── malicious-package-report.yml  # 恶意插件/安全漏洞紧急举报表单
│   │   ├── package-submission-help.yml   # 插件上架协助表单
│   │   └── config.yml
│   ├── workflows/
│   │   ├── pr-check.yml                  # PR 清单校验、AST 扫描、CodeQL 与分级打标
│   │   └── publish.yml                   # 合并后五平台受控编译、Ed25519 签名与双源发布
│   └── PULL_REQUEST_TEMPLATE.md          # 插件/主题上架 PR 检查清单
├── assets/
│   └── icon.svg                          # 云织品牌图标
├── examples/
│   ├── invitation-codes.yaml             # 示例：Tier 1 (JS/WASM) 插件清单
│   └── bs-importer.yaml                  # 示例：Tier 2 (Native Go) 五平台插件清单
├── manifests/                            # 正式上架的插件与主题清单目录 (<id>.yaml)
├── schema/
│   ├── index.v1.schema.json              # index.v1.json 索引 JSON Schema
│   └── manifest.schema.json              # manifests/<id>.yaml 清单 JSON Schema
├── scripts/
│   ├── build-index.mjs                   # 索引聚合与 Ed25519 签名脚本
│   └── validate-manifests.mjs            # 清单结构、Commit SHA 与权限分级校验脚本
├── blocked.yaml                          # 紧急安全阻断与撤回黑名单
├── CONTRIBUTING.md                       # 插件与主题提交规范指南
├── SECURITY.md                           # 安全策略与应急响应说明
└── LICENSE                               # MIT 开源许可证
```

---

## 维护者 CI/CD 环境变量（`production-signing`）

| Secret / Variable | 必填 | 说明 |
| --- | :---: | --- |
| `SKINLOOM_REGISTRY_PRIVATE_KEY` | 是 | 官方 Ed25519 PKCS#8 PEM 私钥（对应 SkinLoom 宿主内置 `OfficialPublicKeyPEM`） |
| `R2_ACCOUNT_ID` | 可选 | Cloudflare R2 Account ID（配置后自动同步至 R2 国内/全球主源） |
| `R2_ACCESS_KEY_ID` | 可选 | Cloudflare R2 S3 API Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 可选 | Cloudflare R2 S3 API Secret Access Key |
| `R2_BUCKET_NAME` | 可选 | Cloudflare R2 存储桶名称（如 `skinloom-registry`） |
| `CDN_PURGE_WEBHOOK_URL` | 可选 | 发布后触发 CDN 刷新 `index.v1.json` 与 `.sig` 的 Webhook 地址 |

## 许可

[MIT](LICENSE)。
