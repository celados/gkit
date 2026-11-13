---
type: Proposal
title: gkit First-Principles Agent Architecture and Implementation Plan
description: 用一个 gkit binary、显式 App profile、polyglot provider adapters、渐进发现和 shell code mode 覆盖增长数据 provider 的完整能力面。
status: draft
version: 1.2
timestamp: 2026-07-13T15:46:36+08:00
---

# gkit First-Principles Agent Architecture and Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从零建立一个 agent-first 的增长数据工具：只有一个 `gkit` 入口，既能低成本发现能力，也能保留每个 provider 的原生执行语义，并由 shell/script 完成组合。

**Architecture:** `gkit search/describe` 是无 profile 的只读控制面；`gkit --profile <app> <provider> ...` 是绑定单一 App context 的 provider-owned 执行面；shell/jq/TypeScript 是 orchestration 与 code mode。gkit core 使用 TypeScript，但 provider adapter 可以选择最合适的官方 runtime，并通过统一的 in-process 或 subprocess protocol 接入。

**Tech Stack:** Bun、TypeScript、Python、argc、Valibot/JSON Schema、Vitest、provider 官方 SDK/OpenAPI/Discovery contracts。

---

## 1. 从零推导

### Agent 真正需要什么

Agent 处理 GSC、Google Ads、PostHog、DataForSEO、Bing 时，只有六个稳定需求：

1. 知道应该选哪个 provider；
2. 只在需要时读取一个 capability 的完整 schema；
3. 能访问 provider 没被 curated 的长尾能力；
4. 在执行前知道 read、spend、write、destructive effect；
5. 让循环、分页、join、过滤和大结果留在运行环境，不进入模型。
6. 多个 App 使用相同 provider 时，每次调用都明确绑定正确的 account/resource context。

由此推出的最小系统是：

```text
                         ┌──────────────────────────┐
Agent intent ───────────▶│ gkit search / describe   │  控制面
                         └────────────┬─────────────┘
                                      │ exact command + schema
                                      ▼
                         ┌──────────────────────────┐
                         │ gkit --profile <app>     │
                         │      <provider> ...      │  执行面
                         └────────────┬─────────────┘
                                      │ JSON / artifact / task ID
                                      ▼
                         ┌──────────────────────────┐
                         │ shell | jq | TS script   │  编排面
                         └──────────────────────────┘
```

### 最终产品形态

```text
一个 public npm package
一个 gkit binary
一个共享 core
多个内部 polyglot provider adapters
一次 invocation 一个 App profile
零公开 provider binary
零旧 binary alias
零兼容层
零持久 REPL
零全局通用 run(id, unknown)
```

Agent-facing surface：

```bash
gkit --schema
gkit --schema=.dataforseo

gkit search --query "bulk backlink ranks"
gkit describe --id dataforseo.backlinks.bulk_ranks.live

gkit --profile app-a dataforseo api call \
  --operation-id dataforseo.backlinks.bulk_ranks.live \
  --input @request.json \
  --allow-spend \
  --out response.json

gkit --profile app-a google-ads fields search --query campaign
gkit --profile app-a google-ads query gaql --input @query.json
gkit --profile app-a posthog query hogql --input @query.json
gkit --profile app-b posthog query hogql --input @query.json
gkit --profile app-a gsc search-analytics query --input @request.json
gkit --profile app-a bing sites list
```

## 2. 核心边界

### 2.1 全局只统一发现，不统一执行语义

`search/describe` 是 provider capability 的 projection，不是新的事实来源。

- Curated command 的事实来源是 gkit command definition。
- Provider-native capability 的事实来源是官方 OpenAPI、Discovery、protobuf、WSDL 或 query language。
- 全局 catalog 在启动/构建时从这些来源生成，不手工维护第二份 registry。
- `describe` 返回 exact command；没有全局 `gkit run`。

搜索结果必须区分 contract owner：

```ts
type CapabilityKind = 'curated' | 'provider'

type CapabilitySummary = {
	id: string
	provider: string
	kind: CapabilityKind
	contractOwner: 'gkit' | 'provider'
	description: string
	command: string
	schemaSelector: string
	effects: Effect[]
}
```

Curated command 是 gkit 承诺的稳定、normalized contract；provider capability 明确跟随 provider 版本和原生返回。

### 2.2 Provider 是执行边界

统一到 module interface 就停止：

