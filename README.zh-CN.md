# Agent Reality API

**给 Agent 可追溯的外部观测，而不是更多小工具。**

这是一个可自托管的网站验证 API。Agent 部署完服务后，从外部节点检查 DNS、TLS、HTTP 状态及预期内容，返回通过、失败或无法判断，并保存有效期内可查询的私有记录。

## 快速启动

需要 pnpm 11.21.0 / Bun 1.4.4 / Vitest 5.1.0 / Node.js 22.16+ (Vitest)。运行时没有 npm 依赖，不需要模型 API Key、GPU、Redis 或数据库服务。

```bash
pnpm install --frozen-lockfile
pnpm env:init
pnpm check
pnpm test
pnpm start
```

打开 `http://localhost:8080`。密钥自动生成在 `.env`，不会打印或提交到 Git。

## 主要接口

| 接口 | 用途 |
|---|---|
| `POST /v1/verify/website` | 验证公网端点并保存记录 |
| `GET /v1/evidence/{id}` | 查询属于当前客户端的记录 |
| `POST /mcp` | MCP 工具接入 |
| `GET /openapi.json` | OpenAPI 3.1 合同 |
| `GET /docs` | 接入和安全文档 |

## 必须知道的边界

`HTTP 200` 只说明 API 处理了请求；要看 `verdict` 才知道验证是否通过。`inconclusive` 不能当成成功。

这是单节点、单时刻的 HTTP 观测，不运行 JavaScript，不代替浏览器测试、登录流程或全球可用性监控。哈希只用于检查记录一致性，不是数字签名或独立公证。

不要提交客户资料或密钥。默认拒绝内网、云元数据地址、非标准端口和含查询参数的 URL。只能访问自己有权验证的目标。

## VPS 部署

```bash
bun scripts/init-env.mjs --domain api.your-owned-domain.com
docker compose -f compose.prod.yaml up -d --build
```

先把真实域名解析到 VPS，再替换上面的示例域名。已有 `.env` 时工具不会覆盖它，需要手动修改生产配置。详见 [部署手册](docs/DEPLOYMENT.md)。

## GitHub

已使用个人仓库作为组织仓库的替代目标：`moonhotline/test_repo`。项目名仍为 Agent Reality API。

```bash
git clone https://github.com/moonhotline/test_repo.git agent-reality-api
cd agent-reality-api
pnpm install --frozen-lockfile
pnpm test
```

仅用 pnpm 管理依赖，Bun 运行服务，Vitest 执行回归测试。`pnpm test` 会启动真实 Bun 子进程检查 HTTP、MCP、DNS 地址固定和 TLS 行为；不用 `bun test` 替代 Vitest。

[完整英文说明](README.md) 包含请求示例、MCP 协议边界、限额、证据保留和安全说明。SEO/GEO 不保证排名或 AI 引用；`llms.txt` 只是便于读取的索引。
