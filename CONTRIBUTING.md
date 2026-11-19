# 插件与主题上架贡献指南 (Contributing Guide)

感谢你为 SkinLoom 生态贡献插件或主题！在向 `skinloom-registry` 提交 Pull Request 前，请仔细阅读并遵守以下规范。

---

## 一、 准入基本要求

1. **开源许可证**：提交的插件或主题仓库必须采用 OSI 认可的开源许可证（推荐 `MIT`、`Apache-2.0` 或 `BSD-3-Clause`），并在仓库根目录提供 `LICENSE` 文件。
2. **HTTPS 与不可变 Commit SHA**：
   - `repository` 必须使用 `https://` 协议；
   - `releases[*].commit` 必须填写**完整的 40 位小写十六进制 Git Commit SHA**（严禁使用分支名或可变 Tag 代替 SHA）。
3. **清单一致性**：目标仓库对应 Commit 中的 `plugin.json` 所声明的 `id`、`kind`、`runtime`、`version`、`apiVersion`、`permissions` 必须与 `manifests/<id>.yaml` **完全一致**（PR CI 与官方签名流水线都会拉取源码强校验，不一致将直接失败）。
4. **本地通过校验**：
   - 在你的插件/主题仓库运行 `skinloom-plugin lint` 与 `skinloom-plugin build` 无报错；
   - 在本仓库运行 `npm test && npm run validate` 与 `node scripts/audit-changed.mjs --manifest manifests/<id>.yaml` 无报错。

---

## 二、 双轨运行时选择规范（Tier 1 vs Tier 2）

- **优先使用 Tier 1 轻量沙箱（`runtime: "js"`，默认）**：
  - 适用于注册/登录拦截（Guard）、积分签到、通知邮件、外部 OAuth/OIDC 登录、Webhook、自定义前后端页面、20 处插槽与首页区块。
  - 运行在宿主内置 QuickJS/WASM 沙箱中，全平台通用（`any`），无需交叉编译，常规版本升级审核最快。
- **仅在必要时使用 Tier 2 系统原生（`runtime: "native"`）**：
  - 适用于需要隔离关系型 SQL 数据库建表与迁移（`storage.sql`）、本地流式 HTTP/SSE/WebSocket 反向代理（`http.stream`）、重度计算或替换底层存储/搜索/渲染驱动（`provider.*`）的系统级插件。
  - 必须基于官方 Go SDK（`github.com/Entropy-Increase-Team/skinloom/sdk/go`）编写，且保证能在 `CGO_ENABLED=0` 下跨平台编译（`linux/amd64`、`linux/arm64`、`windows/amd64`、`darwin/arm64`、`darwin/amd64`）。

---

## 三、 权限分级与安全红线

清单中 `releases[*].permissions` 仅允许使用 SkinLoom 宿主定义的合法权限标识（详见 [README.md](./README.md#权限风险分级参考)）：

1. **最小权限原则**：只申请插件实际调用的宿主能力，并在 PR 描述中逐条说明敏感与高危权限的用途。
2. **禁止修改历史版本**：新版本请插入到 `releases` 数组最上方，**不要篡改**已发布历史版本的 `commit` 或 `permissions`（若历史版本有缺陷请标记 `yanked: true`）。
3. **严禁行为（一经发现立即拒绝或加入 `blocked.yaml` 全网熔断）**：
   - 未经站长显式配置，私自向第三方服务器回传用户隐私数据（邮箱、密码哈希、会话令牌、IP 等）；
   - 在 `runtime: "native"` 插件中绕过 `plugindb` 读写宿主核心表，或监听非本地回环地址暴露未授权端口；
   - 包含混淆代码、动态拉取远程未签名可执行文件/脚本（RCE）、挖矿或后门逻辑；
   - 在前端包（`web/index.js`）中使用硬编码颜色破坏宿主 Design Token 或篡改不属于自身插槽/主题覆盖范围的宿主 DOM。

---

## 四、 提交流程

1. Fork 本仓库并新建分支（如 `feat/add-my-plugin` 或 `chore/bump-my-plugin-1.1.0`）。
2. 参考 [`examples/invitation-codes.yaml`](./examples/invitation-codes.yaml)（Tier 1）或 [`examples/bs-importer.yaml`](./examples/bs-importer.yaml)（Tier 2）新增或更新 `manifests/<id>.yaml`。
3. 运行本地全套自检：
   ```bash
   npm test
   npm run validate
   node scripts/audit-changed.mjs --manifest manifests/<id>.yaml
   ```
4. 发起 Pull Request 并完整填写 PR 模板中的勾选清单。
