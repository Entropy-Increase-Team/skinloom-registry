# 安全策略与恶意插件应急响应 (Security Policy)

SkinLoom 官方插件市场采用 **GitOps 源码受控编译 + 官方 Ed25519 私钥签名 + 宿主定时阻断巡检** 的多层纵深防御体系。

---

## 一、 举报恶意插件或安全漏洞

如果你发现已上架至 `skinloom-registry` 的任何插件或主题存在：
- 恶意后门、数据窃取、未授权远程控制；
- 严重安全漏洞（如 SQL 注入、越权访问、XSS、SSRF、任意文件读写）；
- 违反 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 安全红线的行为：

1. **公开恶意包举报**：可直接使用本仓库的 **[Malicious / Vulnerable Package Report](../../issues/new?template=malicious-package-report.yml)** Issue 模板发起紧急阻断请求。
2. **未公开 0-day 漏洞私密报告**：请通过 GitHub Security Advisories（**Security → Report a vulnerability**）私密提交，避免在补丁发布前公开利用细节。

---

## 二、 紧急熔断与撤回机制（`blocked.yaml` vs `yanked: true`）

| 场景 | 处置方式 | 宿主侧行为 |
| --- | --- | --- |
| 某版本存在功能性严重 Bug（无恶意行为） | 在 `manifests/<id>.yaml` 对应版本设置 `yanked: true` | 市场不再推荐安装该版本；已安装站点不受强制停用影响，提示升级至新版本 |
| 某版本（或整个插件）存在**恶意代码或高危安全漏洞** | 在 [`blocked.yaml`](./blocked.yaml) 新增阻断规则（指定 `id`、`versions` SemVer 范围与 `reason`）并合并入 `main` | 重新签名发布 `index.v1.json` 后，所有 SkinLoom 宿主在巡检或刷新市场时**立即自动热停用该插件**、禁止重新安装、写入 `plugin.blocked_disabled` 审计日志并向所有超级管理员发送站内安全告警 |

---

## 三、 官方签名公钥指纹

SkinLoom 宿主内置的官方市场 Ed25519 公钥（定义于 `internal/plugin/package.go` 的 `OfficialPublicKeyPEM`）：

```pem
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAw8HIDMjyzCMx8asCu1gY4+jELLPbsVcwCbig9AyHm4g=
-----END PUBLIC KEY-----
```

宿主对官方源（`id: "official"`）强制校验 `index.v1.json.sig` 及每个 `.slp` 安装包签名，任何中间人篡改或伪造签名均会被宿主直接拒绝（`ErrRegistrySignatureInvalid` / `ErrUnsignedNativeForbidden`）。