```ts
type Effect = 'read' | 'spend' | 'write' | 'destructive'

type ProviderModule = {
	id: string
	description: string
	schema: CommandTree
	handlers: HandlerTree
	profileSchema: JsonSchema
	runtime: ProviderRuntime
	catalog: {
		search(query: string, limit: number): Promise<CapabilitySummary[]>
		describe(id: string): Promise<CapabilityDescription>
	}
	doctor(context: ProviderContext): Promise<DoctorReport>
}

type ProviderRuntime =
	| { kind: 'in-process'; language: 'typescript' }
	| {
			kind: 'process'
			language: 'python' | 'other'
			protocol: 'gkit-provider-v1'
			setup: () => Promise<SetupReport>
			probe: () => Promise<RuntimeReport>
	  }
```

`ProviderRuntime` 只统一进程边界，不统一 provider API。DataForSEO、GSC、PostHog 可以使用 TypeScript in-process adapter；Google Ads 使用官方 Python SDK subprocess。

Process protocol 固定为：

```text
stdin    单个 JSON request，不包含 secret
stdout   单个 JSON response，不混入日志
stderr   progress、warning、SDK diagnostics
exit 0   protocol success，provider success/failure 由 JSON 表达
exit >0  runtime/protocol failure
```

Core 将选中 profile 的 secret 映射为最小 child environment；secret value 不进入 request JSON、argv 或 artifact。第一版每次调用启动一个短生命周期 process，不建立 daemon、socket 或常驻 worker。

Core 不拥有：

- GAQL/HogQL 语法；
- provider pagination；
- provider async task 状态机；
- provider cost 算法；
- provider retry/idempotency 规则；
- provider response normalization；
- provider 使用哪种语言或官方 SDK。

这些全部留在 module 内。

### 2.3 Shell 是 code mode

不新增 persistent REPL。多次调用的中间状态使用：

- pipe；
- 临时文件；
- artifact path；
- cursor；
- provider task ID；
- 普通 shell/TypeScript script。

只有出现 shell-less host，并且真实 workflow 经常包含三个以上依赖调用时，才另行设计一次性 sandboxed `gkit exec`。它不属于本架构的默认核心。

### 2.4 Profile 是 App 执行上下文，不是 secret store

Profile 是真实业务维度：它回答“这次调用代表哪个 App，以及该 App 在每个 provider 中对应哪个 account/resource”。

```ts
type SecretRef = `env:${string}`

type GkitProfile = {
	version: 1
	name: string
	providers: Record<
		string,
		{
			config: Record<string, unknown>
			secrets: Record<string, SecretRef>
		}
	>
}

type ProviderContext = {
	profile: string
	config: Record<string, unknown>
	resolveSecret(name: string): string
}
```

Profile 文件位于：

```text
$XDG_CONFIG_HOME/gkit/profiles/<name>.json  # XDG_CONFIG_HOME 已设置
~/.config/gkit/profiles/<name>.json         # 否则
```

示例：

```json
{
	"version": 1,
	"name": "app-a",
	"providers": {
		"posthog": {
			"config": {
				"host": "https://us.posthog.com",
				"projectId": "12345"
			},
			"secrets": {
				"apiToken": "env:APP_A_POSTHOG_TOKEN"
			}
		},
		"gsc": {
			"config": {
				"siteUrl": "sc-domain:app-a.com"
			},
			"secrets": {
				"credentialsJson": "env:APP_A_GSC_CREDENTIALS_JSON"
			}
		},
		"google-ads": {
			"config": {
				"customerId": "1234567890",
				"loginCustomerId": "0987654321"
			},
			"secrets": {
				"developerToken": "env:APP_A_GOOGLE_ADS_DEVELOPER_TOKEN",
				"credentialsJson": "env:APP_A_GOOGLE_ADS_CREDENTIALS_JSON"
			}
		}
	}
}
```

规则：

- Provider execution 与 doctor 必须通过 `--profile <name>` 或 `GKIT_PROFILE=<name>` 选择一个 profile；flag 优先。
- `search/describe` 不需要 profile，也不加载 profile 或 secret。
- 一次 invocation 只能绑定一个 profile；core 不隐式 merge 或 fallback 到另一个 App。
- Profile 只保存非敏感 provider defaults 和 `env:` secret reference，不保存明文 secret。
- 外部 secret runner 负责把 1Password、Bitwarden 或其他 secret 注入对应环境变量；gkit v1 不实现 vault client。
- Provider module 用自己的 `profileSchema` 校验 config 和所需 secret names。
- `gkit profile list/show/validate` 只管理/检查非敏感 profile contract；`show` 不解析 secret value。
- `gkit --profile app-a <provider> doctor` 检查配置、依赖和权限；无安全 probe 时返回 `unknown`，不伪造 ready。
- 输出与 artifact manifest 记录 profile 名，绝不记录已解析 credential。
- 跨 App 比较由 shell 显式执行两个 profile 后 join，不在一次 invocation 中隐式混合数据。

