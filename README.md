# SkinLoom 官方插件与主题市场仓库 (`skinloom-registry`)

[English](./README.en.md) | **简体中文**

本仓库是 **SkinLoom** 官方插件与主题市场（GitOps 静态签名索引 · 模式 A）的唯一权威源。所有上架至官方市场的 **Tier 1 轻量沙箱插件（`runtime: "js"`）**、**Tier 2 系统原生插件（`runtime: "native"`）** 与 **五级主题扩展包（`kind: "theme"`）** 均通过向本仓库提交 Pull Request 进行源码审计、官方受控编译与 Ed25519 数字签名分发。

---

## 一、 核心架构与供应链安全模型

1. **纯源码登记，拒绝预编译黑盒（Source-Only Manifests）**
   - 开发者**无需也不允许**直接上传 `.slp` 归档或预编译二进制文件。
   - 每个上架包对应 `manifests/<id>.yaml`，仅登记公开开源 Git 仓库地址、子目录（可选）及**固定不可变的 40 位 Git Commit SHA**（`commit`）。
2. **双轨分级审核机制（`.github/workflows/pr-check.yml`）**
   - **常规更新通道**：针对已上架的 `runtime: "js"` 插件或 `kind: "theme"` 主题，若未新增 `sensitive`（敏感）或 `high_risk`（高危）权限，CI 自动拉取对应 Commit SHA 执行 `skinloom-plugin lint` AST 静态扫描与打包测试。
   - **强制人工安全审计通道（`needs-security-review`）**：以下任一情况，CI 将自动打上 `needs-security-review` 标签并运行 `go vet`、`govulncheck` 与 CodeQL 安全扫描，必须经 SkinLoom 安全维护者人工审查源码 Diff 后方可合并：
     - 首次上架的新插件或新主题；
     - 版本升级新增了任何敏感权限或高危权限；
     - **所有 `runtime: "native"`（Tier 2 Go 原生子进程）插件的任何版本**。
3. **官方受控交叉编译与 Ed25519 密码学签名（`.github/workflows/publish.yml`）**
   - PR 合并入 `main` 分支后，官方受控 GitHub Actions Runner 在隔离环境中检出清单指定的 `commit` SHA。
   - 对 `runtime: "native"` 插件使用 `CGO_ENABLED=0` 自动交叉编译五平台独立分包（`linux/amd64`、`linux/arm64`、`windows/amd64`、`darwin/arm64`、`darwin/amd64`）。
   - 使用存储在受保护环境（`production-signing`）中的**官方 Ed25519 私钥**对每个 `.slp` 归档及全局索引 `index.v1.json` 生成签名（`index.v1.json.sig`），同步发布至国内 CDN 主源（`https://registry.skinloom.cn`）与 GitHub 备用源（`dist` 分支）。
4. **五维兼容性筛选与恶意插件紧急熔断（`blocked.yaml`）**
   - SkinLoom 宿主拉取 `index.v1.json` 后，强制使用内置 `OfficialPublicKeyPEM` 验证 `index.v1.json.sig`，并基于本机 `GOOS/GOARCH`、SkinLoom 版本、API/gRPC 协议版本、Go 版本及依赖树自动筛选最佳兼容版本。
   - 一旦发现已上架版本存在严重安全漏洞或恶意行为，维护者将其加入 [`blocked.yaml`](./blocked.yaml)；所有启用了官方市场源的 SkinLoom 实例会在定时安全巡检（每 6 小时）或刷新市场时**自动热停用命中阻断规则的插件**、写入审计日志并向全体超级管理员发送站内安全告警。

---

## 二、 仓库目录结构

```text
skinloom-registry/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── config.yml
│   │   ├── malicious-package-report.yml  # 恶意插件/安全漏洞紧急举报表单
│   │   └── package-submission-help.yml   # 插件上架咨询表单
│   ├── workflows/
│   │   ├── pr-check.yml                  # PR 清单校验、静态扫描、CodeQL 与分级打标
│   │   └── publish.yml                   # 合并后五平台受控编译、Ed25519 签名与双源发布
│   └── PULL_REQUEST_TEMPLATE.md          # 插件/主题上架 PR 检查清单
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
├── blocked.yaml                          # 紧急安全阻断与撤回名单
├── CONTRIBUTING.md                       # 插件与主题提交规范指南
├── SECURITY.md                           # 安全策略与应急响应说明
└── LICENSE                               # MIT 开源许可证
```

---

## 三、 如何提交插件或主题（快速指南）

1. **Fork 本仓库**并在 `manifests/<id>.yaml` 创建（或更新）你的扩展清单（可参考 [`examples/invitation-codes.yaml`](./examples/invitation-codes.yaml) 或 [`examples/bs-importer.yaml`](./examples/bs-importer.yaml)）。
2. 确保插件仓库中的 `plugin.json` 与 `manifests/<id>.yaml` 中的 `id`、`kind`、`runtime`、`version`、`permissions` 完全一致，且 `commit` 填写为**完整的 40 位小写十六进制 Git Commit SHA**。
3. 在本地运行校验脚本确认零报错：
   ```bash
   node scripts/validate-manifests.mjs
   ```
4. 提交 Pull Request 并按 PR 模板填写权限用途说明与测试验证记录。详细规范请参阅 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

---

## 四、 维护者 CI/CD 环境变量与密钥说明（`production-signing` Environment）

| Secret / Variable | 必填 | 说明 |
| --- | :---: | --- |
| `SKINLOOM_REGISTRY_PRIVATE_KEY` | 是（签名时） | 官方 Ed25519 PKCS#8 PEM 私钥（对应 SkinLoom 宿主内置 `OfficialPublicKeyPEM`） |
| `R2_ACCOUNT_ID` | 可选 | Cloudflare R2 Account ID（配置后自动同步至 R2 主源） |
| `R2_ACCESS_KEY_ID` | 可选 | Cloudflare R2 S3 API Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 可选 | Cloudflare R2 S3 API Secret Access Key |
| `R2_BUCKET_NAME` | 可选 | Cloudflare R2 存储桶名称（如 `skinloom-registry`） |
| `CDN_PURGE_WEBHOOK_URL` | 可选 | 发布后触发国内 CDN 刷新 `index.v1.json` 的 Webhook 地址 |
