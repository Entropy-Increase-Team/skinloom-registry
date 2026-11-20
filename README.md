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
开发者提交 PR (manifests/<id>.yaml，仅登记开源仓库 HTTPS URL + 40 位不可变 Commit SHA)
        │
        ▼
┌──────────────────── 1. PR 自动校验与分级审计 (pr-check.yml) ────────────────────┐
│ • 单元测试 + Schema / 权限枚举 / Commit SHA / 差异分级门禁校验                   │
│ • 隔离检出变更版本的精确 Commit SHA，强校验 plugin.json 与 YAML 清单 100% 一致   │
│ • 已上架 JS/主题无提权更新 → 自动化快速通道                                     │
│ • 首次上架 / 新增敏感或高危权限 / Tier 2 原生插件 → 强制人工源码审计 +           │
│   go vet + govulncheck + CodeQL 安全扫描                                        │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ 合并入 main
                                        ▼
┌──────────────────── 2. 官方受控编译与 Ed25519 签名 (publish.yml) ───────────────┐
│ • 受保护环境 (production-signing) 精确检出指定 Commit SHA，拒绝任何预编译黑盒    │
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
│ • 按 apiVersion / 宿主版本 / GOOS+GOARCH / Go 基线 / 依赖树自动匹配最佳版本     │
│ • 每 6 小时巡检 blocked.yaml 黑名单，命中即自动热停用 + 写审计 + 通知超级管理员 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 四大安全支柱

| 机制 | 说明 |
| --- | --- |
| **纯源码登记（Source-Only）** | PR **严禁**提交预编译的 `.slp` 或二进制文件；`manifests/<id>.yaml` 只登记公开 `https://` Git 仓库与固定的 40 位 Commit SHA，消除源码与制品不一致的供应链投毒风险。 |
| **差量分级审核** | CI 基于 PR diff 精确判断风险：已上架的纯前端主题或普通 JS 插件未新增敏感/高危权限时走自动化快速通道；**首次上架**、**新增敏感/高危权限**及**所有 `runtime: "native"` 原生插件版本**强制进入人工安全审计 + `go vet`/`govulncheck`/CodeQL 扫描。 |
| **五平台受控交叉编译** | `runtime: "native"` 插件由官方受保护 Runner（`production-signing`）统一交叉编译 `linux/amd64`、`linux/arm64`、`windows/amd64`、`darwin/arm64`、`darwin/amd64` 五个平台独立 `.slp` 分包并加盖官方 Ed25519 签名。 |
| **全网紧急熔断（`blocked.yaml`）** | 恶意或含严重漏洞的插件版本写入 [`blocked.yaml`](blocked.yaml) 后，所有接入官方源的 SkinLoom 实例会在 6 小时定时巡检或刷新市场时**自动热停用该插件**并向超级管理员告警。 |

---

## 快速上架指南

### 第 1 步：准备插件或主题仓库

确保你的开源仓库根目录包含 OSI 许可证文件，且插件目录通过校验与构建：

```bash
bunx skinloom-plugin lint
bunx skinloom-plugin build
```

### 第 2 步：编写市场清单 `manifests/<id>.yaml`

Fork 本仓库，在 `manifests/<id>.yaml` 新增或追加版本记录（完整示例见 [`examples/invitation-codes.yaml`](examples/invitation-codes.yaml) 与 [`examples/bs-importer.yaml`](examples/bs-importer.yaml)，JSON Schema 见 [`schema/manifest.schema.json`](schema/manifest.schema.json)）：

```yaml
id: invitation-codes
kind: plugin              # plugin | theme
runtime: js               # js (Tier 1 轻量沙箱) | native (Tier 2 Go 原生子进程)
category: security        # security | auth | score | economy | operations | migration | storage | render | search | theme | utility
name:
  zh-CN: 邀请码注册
  en: Invitation Codes
description:
  zh-CN: 要求用户提供有效邀请码方可注册账号，支持次数限制、过期时间与管理员批量生成导出
  en: Require a valid invitation code to register an account, with usage limits and bulk generation
authors:
  - YourName
license: MIT
homepage: https://github.com/your-org/your-plugin
repository: https://github.com/your-org/your-plugin
subdir: plugins/invitation-codes                  # 单仓单插件可省略
releases:
  - version: 1.0.0
    tag: v1.0.0
    commit: 0123456789abcdef0123456789abcdef01234567  # 必填：完整的 40 位小写 Git Commit SHA
    apiVersion: 1
    engines:
      skinloom: ">=1.0.0 <2.0.0"
    permissions:
      - admin.ui
      - storage.docs
      - users.read
      - score.write
    dependencies: {}
    optionalDependencies: {}
    publishedAt: "2026-11-19T12:00:00Z"
    yanked: false
    changelog:
      zh-CN: |
        - 首个正式版本发布
      en: |
        - Initial official release
```