### 2.5 Effect 是唯一共享执行 policy

```text
read          默认允许
spend         必须 --allow-spend
write         必须 --allow-write
destructive   必须 --allow-write --allow-destructive
```

Effect 不能按 HTTP method 推断：

- GSC Search Analytics 是 POST + read；
- PostHog query 是 POST + read；
- DataForSEO Live 是 POST + read + spend；
- Google Ads mutate 是 write，且可能导致后续 spend。

Effect 必须由 provider module 显式标注；生成器只能提供候选，不能做最终安全判断。

## 3. Provider 映射

| Provider       | Discovery source                 | Native execution                 | Curated 的角色                                   |
| -------------- | -------------------------------- | -------------------------------- | ------------------------------------------------ |
| DataForSEO     | 官方 OpenAPI                     | operation ID + native JSON input | 高频 SEO/GEO reads 的稳定 contract               |
| GSC            | Google Discovery                 | resource/method call             | 常用 Search Analytics、Inspection 等默认值与输出 |
| Google Ads     | 官方 Python SDK + field metadata | GAQL；未来 SDK service methods   | 常用 performance、Keyword Planner reads          |
| PostHog        | instance/OpenAPI + query kinds   | HogQL/query；read API            | 常用 event/funnel/instrumentation reads          |
| Bing Webmaster | WSDL/interface inventory         | provider method + native input   | 常用 site/traffic/crawl/link reads               |

### DataForSEO

```bash
gkit search --query "DataForSEO bulk ranks"
gkit describe --id dataforseo.backlinks.bulk_ranks.live
gkit dataforseo api call --operation-id ... --input @request.json --allow-spend
```

OpenAPI 生成 compact index 与 per-operation description。Call 只接受 index 中的 operation ID，固定 provider origin，不接受任意 URL/header。

### Google Ads

```bash
gkit google-ads setup
gkit --profile app-a google-ads doctor
gkit --profile app-a google-ads fields search --query campaign.status
gkit --profile app-a google-ads fields describe --name campaign.status
gkit --profile app-a google-ads query gaql --input @query.json
```

GAQL 是自然长尾读取面，Field service 解决字段发现，不伪装成 OpenAPI endpoint。Google Ads 没有官方 Node.js/TypeScript client；该 module 使用 Google 官方 Python SDK，gkit TypeScript core 只负责 schema、profile、effect 和 process lifecycle。

`setup` 在 `$XDG_CACHE_HOME/gkit/runtimes/google-ads/`（未设置时为 `~/.cache/gkit/runtimes/google-ads/`）创建 managed virtualenv，并安装与 pinned Google Ads API major version 兼容的 SDK lock。Python runtime 是内部 executor，不暴露 `google-ads` binary。

### PostHog

```bash
gkit posthog query hogql --input @query.json --out result.json
```

HogQL/query kinds 是 analytics 长尾面。OpenAPI read operations 可以进入 catalog；write operations 只有显式 effect mapping 后才可见。

### GSC

Discovery methods 可以生成 provider capabilities；read 与 write scope 分开。Curated Search Analytics/Inspection command 仍可提供更好默认值，但不是另一个 package。

### Bing

从 WSDL/interface inventory 生成 method list；API key 绝不出现在可打印 URL。无法可靠判定 effect 的 method 默认隐藏，而不是猜测。

## 4. 统一输出与失败模型

成功：

```json
{
	"ok": true,
	"data": {},
	"meta": {
		"profile": "app-a",
		"provider": "dataforseo",
		"capability": "dataforseo.backlinks.bulk_ranks.live",
		"kind": "provider",
		"effects": ["read", "spend"],
		"requestId": "optional",
		"cost": { "amount": 0.02, "currency": "USD" },
		"artifact": null
	}
}
```

失败：

```json
{
	"ok": false,
	"error": {
		"code": "EFFECT_NOT_ALLOWED",
		"message": "This capability can spend provider credits.",
		"hint": "Review the request, then rerun with --allow-spend.",
		"retryable": false,
		"providerCode": null
	}
}
```

稳定 error code 只保留：

```text
CAPABILITY_NOT_FOUND
INVALID_INPUT
NOT_READY
EFFECT_NOT_ALLOWED
AUTH_FAILED
RATE_LIMITED
NETWORK_ERROR
PROVIDER_ERROR
```

Provider 原始错误保留在 `details`，不伪装成统一业务错误。

大结果通过显式 `--out` 落盘；stdout 返回 path、bytes、sha256、request/cost metadata。日志只写 stderr。

## 5. 非功能要求

- `gkit --schema` 与 `gkit search` 不读取 credential、不访问网络。
- `gkit search/describe` 不要求 profile；provider doctor/execute 必须明确解析一个 profile。
- Profile resolution 顺序固定为 `--profile`、`GKIT_PROFILE`；缺失、name/file 不一致或 schema 不合法时在网络调用前失败。
- 同一 process 中 provider handler 只能看到所选 profile 的 provider section。
- Root schema 只列 provider 和 root commands，目标少于 2,000 tokens。
- Search 默认最多 10 条、最大 50 条，不返回完整 input schema。
- Describe 一次只展开一个 capability。
- Provider dependencies lazy load；schema/search 冷启动目标小于 300 ms。
- Schema/search 不启动 provider subprocess；process runtime 只在 setup、doctor 或 execute 时加载。
- Process executor 必须设置 timeout、stdout size limit、最小 child environment，并在退出时清理临时 credential material。
- 一个 provider runtime 缺失、损坏或版本不兼容，只使该 provider doctor/execute 失败，不影响 gkit root 与其他 provider。
- 生成 manifest 必须记录 source URL、revision 与 checksum，并能字节稳定重建。
- Secret redaction 有独立测试；任何 failure path 都不能打印完整 request URL/header/env。
- 每个 provider 都能独立失败；一个 provider 缺 credential 不影响其他 provider 的 discovery/执行。
- Async provider operation 返回 provider-native task ID/cursor，不建立跨 provider job state machine。

### Polyglot runtime failure modes

| Failure                 | Result                | Required handling                                              |
| ----------------------- | --------------------- | -------------------------------------------------------------- |
| Provider runtime 未安装 | 仅该 provider blocked | doctor 返回 setup command；root discovery 继续工作             |
| SDK/API version 不兼容  | 仅该 provider blocked | setup/doctor 校验 compatibility manifest，不尝试降级猜测       |
| Child process hang      | 当前调用失败          | timeout 后终止整个 process group，返回 retryable runtime error |
| stdout 非法或过大       | 当前调用失败          | 拒绝解析并保留截断后的非敏感诊断                               |
| stderr 包含敏感值       | 安全失败              | 输出前经过已解析 secret redaction，测试覆盖异常路径            |
| Python provider crash   | 当前调用失败          | 非零 exit 映射为 provider runtime error，不影响其他 modules    |

## 6. ADR-001: 选择一个 public binary + polyglot provider-owned execution

**Status:** Proposed

**Decision:** gkit 对外只有一个 public package 和一个 binary。全局 `search/describe` 只投影发现信息；执行始终进入 `gkit --profile <app> <provider> ...`，并且一次只绑定一个 App profile。Provider adapter 可以使用 TypeScript in-process runtime，也可以使用受控 subprocess 接入最佳官方 SDK；不要求所有 provider 使用同一种语言。

**Alternatives considered:**

1. **多个 provider CLI + raw escape hatch**
   - 优点：实现简单。
   - 拒绝原因：安装、schema、routing、版本和共享 policy 全部分裂；这正是历史形态，不是新产品模型。

2. **全局 `search/describe/run(id, input)` capability runtime**
   - 优点：表面只有三个 verbs，适合无 shell host。
   - 拒绝原因：GAQL、HogQL、OpenAPI task、WSDL method 最终退化成 `unknown` input；root 会逐渐吞掉 auth、pagination、billing、task 与 retry，成为平台。

3. **`gkit run script.ts` 或 persistent REPL**
   - 优点：中间数据与控制流留在 runtime。
   - 拒绝原因：当前宿主已有 shell；真正安全的 code runner需要 sandbox、network broker、resource limits 与 credential isolation。没有真实 shell-less 场景前不承担这套复杂度。