> **原生插件提示**：对于 `runtime: "native"` 的 Go 原生插件，还需在 `releases[*]` 中声明 `nativeProtocolVersion: 1`、`engines.go` 与 `targets`（5 大目标平台），详见 [`examples/bs-importer.yaml`](examples/bs-importer.yaml)。

### 第 3 步：本地一键自检并提交 PR

本仓库工具脚本零第三方依赖（仅需 Node.js 22+）：

```bash
# 1. 运行校验脚本与单元测试
npm test
npm run validate

# 2. 模拟 CI 检出你的 Commit SHA 并核验 plugin.json 一致性与编译状态
node scripts/audit-changed.mjs --manifest manifests/<id>.yaml
```

自检全部通过后提交 Pull Request，并按 PR 模板填写权限说明与勾选检查项。详细规范见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

---

## 权限风险分级参考

`releases[*].permissions` 必须与插件 `plugin.json` 完全一致，且与 SkinLoom 宿主 `internal/plugin/permissions.go` 同步分级：

| 风险级别 | 包含权限标识 | 审核策略 |
| --- | --- | --- |
| **普通权限 (`normal`)** | `storage.kv`、`storage.docs`、`storage.files`、`cron`、`admin.ui`、`users.read`、`players.read`、`textures.read`、`notify.send` | 已上架 JS/主题包未新增更高级权限时自动快速通道 |
| **敏感权限 (`sensitive`)** | `http.fetch`、`mail.send`、`players.write`、`textures.write`、`closet.write`、`score.write`、`users.write`、`routes.public`、`yggdrasil.extend`、`cdn.provider`、`captcha.provider`；Native 专属：`storage.sql`、`http.stream`、`provider.search`、`provider.render` | 首次申请或新增时触发人工安全审计 |
| **高危权限 (`high_risk`)** | `users.ban`、`auth.provider`、`auth.password`；Native 专属：`provider.storage`、`native.exec` | 强制人工源码审计，且站长安装时需超管二次高危确认 |

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
│   │   ├── pr-check.yml                  # PR 差量校验、源码检出核验、govulncheck 与 CodeQL
│   │   └── publish.yml                   # 合并后五平台增量交叉编译、Ed25519 签名与双源同步
│   ├── CODEOWNERS                        # 关键基建路径维护者保护
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
│   ├── audit-changed.mjs                 # 隔离源码检出、plugin.json 一致性与编译审计脚本
│   ├── build-index.mjs                   # 索引聚合、Schema 发布与 Ed25519 签名脚本
│   ├── registry.test.mjs                 # 校验器与签名构建器单元测试 (node --test)
│   └── validate-manifests.mjs            # 清单结构、Commit SHA、权限枚举与差量门禁校验脚本
├── blocked.yaml                          # 紧急安全阻断与撤回黑名单
├── package.json                          # 本地开发脚本入口（零外部依赖，Node.js 22+）
├── CONTRIBUTING.md                       # 插件与主题提交规范指南
├── SECURITY.md                           # 安全策略与应急响应说明
└── LICENSE                               # MIT 开源许可证
```

---

## 维护者 CI/CD 环境变量（`production-signing`）

| Secret / Variable | 必填 | 说明 |
| --- | :---: | --- |
| `SKINLOOM_REGISTRY_PRIVATE_KEY` | 是 | 官方 Ed25519 PKCS#8 PEM 私钥（对应 SkinLoom 宿主内置 `OfficialPublicKeyPEM`） |
| `SKINLOOM_CLI_REF`（Variable） | 可选 | 构建 `@skinloom/cli` 使用的主仓库分支或 Tag（默认 `main`） |
| `R2_ACCOUNT_ID` | 可选 | Cloudflare R2 Account ID（配置后自动同步至 R2 国内/全球主源） |
| `R2_ACCESS_KEY_ID` | 可选 | Cloudflare R2 S3 API Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 可选 | Cloudflare R2 S3 API Secret Access Key |
| `R2_BUCKET_NAME` | 可选 | Cloudflare R2 存储桶名称（如 `skinloom-registry`） |
| `CDN_PURGE_WEBHOOK_URL` | 可选 | 发布后触发 CDN 刷新 `index.v1.json` 与 `.sig` 的 Webhook 地址 |

## 许可

[MIT](LICENSE)。