4. **所有 provider 强制使用 TypeScript/REST**
   - 优点：单语言构建和部署看起来更简单。
   - 拒绝原因：会放弃 Google Ads 官方 Python SDK 的 auth、protobuf/service stubs、SearchStream、错误模型和版本兼容支持；单语言不是 agent-facing requirement。

**Consequences:**

- 正面：一个入口、渐进发现、provider 语义不丢失、共享安全 policy，同时允许每个 provider 使用最佳官方 SDK。
- 负面：polyglot adapter 需要 setup/doctor、进程协议测试和 runtime version 管理。
- 中性：provider adapter 未来可以拆成无 binary 的内部 package，但 agent-facing surface 始终只有 `gkit`。
- 中性：未来 MCP/code-mode surface 是对同一 modules 的 projection，不是 gkit 内核。

## 7. 实施计划

### Task 1: 建立单 public package、单 binary 的 core skeleton

**Files:**

- Replace: `package.json`
- Create: `bin/gkit.js`
- Create: `src/cli.ts`
- Create: `src/schema.ts`
- Create: `src/core/types.ts`
- Create: `src/core/define-provider.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/output.ts`
- Create: `src/providers/index.ts`
- Create: `src/testing/fake-provider.ts`
- Create: `test/schema.test.ts`
- Create: `test/provider-boundary.test.ts`
- Replace: `tsconfig.json`
- Replace: `vitest.config.ts`

**Step 1: 写失败测试**

```ts
expect(run(['--schema']).stdout).toContain('search')
expect(run(['--schema']).stdout).toContain('describe')
expect(run(['--schema']).stdout).toContain('profile')
expect(run(['--schema']).stdout).toContain('dataforseo')
expect(run(['--schema=.dataforseo']).stdout).not.toContain('posthog')
```

**Step 2: 建立 root contract**

Root package identity 固定为：

```json
{
	"name": "@deniffer/gkit",
	"bin": { "gkit": "bin/gkit.js" }
}
```

Root schema 只包含：

```text
search
describe
profile
dataforseo
gsc
google-ads
posthog
bing
```

`ProviderModule` 是内部 interface，不发布 plugin API。Provider lazy import；search/schema 不初始化 provider client。

**Step 3: 验证**

```bash
bun test test/schema.test.ts test/provider-boundary.test.ts
bun run check-types
bun run ./src/cli.ts --schema
```

**Step 4: Commit**

```bash
git add package.json bin src test tsconfig.json vitest.config.ts
git commit -m "feat: establish single gkit runtime"
```

### Task 2: 实现全局 discovery projection

**Files:**

- Create: `src/catalog/types.ts`
- Create: `src/catalog/index.ts`
- Create: `src/catalog/search.ts`
- Create: `src/catalog/describe.ts`
- Create: `src/catalog/search.test.ts`
- Create: `src/catalog/describe.test.ts`
- Create: `src/handlers/search.ts`
- Create: `src/handlers/describe.ts`
- Modify: `src/schema.ts`
- Modify: `src/cli.ts`

**Contract:**

- Search 只返回 summary、kind、owner、effects、exact command。
- Describe 一次只返回一个 capability 的 input/output schema、examples、docs、source revision。
- Curated entries 从 command definition 派生。
- Provider entries 从 provider module 的 generated/local manifest 派生。
- Catalog 不落数据库，不成为独立 versioned domain。

**Tests:**

```ts
expect(search('campaign performance')[0].kind).toBe('curated')
expect(describe(id).command).toMatch(/^gkit google-ads /)
expect(() => describe('missing')).toThrowError('CAPABILITY_NOT_FOUND')
```

```bash
bun test src/catalog
git add src/catalog src/handlers src/schema.ts src/cli.ts
git commit -m "feat: add progressive capability discovery"
```

### Task 3: 实现 App profile resolution

**Files:**

- Create: `src/profile/types.ts`
- Create: `src/profile/paths.ts`
- Create: `src/profile/load.ts`
- Create: `src/profile/validate.ts`
- Create: `src/profile/secrets.ts`
- Create: `src/profile/context.ts`
- Create: `src/profile/load.test.ts`
- Create: `src/profile/validate.test.ts`
- Create: `src/profile/context.test.ts`
- Create: `src/handlers/profile.ts`
- Modify: `src/schema.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/define-provider.ts`

**Required tests:**

```ts
it("requires a profile for provider execution", ...);
it("prefers --profile over GKIT_PROFILE", ...);
it("loads exactly one named profile", ...);
it("gives app-a and app-b different provider contexts", ...);
it("rejects a profile whose filename and name differ", ...);
it("validates each provider section with its provider schema", ...);
it("resolves only env: secret references", ...);
it("never resolves secrets for search or describe", ...);
it("does not expose another profile section to a handler", ...);
it("shows profile config without resolving secret values", ...);
```

**Commands:**

```bash
gkit profile list
gkit profile show --name app-a
gkit profile validate --name app-a
gkit --profile app-a posthog doctor
```

`profile validate` 检查 JSON、version、name、provider config schema 和 secret reference format；不要求 secret 当前已注入。Provider doctor 才解析 secret 并检查 readiness。

```bash
bun test src/profile
git add src/profile src/handlers/profile.ts src/schema.ts src/cli.ts src/core/define-provider.ts
git commit -m "feat: add app-scoped gkit profiles"
```

### Task 4: 实现 effect、secret、artifact 和错误 policy

**Files:**

- Create: `src/core/effects.ts`
- Create: `src/core/effects.test.ts`
- Create: `src/core/artifacts.ts`
- Create: `src/core/artifacts.test.ts`
- Create: `src/core/command.ts`
- Modify: `src/core/output.ts`
- Modify: `src/core/errors.ts`

**Required tests:**

```ts
it("allows read by default", ...);
it("blocks spend before handler invocation", ...);
it("requires two gates for destructive write", ...);
it("redacts resolved profile secrets from every error path", ...);
it("writes full data to --out and prints only a receipt", ...);
```

Provider handler 只接收已选择 profile 的 `ProviderContext`；input schema 禁止 credential fields。Artifact metadata 可以记录 profile 名，但不能记录 secret reference 的解析值。

```bash
bun test src/core src/profile
git add src/core src/profile
git commit -m "feat: enforce gkit execution policy"
```

### Task 5: 实现 polyglot provider executor protocol

**Files:**

- Create: `src/runtime/types.ts`
- Create: `src/runtime/in-process.ts`
- Create: `src/runtime/process.ts`
- Create: `src/runtime/process.test.ts`
- Create: `src/runtime/protocol.ts`
- Create: `src/runtime/protocol.test.ts`
- Create: `src/runtime/environment.ts`
- Create: `src/runtime/environment.test.ts`
- Modify: `src/core/define-provider.ts`
- Modify: `src/core/errors.ts`

**Protocol types:**

```ts
type ProviderProcessRequest = {
	version: 1
	command: string
	input: unknown
	context: { profile: string; config: Record<string, unknown> }
}

type ProviderProcessResponse =
	| { ok: true; data: unknown; meta?: Record<string, unknown> }
	| { ok: false; error: ProviderError }
```

Secret value 不属于 request type。Provider-owned environment mapper 从 `ProviderContext.resolveSecret()` 构造 allowlisted child env；不继承完整 parent environment。

**Required failing tests:**

```ts
it("does not spawn a process during schema or discovery", ...);
it("writes exactly one non-secret JSON request to stdin", ...);
it("parses exactly one JSON response from stdout", ...);
it("keeps stderr out of the JSON response", ...);
it("passes only provider-allowlisted environment variables", ...);
it("kills a provider process after its timeout", ...);
it("maps malformed stdout and non-zero exit to a runtime error", ...);
it("redacts child environment values from every failure", ...);
```

第一版使用 one-shot process：一次 command 启动一次 runtime。不要增加 daemon、socket pool、persistent worker 或跨调用内存状态。

```bash
bun test src/runtime
git add src/runtime src/core/define-provider.ts src/core/errors.ts
git commit -m "feat: add polyglot provider runtime protocol"
```

### Task 6: 用 DataForSEO 验证 in-process 纵切

**Files:**

- Create: `src/providers/dataforseo/index.ts`
- Create: `src/providers/dataforseo/schema.ts`
- Create: `src/providers/dataforseo/catalog.ts`
- Create: `src/providers/dataforseo/effect-overrides.ts`
- Create: `src/providers/dataforseo/transport.ts`
- Create: `src/providers/dataforseo/doctor.ts`
- Create: `src/providers/dataforseo/api-call.ts`
- Create: `src/providers/dataforseo/*.test.ts`
- Create: `scripts/generate-dataforseo-manifest.ts`
- Create: `scripts/fixtures/dataforseo-openapi.yaml`
- Create: `generated/dataforseo/index.json`
- Create: `generated/dataforseo/operations.json`
- Modify: `src/providers/index.ts`

**Behavior:**

- DataForSEO 使用 TypeScript in-process runtime，验证同一 `ProviderModule` contract 不要求 subprocess。
- Generator 从 pinned 官方 OpenAPI 生成 compact index 与 operation definitions。
- 每个 definition 记录 revision/checksum/schema quality/effects。
- Effect 由生成候选加显式 reviewed override 决定；无法确认的 operation 不发布。
- `api call` 只接受生成 manifest 中的 operation ID。
- Provider origin 固定；不接受 URL、header 或 credential input。
- Spend operation 在 transport 前被 core 拦截。
- Raw response 保留，cost/request ID 提升到 `meta`。
- Search/describe 完全离线。

```bash
bun run generate:dataforseo -- --check
bun test src/providers/dataforseo
bun run ./src/cli.ts search --query "bulk backlink ranks"
bun run ./src/cli.ts describe --id dataforseo.backlinks.bulk_ranks.live
```

```bash
git add src/providers/dataforseo scripts generated/dataforseo src/providers/index.ts
git commit -m "feat: add DataForSEO provider module"
```

### Task 7: 使用官方 Python SDK 实现 Google Ads module

**Files:**

- Create: `src/providers/google-ads/index.ts`
- Create: `src/providers/google-ads/schema.ts`
- Create: `src/providers/google-ads/catalog.ts`
- Create: `src/providers/google-ads/executor.ts`
- Create: `src/providers/google-ads/setup.ts`
- Create: `src/providers/google-ads/doctor.ts`
- Create: `src/providers/google-ads/*.test.ts`
- Create: `src/providers/google-ads/runtime/google_ads_provider.py`
- Create: `src/providers/google-ads/runtime/requirements.lock`
- Create: `src/providers/google-ads/runtime/protocol_test.py`
- Create: `generated/google-ads/manifest.json`
- Modify: `src/providers/index.ts`

**Behavior:**

- `requirements.lock` 固定 Google 官方 `google-ads` Python SDK；SDK version 必须与 pinned Google Ads API major version 兼容，manifest 记录 version/sunset metadata。
- `gkit google-ads setup` 在 gkit cache root 创建 managed virtualenv，不写入 npm package 目录。
- TypeScript `executor.ts` 只负责 process lifecycle、profile config 和 allowlisted child env；不重新实现 Google Ads REST client。
- Python executor 使用 `GoogleAdsClient`、`GoogleAdsFieldService` 和 `GoogleAdsService.SearchStream`。
- `fields search/describe` 与 `query gaql` 通过 `gkit-provider-v1` JSON protocol 暴露，保留 GAQL/provider-native output。
- Credential value 只通过 child environment 注入；stdin request、argv、stdout、stderr 和 artifact 均不得包含 credential。
- `doctor` 分别报告 Python、virtualenv、SDK import、SDK/API version、profile credentials 和可选无副作用 probe；setup 未完成时给出 `gkit google-ads setup` hint。
- 第一版不开放 mutate；effect core 已为后续 write 做好边界。

**Required tests:**

```ts
it("does not require Python for gkit search or describe", ...);
it("reports setup_required when the managed runtime is missing", ...);
it("injects only normalized Google Ads credential env keys", ...);
it("maps GoogleAdsException without leaking request headers", ...);
it("returns field metadata and GAQL rows through the common envelope", ...);
```

```bash
bun test src/providers/google-ads
bun run ./src/cli.ts google-ads setup
bun run ./src/cli.ts --profile app-a google-ads doctor
bun run ./src/cli.ts --profile app-a google-ads fields describe --name campaign.status
git add src/providers/google-ads generated/google-ads src/providers/index.ts
git commit -m "feat: add official Google Ads Python provider"
```

### Task 8: 接入 GSC、PostHog 和 Bing modules

**Files:**

- Create: `src/providers/gsc/**`
- Create: `src/providers/posthog/**`
- Create: `src/providers/bing/**`
- Create: `scripts/generate-gsc-manifest.ts`
- Create: `scripts/generate-bing-manifest.ts`
- Create: `generated/gsc/**`
- Create: `generated/posthog/**`
- Create: `generated/bing/**`
- Modify: `src/providers/index.ts`

**Provider-specific acceptance:**

- GSC：Discovery 生成 methods；read/write effect 分开；Search Analytics POST 仍标 read。
- PostHog：HogQL/query 作为动态 native capability；默认 limit；OpenAPI read operations 可发现。
- Bing：WSDL/interface 生成 method inventory；API key 永不出现在打印 URL；未知 effect 默认隐藏。
- 每个 module 独立 doctor；缺 credential 不影响 root discovery。

```bash
bun test src/providers/gsc src/providers/posthog src/providers/bing
bun run ./src/cli.ts --schema
git add src/providers scripts generated
git commit -m "feat: add remaining gkit provider modules"
```

### Task 9: 用 eval 决定 curated commands

**Files:**

- Create: `evals/tasks.jsonl`
- Create: `evals/README.md`
- Create: `evals/baseline.md`
- Create: `src/providers/*/curated/**` only for promoted tasks

建立 40 个 prompts：

- 10 个明确 provider；
- 15 个只描述业务目标；
- 10 个长尾 native；
- 5 个 unsupported/negative。

目标：

- provider top-1 ≥ 95%；
- correct capability kind top-1 ≥ 90%；
- negative precision ≥ 95%；
- discovery 不超过两步；
- first executable command ≥ 90%；
- root schema ≤ context 的 1%–5%。

Promotion rule：同一 native workflow 至少真实出现 3 次，并且 curated contract 能明显减少失败、context 或调用次数，才加入 provider 的 `curated/`。Cross-provider report/decision 不进入 gkit。

```bash
git add evals src/providers/*/curated
git commit -m "feat: promote evaluated provider reads"
```

### Task 10: 原子 cutover，删除旧架构

**Files:**

- Delete: `packages/`
- Delete: `scripts/sync-product-growth-runtime.ts`
- Delete: old package and `product-growth-tools` profile/runtime documentation
- Rewrite: `README.md`
- Rewrite: `.github/workflows/ci.yml`
- Rewrite: `.github/workflows/npm-publish.yml`

没有 aliases、deprecated binaries、compat adapters 或 config migration。最终公开发布物只有一个 package 和一个 `gkit` binary；内部 provider runtime 不暴露 binary。

```bash
rg -n "@deniffer/(gsc|google-ads|posthog|backlink|serp-snapshot|ai-optimization)-cli|product-growth-tools|PRODUCT_GROWTH_PROFILE" . \
  --glob '!docs/plans/**'
```

Expected: 无旧 runtime/package/config contract 命中。

```bash
bun install
bun run check-types
bun test
npm pack --dry-run --json
bun run ./src/cli.ts --schema
```

```bash
git add -A
git commit -m "refactor: replace provider CLIs with gkit"
```

## 8. 扩张门槛

- Provider 选择错误率仍高于 10%：才改进 global search ranking。
- Keyword/BM25 top-5 recall 低于 90%：才考虑 embedding search。
- Shell-less workflow 成为真实需求：才设计 sandboxed `gkit exec`。
- 第三方 provider 需要独立发布：才抽 external plugin protocol。
- 多 provider async task 真的需要统一监控：才设计 job subsystem。
- Write capability 有真实用例：才逐 provider 开放，并增加 dry-run/idempotency/audit contract。

## 9. Review gates

请只判断七个根决策：

1. 一个 public package、一个 `gkit` binary，不保留或新增 provider CLI。
2. 全局 `search/describe` 只负责发现；执行始终在 provider namespace。
3. shell/script 是默认 code mode，不做 REPL 或通用 code runner。
4. Profile 是 App context：保存 provider defaults 和 `env:` secret references；一次执行只能绑定一个 profile。
5. gkit 不存明文 secret，credential value 只由 environment/secret runner 注入。
6. Provider adapter 可以使用最佳官方 runtime；Google Ads 使用官方 Python SDK，而不是强制 TypeScript REST。
7. Curated command 由 eval 晋升，不按旧 package 清单迁移。

这七点确认后，后面的 provider 细节都只是 module implementation，不再影响系统形态。

## References

- [MCP Client Best Practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Cloudflare: Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)
- [DataForSEO OpenAPI](https://github.com/dataforseo/OpenApiDocumentation)
- [Google Ads GAQL](https://developers.google.com/google-ads/api/docs/query/overview)
- [Google Ads field metadata](https://developers.google.com/google-ads/api/docs/concepts/field-service)
- [Google Ads official client libraries](https://developers.google.com/google-ads/api/docs/client-libs)
- [Google Ads Python client](https://developers.google.com/google-ads/api/docs/client-libs/python/)
- [GSC Discovery document](https://searchconsole.googleapis.com/$discovery/rest?version=v1)
- [PostHog Query API](https://posthog.com/docs/api/queries)
