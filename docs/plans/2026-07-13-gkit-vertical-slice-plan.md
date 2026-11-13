---
type: Proposal
title: gkit Vertical-Slice Plan — Single TS Runtime, Grown Not Built
description: >
  gkit 的另一版 0→1 方案:锁死六条不变量(profile/effect/envelope/落盘/无全局 run/spend outcome),
  纯 Bun/TypeScript 单进程,纵切生长、逐包退役,内建 search 与 polyglot runtime 延后。
status: active
version: 0.8
timestamp: 2026-07-14T13:53:13+08:00
resource: ./2026-07-13-gkit-provider-native-agent-surface.md
---

# gkit Vertical-Slice Plan — Single TS Runtime, Grown Not Built

本方案是 [provider-native-agent-surface](./2026-07-13-gkit-provider-native-agent-surface.md) 的对案。终态愿景大部分一致(单 binary、profile 即 App context、effect 门控、provider 语义不丢失、shell 即 code mode);分歧在**路径与两处终态修正**:

1. **纵切生长**:抽象必须有两个真实实例才允许存在,不预先铺设五层 core;
2. **逐包退役**:每当新面覆盖旧 CLI 的真实用法就删那一个包,没有原子 cutover;
3. **内建 search 延后**:发现面从生成的 manifest + markdown 文档开始,agent 用 `rg` 检索;
4. **polyglot runtime 延后**:v1 优先用 REST in-process TypeScript——Google Ads 的 GAQL、field metadata 与 Keyword Planner 都先通过真实账号 spike 验证;只有 spike 通过后才锁定无 Python 的 v1 路径;
5. **不发 npm**:内部工具,`bun link` 分发;发布是分发决策,与架构无关。

**Goal:** 一个 `gkit` binary,让 agent 替任一 App 安全地(不泄密、不误花钱)、低 context 成本地调用增长数据 provider;工具跟随真实增长工作流每周演化。

**Tech Stack:** Bun、TypeScript、argc v7.5.0、Valibot、Ajv、Vitest。v1 暂定无 Python、无 subprocess 协议、无 npm 发布物;Google Ads runtime 结论以 Slice 1.5 gate 为准。

**argc 边界:** 2026-07-13 已核对并固定当时最新稳定版 v7.5.0。gkit 使用其 `c`/`group`/`generateSchema`/`selectSchema` 生成离线发现 schema;public argv dispatcher 仍由 gkit 持有,因为 v7 原生 runner 的 dotted command、`@run`、YAML/error/exit 行为不满足本方案锁定的 spaced command 与单 JSON envelope contract。升级 argc 时先跑 schema/process golden,不静默改变 public surface。

---

## 1. 问题定义与稀缺资源

唯一用户是一个有 shell 的 agent,替多个 App 回答增长问题。稀缺资源按真实代价排序:

1. **钱** — DataForSEO 按调用计费;误调用是不可逆损失;
2. **凭证** — secret 进入 argv/transcript/artifact 即永久暴露;
3. **context tokens** — provider API 面有数千 operation,不能全量进模型;
4. **回合数** — 每次失败重试都是真实延迟。

不在清单上的:人类交互易用性、多语言纯洁性、npm 分发、第三方 plugin。它们不产生本方案的任何需求。

## 2. 六条不变量

以下六条从第 1 节直接推出,是本方案唯一"先于实例"锁死的设计。其余一切抽象等真实重复出现后再提炼。

### 2.1 执行必须绑定一个 App profile

```text
gkit --profile <app> <provider> ...    # 或 GKIT_PROFILE=<app>,flag 优先
```

- 一次 invocation 只绑定一个 profile;不隐式 merge、不 fallback。
- Profile 保存非敏感 provider defaults 和 `env:` secret references,不存明文 secret。
- 外部 secret runner(Bitwarden/1Password → env)负责注入;gkit 不实现 vault client。
- 发现类命令(describe、docs)不加载 profile、不解析 secret、不访问网络。

Profile 文件:`$XDG_CONFIG_HOME/gkit/profiles/<name>.json`(未设置时 `~/.config/gkit/profiles/<name>.json`)。

```json
{
	"version": 1,
	"name": "app-a",
	"providers": {
		"dataforseo": {
			"config": {},
			"policy": { "maxSpendUsdPerCall": "0.50" },
			"secrets": {
				"login": "env:APP_A_DATAFORSEO_LOGIN",
				"password": "env:APP_A_DATAFORSEO_PASSWORD"
			}
		},
		"posthog": {
			"config": { "host": "https://us.posthog.com", "projectId": "12345" },
			"secrets": { "apiToken": "env:APP_A_POSTHOG_TOKEN" }
		},
		"gsc": {
			"config": { "siteUrl": "sc-domain:app-a.com" },
			"secrets": { "credentialsJson": "env:APP_A_GSC_CREDENTIALS_JSON" }
		},
		"google-ads": {
			"config": {
				"customerId": "1234567890"
			},
			"secrets": {
				"developerToken": "env:APP_A_GOOGLE_ADS_DEVELOPER_TOKEN",
				"serviceAccountFile": "env:APP_A_GOOGLE_ADS_SERVICE_ACCOUNT_FILE"
			}
		}
	}
}
```

注意:示例覆盖第一个纵切 provider(DataForSEO)——第一次端到端跑通时它就是参考实现。

### 2.2 Effect 由人显式标注,门控在 handler 之前

```text
read          默认允许
spend         必须 --allow-spend,且有不超过 profile hard cap 的金额上界
write         必须 --allow-write
destructive   必须 --allow-write --allow-destructive
```

Effect 不可按 HTTP method 推断(GSC Search Analytics 是 POST+read;DataForSEO Live 是 POST+read+spend)。生成器只产出候选,发布前必须人工 review;无法确认 effect 的 capability 不进入 manifest。

- `--allow-spend` 只是本次 invocation 的确认,不能写入 profile 作为永久授权。
- 每个启用 `spend` 的 profile 必须配置 `maxSpendUsdPerCall`(十进制字符串),每次 invocation 还必须显式传 `--max-spend-usd <decimal>`;运行时全部转为整数 micros 比较,禁止浮点金额运算。
- executable manifest 必须带 reviewed cost model,能从输入计算保守上界,或把 provider 原生 hard ceiling 写入请求。`--max-spend-usd` 只是本次授权上限,不能替代 cost model。算不出上界、上界超过 invocation/profile 任一 cap、或输入无法约束时,均在 transport 前以 `EFFECT_NOT_ALLOWED` 拒绝。
- 两个 cap 是 client-side preflight,不是 provider escrow。若 provider 报告的实际 cost 超过 reviewed/authorized 上界,仍按真实金额 settle ledger,并在同一个 durable settlement event 标记 `policyBreach:true`,返回不可重试的 `SPEND_POLICY_BREACH`。同一 capability + cost-policy revision 的后续调用在 secret resolution 前阻断;只有新的 reviewed cost-policy revision 才解除,不提供静默/手工 bypass。
- v1 对 `spend` 调用不做自动 retry。`--allow-spend`、金额上界和 ledger 授权必须在每次真实 dispatch 前重新成立。
- 固定执行顺序:解析 manifest record → 校验不含 secret 的 input/profile config → effect/cost gate → 只解析当前 provider 所需 secret → durable authorization → lazy-load adapter → transport。gate 失败时 secret resolver、provider module 和 transport 的调用次数都必须是 0。
- `--dry-run` 在 effect/cost gate 后停止,输出 redacted request plan 与计算出的上界;不解析 secret、不写 authorized event、不加载 adapter、不访问网络。

### 2.3 统一 envelope 与闭合错误码

成功:

```json
{
	"ok": true,
	"data": {},
	"meta": {
		"profile": "app-a",
		"provider": "dataforseo",
		"capability": "dataforseo.backlinks.bulk_ranks.live",
		"effects": ["read", "spend"],
		"cost": { "amount": "0.020000", "currency": "USD" },
		"artifact": null,
		"attemptId": "01J...",
		"spendOutcome": "confirmed_charged",
		"providerRequestId": "provider-request-id"
	}
}
```

失败:

```json
{
	"ok": false,
	"error": {
		"code": "EFFECT_NOT_ALLOWED",
		"message": "This capability can spend provider credits.",
		"hint": "Review the request, then rerun with --allow-spend.",
		"retryable": false,
		"outcome": "not_dispatched",
		"details": null
	}
}
```

错误码是**闭合集合**,每个失败场景有唯一归属。`details` 只保留经过 allowlist 投影与 redaction 的 provider 字段(如 request ID、HTTP status、provider code),禁止塞入原始 response、headers、完整 URL 或 exception object:

```text
CAPABILITY_NOT_FOUND   describe/call 的 ID 不在 manifest
INVALID_INPUT          input 未过 schema 校验(网络调用前)
PROFILE_ERROR          profile 缺失 / name-file 不一致 / schema 不合法 / secret env 未注入
EFFECT_NOT_ALLOWED     缺少对应 --allow-* gate,或 spend cost bound/cap 不成立(transport 前)
AUTH_FAILED            provider 返回 401/403
RATE_LIMITED           provider 返回 429;是否可重试取决于 effect/idempotency
TIMEOUT                请求超时;retryable 取决于 dispatch 阶段与 effect/idempotency
NETWORK_ERROR          连接层失败;retryable 取决于是否已 dispatch
UNKNOWN_OUTCOME        请求已 dispatch,但无法确认 provider 是否完成;retryable: false
SPEND_POLICY_BREACH    provider 报告实际 cost 超过授权上界;outcome: confirmed,retryable: false
CANCELLED              第一次 SIGINT 在 dispatch 前或已安全确认取消;retryable: false
PROVIDER_ERROR         provider 业务错误;安全投影在 details
LOCAL_IO_ERROR         artifact/ledger 本地读写失败;outcome 取决于 dispatch 是否已发生
INTERNAL_ERROR         gkit 自身缺陷;附复现信息
```

失败 envelope 的 `outcome` 是闭合枚举:`not_dispatched | confirmed | unknown`。`confirmed` 只表示 provider outcome 已知(可能成功、业务失败或已产生 effect),具体 effect/cost 事实放在 meta/ledger。任何 effectful 请求一旦越过 dispatch 边界,timeout、断连、进程中断或响应解析失败都不得声称“未发生”;不能从 provider request ID/状态查询确认时返回 `UNKNOWN_OUTCOME`。对 `spend` 的 unknown outcome 必须先人工/程序化对账,不能建议盲重试。

所有 spend success/error/artifact receipt 都必须返回 `attemptId`、`spendOutcome` 与可得的 `providerRequestId`,使 shell 输出能和 ledger 唯一关联。provider outcome 已确认但 settlement append 失败时,返回 `LOCAL_IO_ERROR`、`outcome:"confirmed"`、`retryable:false`,并携带这些字段及已完成的 artifact receipt;不得建议重新调用 provider。

Provider 执行命令的 shell process contract 也从第一天固定:

- stdout 恰好一个 JSON envelope 加换行;human diagnostics 只进 stderr。`--help`、`--schema`、`describe`、`docs` 仍按各自发现 contract 输出。
- `ok:true` 退出 0;任一规范化 `ok:false`(包括 argv/input 错误)退出 1。第一次 SIGINT 进入 graceful cleanup:dispatch 前返回 `CANCELLED`,effectful dispatch 后不能确认则返回 `UNKNOWN_OUTCOME`,输出 envelope 后退出 130。第二次 SIGINT/SIGKILL 属于 one-envelope contract 的唯一例外,悬空 authorized event 仍可在下次读取时识别为 unknown。
- transport、artifact 和 ledger 的清理完成后才输出最终 envelope;不得先报成功再异步落盘。

### 2.4 大结果落盘,secret 永不进入输出

- 大结果通过 `--out <path>` 落盘;stdout 只返回 receipt(absolute canonical path、bytes、sha256、cost、attempt ID/outcome)。同目录创建 mode `0600` 的临时文件,并持有 per-destination lock 覆盖 existence check、写入、flush/fsync、sha256 与 atomic rename 全过程。默认 no-replace;无 `--force` 的并发 writer 恰好一个成功,其余返回 `LOCAL_IO_ERROR` 且不得改变成功文件;`--force` 也必须串行。任一步失败都删除临时文件并返回失败 envelope。
- 日志只写 stderr。
- stdout、stderr、error/details 与 receipt 经过已解析 secret 及其派生形式的 redaction(至少覆盖 Basic base64、OAuth access token 与 URL-encoded value);redaction 有独立测试,覆盖异常路径。
- provider artifact 是原始事实,只做 streaming secret scan,不执行文本替换。未命中时落盘 bytes 必须与规定的 provider serialization 完全一致;命中已知 secret/派生 secret 时 fail closed、删除临时文件,不产出部分 artifact。
- Secret value 不进入 argv、不进入完整打印的 URL/header。
- in-process v1 的信任边界是**仓库内置、first-party reviewed provider**。只有 trusted core config/profile layer 读取 `process.env`(`GKIT_PROFILE`、XDG 路径与当前 provider 的 secret refs);adapter 获得冻结后的最小 config/credential view,不得自行扫 env。出现第三方或不可信 provider 时,必须先引入进程隔离/权限边界,不能直接装进当前进程。

### 2.5 没有全局 `run(id, unknown)`,provider 语义原样保留

- GAQL、HogQL、operation ID + native JSON 是各 provider 的自然接口,不 normalize。
- 编排(循环、分页、join、跨 App 比较)由 shell/jq/TS script 完成;不做 REPL、不做通用 code runner。
- 跨 App 比较 = 显式执行两个 profile 后在 shell join,绝不在一次 invocation 内混合。

### 2.6 Spend outcome 与账本先于成功响应

- 每次 spend dispatch 必须有稳定 `attemptId`,并在 transport 前持久化 authorized event;没有 durable authorization record 就不发请求。
- 终态必须是 `confirmed_charged | confirmed_not_charged | unknown`;成功 envelope 只对应已确认业务结果,不把“收到 HTTP response”等同于“未扣费”或“已完成”。
- provider request/task ID 一旦可得立即写账;进程崩溃留下的 authorized-without-settlement 视为 `unknown`,由 `gkit ledger`/shell 对账。
- 同一 `provider + capability + inputSha256` 存在未结算/unknown attempt 时,后续相同请求在 secret resolution 前阻断;必须先用 provider evidence 完成显式 reconcile,不能靠再次传 `--allow-spend` 绕过。
- artifact 写失败不反转 provider 事实:若调用已确认扣费,账本仍记 `confirmed_charged`,CLI 返回 artifact failure 并在 meta/error 中给出 attempt ID。

## 3. 发现面:reviewed executable manifest 是单一事实源

Agent 已经有 `rg`。从 Slice 1 起先固定可执行数据流;Slice 2 再把它接到可重建的 upstream generation:

```text
Slice 1: reviewed executable manifest
           -> runtime routing + input validation + effect/cost gate + describe

Slice 2+: pinned local upstream snapshot + reviewed exposure/effect/cost policy
           -> reviewed executable manifest
           -> runtime routing + input validation + effect/cost gate
           -> describe + markdown docs
```

同一条 capability 在 runtime、effect gate、describe 和 docs 中只能来自同一条 reviewed manifest record,禁止再维护手写 registry/handler schema 作为第二事实源。产物:

```text
generated/<provider>/manifest.json     # 唯一可执行清单:id/schema/effects/cost model/adapter key/revision
generated/<provider>/inventory.json    # 可选全量 contract 索引;不可路由、不可执行
docs/providers/<provider>/<area>.md    # 只从 executable manifest 渲染;agent 用 rg 检索
```

命令面:

```bash
gkit --schema                          # root:providers + 顶层命令,目标 < 2,000 tokens
gkit describe --id <capability-id>     # 一次展开一个 capability 的完整 schema 与示例
gkit docs [--provider <p>]             # 打印文档目录路径,agent 自行 rg
```

规则:

- upstream snapshot 固定在仓库内并记录 source URL、revision、checksum。普通 build/`--check` 完全离线且可字节稳定重建;联网更新只能走显式 `refresh:<provider>` 命令并产生可 review diff。
- generator 的 reviewed policy 是**构建输入**,runtime 不读取它;runtime 只读取已提交的 executable manifest。未 reviewed/无法确定 effect 或 cost bound 的 operation 可以进入 inventory,不能进入 executable manifest。
- 每条 review approval 绑定 upstream source checksum;source 变化时旧 approval 自动失效,对应 capability 在重新 review 前从 executable manifest 隐藏。
- describe/docs 完全离线,不加载 profile。
- **不实现 `gkit search`**。扩张门槛:eval 中 agent 用 `rg` + describe 的两步发现成功率 < 90% 时,才评估内建 BM25 search。

## 4. Provider 映射(全部 in-process TypeScript)

| Provider       | Contract 来源                                                                                                   | 执行面                                                                                  | 认证                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| DataForSEO     | 官方 OpenAPI(pinned)                                                                                            | `api call --operation-id <id> --input @req.json`                                        | basic auth(login/password)                                                                               |
| GSC            | Google Discovery                                                                                                | `search-analytics query` 等 resource/method                                             | service account JSON                                                                                     |
| PostHog        | Query API + OpenAPI reads                                                                                       | `query hogql --input @query.json`                                                       | personal API token                                                                                       |
| Google Ads     | 官方 REST reference(`googleAds:search`、`googleAdsFields:search`、Keyword Plan services),固定 API major version | `query gaql`(默认显式分页)、`fields search/describe`、经保留决策的 Keyword Planner read | service-account JSON(当前 profile)或 OAuth2 refresh token + developer token;access token 作为派生 secret |
| Bing Webmaster | 现有 JSON REST API contract,WSDL 仅在 REST 不覆盖时考虑                                                         | provider method + native input                                                          | 现有 API key 走 `apikey` query parameter(完整 URL 永不打印);未来采用 OAuth 时才用 Bearer                 |

关于 Google Ads 的决策:v1 的 bounded read surface 走 REST;默认使用可控的 `googleAds:search` 分页,不以 `searchStream` 一次吞入任意大结果。Slice 1.5 已用真实账号覆盖 service-account OAuth、field metadata、request ID/error projection、分页和当前 Keyword Planner 用法;真实 profile 没有 MCC,因此 manager account header 仍是暴露该能力前的独立 live gate。当前唯一消费者的单账户 surface 不被这个缺口阻断。未来若开放 mutate、REST 无法覆盖必需能力或引入不可信依赖,再设计 polyglot/isolated runtime。

## 5. Spend ledger

钱是第一稀缺资源,从纵切第一天起记账:

```text
$XDG_STATE_HOME/gkit/ledger.jsonl      # 未设置时 ~/.local/state/gkit/ledger.jsonl
```

账本是 append-only attempt event stream,不是“成功调用列表”:

```json
{"type":"authorized","eventId":"...","attemptId":"...","ts":"...","profile":"app-a","provider":"dataforseo","capability":"...","manifestRevision":"...","costPolicyRevision":"...","inputSha256":"...","maxCostMicros":50000,"acknowledgement":{"allowSpend":true,"invocationMaxCostMicros":50000},"currency":"USD"}
{"type":"settled","eventId":"...","attemptId":"...","ts":"...","outcome":"confirmed_charged","costMicros":20000,"providerRequestId":"...","policyBreach":false}
```

- `authorized` 必须在 transport 前 durable;`settled` 在确认 `confirmed_charged | confirmed_not_charged | unknown` 后追加。悬空 authorized 记录按 unknown 处理。
- 每行 canonical JSON 由单次 append 写入;每个 event 有唯一 `eventId`,读取时去重;使用 ledger 级锁防并发 writer 交错,flush/fsync 后才继续。测试必须包含多个独立进程并发写。
- cost 使用整数 micros;unknown 时允许 `costMicros:null`,但保留授权上界与 request/task ID。
- `gkit ledger` 打印文件路径、未结算/unknown 数量与 active policy breaches。`gkit ledger reconcile --attempt <id> --outcome confirmed_charged|confirmed_not_charged --evidence-ref <non-secret-ref> [--cost-usd <decimal>] [--provider-request-id <id>]` 根据 provider evidence 追加 manual settlement event,不改写历史。`confirmed_charged` 必须提供 evidence 支持的 `--cost-usd`;缺金额时保持 unknown,拒绝 settlement。manual settlement 必须读取原 authorized event 的 cap/cost-policy revision,重新计算并持久化 `policyBreach`,与自动 settlement 使用同一 quarantine 规则。明细和聚合仍交给 shell/jq。
- v1 不做跨日预算/告警,但 §2.2 的单次 hard cap、相同输入 unknown 阻断与 policy-breach quarantine 是上线前置条件。

## 6. 实施计划

### 过渡规则(适用于所有 slice)

- gkit 作为新 workspace package `packages/gkit` 加入,根 `package.json` 的 workspaces **保持不变**——旧 CLI 在被逐个退役前始终可用。
- 全局命令通过 `cd packages/gkit && bun link` 提供。
- **退役是逐包的**:先把旧 CLI 当前命令逐条标为 `replace | keep | drop`。`replace` 必须有行为 golden 与真实调用验证;`drop` 由唯一消费者显式确认。满足后才删除 package、更新根 scripts,单独 commit。无需兼容 alias 或弃用期,但不能靠“看起来相似”判定覆盖。
- 抽象规则:第二个 provider 也先直接实现和跑通,再把两个真实 diff 摊开。只有已经重复且变化方向一致的代码才提炼;“出现第二个消费者”是允许抽象的下限,不是强制创建 `ProviderModule` 的触发器。
- 每个 slice 的验证顺序固定为:offline tests/fixtures → `doctor`/`--dry-run` → sandbox 或无副作用 probe → 最小真实调用。付费 live call 永远在最后。

### 2026-07-14 implementation checkpoint

- Slice 0 已落地:10 条 eval answer key(4 explicit provider / 4 business goal / 2 negative),两个 Slice 1 executable 用例都固定 `describe/docs → --dry-run → live` 顺序。
- Slice 1 的 repository/offline 部分已落地:`packages/gkit` binary、profile/effect gate、reviewed manifest、DataForSEO bulk-ranks adapter、统一 envelope、secret-safe atomic artifact、authorized/settled ledger、manual reconciliation、doctor/docs/schema 与进程契约均已有测试。
- 离线验收:package typecheck、87 个 package tests、workspace typecheck/全量 tests、schema `< 2,000 bytes` 与 generated docs byte-stability。
- 真实 profile bridge 已完成:保留旧 `profiles/clonesite.ai/.env`,新增不含 secret 的 `clonesite.ai.json` 与 `clonesite.ai-sandbox.json` descriptor,权限均为 `0600`;两个 profile 的 `doctor` 均通过并明确返回 `networkProbe:"unknown"`,没有发网络请求。
- Production 单 target dry-run 使用精确 invocation cap `$0.024036`,前后均无 ledger 或 artifact 副作用。官方当前 Backlinks 价格仍为 `$0.024/request + $0.000036/row`,与 reviewed cost policy 一致。
- Sandbox 真实 gate 已通过且费用为 `$0`:DataForSEO sandbox 返回固定 dummy result,不会按任意请求 target 回显结果;第一次 `clonesite.ai` 输入因此被严格 result validator 以 `PROVIDER_ERROR` 拒绝,但仍安全落盘并结算为 `confirmed_not_charged`。随后使用 sandbox 固定的三个 dummy targets 完成 `ok:true` 验证。此 friction 记录在案,不据此放宽 production result contract。
- Production 最小 live call 已完成:`clonesite.ai` 返回 `rank=55`,attempt `d9fe47a2-eaf8-4a99-9e7b-dd6353f5f31e`,provider request `07140512-2032-0347-0000-2f0c9a4fb51f`,实际费用 `$0.024036`,artifact `557 bytes` / SHA-256 `f67981b9fdedf6adae0b7069a41e64a15b4817390739765b2cd361e168f53f01`。Ledger 按顺序持久化 `authorized(max=24036 micros) → settled(confirmed_charged,24036 micros)`,无 policy breach。
- Gate 后 ledger 共 3 个已结算 attempt(两次 sandbox、一次 production),`unresolved=0`,`activePolicyBreaches=0`;production artifact 与 ledger 的 resolved/Basic/URL-encoded secret 扫描均为阴性。
- Slice 1 immediate dogfood 已完成:官方 2 个 executable + 2 个 negative 用例全部真实执行并通过;证据与结论见下节。旧 CLI 仍按逐 workflow gate 退役,但不再等待日历窗口才进入下一 slice。

### Slice 1 immediate dogfood gate（2026-07-14 已完成）

**Decision:** 当前 CLI 消费者只有一人,且用户明确要求立即 dogfood,因此不设置日历等待期。Gate 直接使用仓库已有的 Slice 1 answer key:2 个 executable 用例各执行 `discovery → same-input dry-run → 单次 live`,再执行 2 个 zero-dispatch negative 用例。付费调用严格串行;出现 unknown/unresolved 就停止,不 retry 或 fallback。通过本 gate 只证明 Slice 1 的 `dataforseo.backlinks.bulk_ranks.live` 可用,不代表整个 DataForSEO surface 已替代旧 CLI。

#### 默认路由

| 真实需求                                                                      | 默认 route                                   | Dogfood 判定                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| DataForSEO backlink bulk ranks,1–166 targets                                  | 必须先走 `gkit`                              | eligible;失败按下方 fallback 规则处理                                                   |
| DataForSEO backlink bulk ranks,167–1,000 targets                              | 在 profile cost gate 阻断,要求缩小范围       | 记录 `route:"blocked"` + `friction.code:"blocked_by_profile_cap"`;不自动拆批或走 legacy |
| backlink summary/referring domains、SERP、LLM mentions 等 manifest 未覆盖能力 | 直接走对应 legacy CLI                        | `legacy_keep`;记录 capability gap,不算 gkit 失败                                        |
| unsupported write/destructive 请求                                            | 直接阻断                                     | `blocked`;必须是零 provider network call                                                |
| 跨 provider 分析/报告                                                         | 各 provider 分开取事实,再由 shell/agent join | 不进入 gkit curated surface                                                             |

本窗口的 eligible 明确定义为**当前 manifest 覆盖、且输入可被 `$0.03` profile hard cap 授权的 1–166 target bulk-ranks 任务**。当前 cost model 下 166 targets 的上界是 `$0.029976`,167 targets 是 `$0.030012`;后者必须在 pre-dispatch gate 停止。Dogfood 不隐式拆批,因为这会把一个真实任务变成多次付费 dispatch 并改变 unknown-outcome/fallback 边界。

不为了制造失败而把 manifest 未覆盖的任务先塞给 gkit,也不为了对比而同时发起 gkit 与 legacy 的付费请求。Dogfood 期间已标为 `replace` 的 eligible bulk-ranks workflow 不自动 fallback。

#### Canonical invocation 与付费边界

发现命令继续直接使用 `gkit --schema`、`gkit docs`、`gkit describe`;它们不加载 profile 或 secret。Provider invocation 显式选择 App profile;真正需要 credential 时,gkit 自动读取可选的 profile-adjacent `.env`,且进程环境优先:

```bash
gkit --profile clonesite.ai dataforseo ...
```

- 每个付费任务先以**同一 input**执行 `--dry-run`;dry-run 的 invocation cap 使用当前 profile hard cap `$0.03`,live call 再收紧为 dry-run 返回的精确 `costUpperBound.amount`,不使用宽泛的 `$0.05`。若 dry-run 计算出的上界超过 profile cap,任务停在 pre-dispatch gate。
- 只有真实 prompt 明确要求实时/provider 数据时才允许 live dispatch;仍必须传 `--allow-spend` 与精确 `--max-spend-usd`。否则只做到 discovery/dry-run。
- 本次 immediate dogfood 总预算上限固定为 **`$0.15`**,最多 **2 次 paid dispatch**,且每个 executable task 最多 1 次。实际执行 2 次,授权上界与最终费用合计均为 `$0.048180`;它不是 provider escrow,实际费用若触发 policy breach 仍会立即停止。
- 不增加 answer key 之外的付费 canary;这次 4 个官方 Slice 1 用例就是完整 gate。
- 每次 `--out` 使用新的 local-only 路径;dogfood 期间禁止 `--force`。默认目录是 `$XDG_STATE_HOME/gkit/dogfood/artifacts`（未设置时 `~/.local/state/gkit/dogfood/artifacts`）。

#### Fallback 与停止规则

- `legacy_keep` workflow 直接走 legacy,不先触发一次已知的 `CAPABILITY_NOT_FOUND`。
- Eligible gkit task 只有在同时满足 `outcome:not_dispatched`、`attemptId:null` 且 ledger 没有新增 durable authorization 时,才允许修正一次输入/调用错误。紧急任务需要 break-glass 时,还必须先确认 `gkit ledger` 的 `unresolved=0`,记录 `fallbackReason`,并用同一 reviewed cost model 证明 legacy 调用的 `externalMaxCostMicros` 不会突破剩余 window budget,才可人工执行;该任务计为 dogfood failure。
- Break-glass paid call 同样占用 2 次 dispatch 配额与 `$0.15` window budget。调用后必须从 provider/legacy artifact 提取 `externalActualCostMicros`,并记录不含 secret 的 `externalEvidenceRef`;实际费用无法确认时按 external unknown outcome 处理,立即停止 paid dogfood,且本 window 不能通过 exit gate。本次执行没有使用 break-glass。
- 一旦出现非空 `attemptId` 或 durable authorization,该 task 不再 retry/fallback/双跑。若 ledger 已 settled 为 `confirmed_charged` 或 `confirmed_not_charged`,直接记录结果,不做多余 reconcile;只有 unresolved/unknown 才必须依据 provider evidence reconcile。
- 任一出现即停止后续 paid dogfood:unresolved/unknown attempt、policy breach、费用超过授权上界、疑似 secret 泄漏、ledger/artifact integrity 异常、疑似重复 dispatch、同一 pre-dispatch friction 连续出现 2 次、或达到 window budget。

#### Local-only evidence

Raw dogfood event 已追加到 `$XDG_STATE_HOME/gkit/dogfood/events.jsonl`（未设置时 `~/.local/state/gkit/dogfood/events.jsonl`）,脱敏 command/envelope receipt 写入同目录 `receipts.jsonl`;二者都不进入 Git。Window 固定为 `slice1-2026-07-14`;前述 3 个 implementation-gate attempt 都发生在 window 前,不计入本次 dogfood 样本或预算。本次新增 4 个 event、6 个 phase receipt、2 个 paid dispatch。

每行保留足以计算 exit gate 的最小 routing evidence:

```json
{
	"ts": "<iso8601>",
	"windowId": "slice1-2026-07-14",
	"taskId": "<stable-id>",
	"kind": "explicit_provider|business_goal|negative",
	"eligible": true,
	"route": "gkit|legacy_keep|blocked|break_glass",
	"profile": "clonesite.ai|null",
	"capability": "<id|null>",
	"targetCount": 1,
	"discoverySteps": 0,
	"firstExecutableCommandCorrect": true,
	"paidDispatch": false,
	"providerNetworkCalls": 0,
	"attemptId": null,
	"artifactBytes": null,
	"artifactSha256": null,
	"externalMaxCostMicros": null,
	"externalActualCostMicros": null,
	"externalEvidenceRef": null,
	"result": "success|safe_block|failure",
	"artifactUsedDownstream": false,
	"fallbackReason": null,
	"friction": null
}
```

不适用的 `targetCount`、`firstExecutableCommandCorrect` 与 `artifactUsedDownstream` 使用 `null`;不要用默认值制造成功证据。`fallbackReason` 只在 `break_glass` 时写稳定枚举;`friction` 为 `null` 或 `{ "code": "<stable-code>", "note": "<short non-secret note>" }`。禁止记录 raw argv、request body、artifact 内容或 credential。

正常 gkit route 的费用、provider request ID、spend outcome 与 policy breach 不复制进 dogfood log,统一用同一 window 内的非空 `attemptId` join append-only ledger。只有没有 gkit attemptId 的 break-glass route 使用三个 `external*` 字段;`externalEvidenceRef` 只保存 local artifact receipt/path 等非敏感引用,不内嵌 evidence。Window 聚合时,paid dispatch 数量取所有 `paidDispatch:true` event;授权上界取 gkit authorized `maxCostMicros` 加 `externalMaxCostMicros`;实际费用取 gkit settled cost 加 `externalActualCostMicros`。窗口结束后只把脱敏聚合与结论写入 `packages/gkit/evals/baseline.md`。

#### 执行结果与 exit gate

官方 Slice 1 eval set 已一次性执行完毕:

- 2/2 negative 通过:`no_spend_negative` 只做 discovery;`unsupported_mutation_negative` 返回 exit 1 + `CAPABILITY_NOT_FOUND/outcome:not_dispatched`;两者 provider network calls 与 ledger delta 都是 0。
- Explicit-provider 用例 discovery 1 步;2-target dry-run/actual cost 均为 `$0.024072`,首次 live 成功。
- Business-goal 用例 discovery 2 步;3-target dry-run/actual cost 均为 `$0.024108`,首次 live 成功。
- 两次 paid dispatch 均为 `confirmed_charged`,各自 durable `authorized → settled`,无 retry、fallback、`--force` 或 duplicate dispatch。
- 两个 artifact 均为 `0600`,SHA-256 分别为 `a39921fb7cb06655b217dab278c13115b02d3ec71c79351534b52697696944c5` 与 `83aa4a9aabbaeb3e56fc660a94da5ea2aafbaa49c933332afdc7697eb11e65d7`,并实际用于提取 rank 事实。
- Ledger 从 3 个历史 attempt 增至 5 个,结束时 `unresolved=0`、`activePolicyBreaches=0`;两份 artifact + ledger 对 13 种 resolved/derived credential 形式扫描为阴性。

**Verdict: PASS.** Slice 1 official dogfood 4/4 通过,即时 gate 完成。该窗口观察到的 linked-command secret injection 摩擦已在后续全面 dogfood hardening 中修复;当前直接 profile invocation 不再需要外部 `bun --env-file` wrapper。

下一步进入 Slice 2 的 DataForSEO reviewed-manifest 扩张;本 gate 不直接授权删除旧 package,旧 CLI 仍按逐 workflow behavior golden + 真实验证规则单独退役。

### Slice 0: 先写 eval,不写代码

**Files:**

- Create: `packages/gkit/evals/tasks.jsonl` — 10 个真实 prompt(近期增长工作里实际问过的问题):4 个明确 provider、4 个只描述业务目标、2 个 unsupported/negative。每条 key 至少包含 provider、capability ID、effects、理想命令序列、期望 envelope/artifact/error 与对应旧 workflow 的 `replace | keep | drop`。
- Create: `packages/gkit/evals/README.md` — 评测方法:人工带 agent 跑,记录发现步数、首条可执行命令正确率与 observable behavior 是否一致。

**验收:** 10 个 prompt 都有可复查的答案 key;不只校验命令能 parse,还校验 provider request、effect/cost gate、output/error/exit/artifact 行为。写不出来的 prompt 说明设计有缺口,先改设计。

```bash
git add packages/gkit/evals
git commit -m "feat: seed gkit eval tasks"
```

### Slice 1: 纵切——DataForSEO 单 operation 端到端

目标:`gkit --profile app-a dataforseo api call --operation-id dataforseo.backlinks.bulk_ranks.live --input @req.json --allow-spend --max-spend-usd 0.05 --out r.json` 真实跑通,并当周投入使用。

**Files:**

- Create: `packages/gkit/package.json`(`"bin": {"gkit": "bin/gkit.js"}`,private)
- Create: `packages/gkit/bin/gkit.js`
- Create: `packages/gkit/src/cli.ts`
- Create: `packages/gkit/src/profile.ts` — 加载、校验、`env:` 解析,单文件
- Create: `packages/gkit/src/effects.ts` — gate 检查
- Create: `packages/gkit/src/envelope.ts` — 输出、错误码、redaction
- Create: `packages/gkit/src/ledger.ts`
- Create: `packages/gkit/src/manifest.ts` — versioned manifest schema + loader,不承担 provider 抽象
- Create: `packages/gkit/src/describe.ts` — 直接渲染同一 manifest record
- Create: `packages/gkit/generated/dataforseo/manifest.json` — 只含第一个 reviewed operation;从第一天就是 routing/schema/effects/cost/describe 的唯一事实源
- Create: `packages/gkit/src/providers/dataforseo.ts` — basic-auth transport + error projection,不另存 capability registry/schema
- Create: `packages/gkit/src/doctor.ts` — profile/secret/policy readiness;无安全无副作用 probe 时明确返回 `unknown`
- Create: `packages/gkit/src/*.test.ts`

**Required tests:**

```ts
it("requires --profile or GKIT_PROFILE for provider execution", ...);
it("prefers --profile over GKIT_PROFILE", ...);
it("fails with PROFILE_ERROR before any network call when secret env is missing", ...);
it("rejects a profile whose filename and name differ", ...);
it("blocks a spend operation without --allow-spend, before transport", ...);
it("does not resolve secrets or load the adapter when the effect gate fails", ...);
it("blocks a spend operation without a conservative cost bound or above the profile cap", ...);
it("writes durable authorized and settled ledger events around transport", ...);
it("settles the actual charge and returns SPEND_POLICY_BREACH when provider cost exceeds the bound", ...);
it("quarantines the breached cost-policy revision before secret resolution until a new reviewed revision", ...);
it("maps a post-dispatch timeout to UNKNOWN_OUTCOME and never auto-retries spend", ...);
it("treats an authorized record without settlement as unknown", ...);
it("blocks the same input hash until an explicit evidence-backed reconciliation", ...);
it("rejects charged reconciliation without cost and quarantines an over-cap manual settlement", ...);
it("returns attemptId, spendOutcome and providerRequestId in every spend envelope", ...);
it("returns non-retryable LOCAL_IO_ERROR with confirmed outcome when settlement append fails", ...);
it("keeps concurrent process ledger writes as valid complete JSON lines", ...);
it("redacts resolved and derived secrets from stdout, stderr, details and URLs", ...);
it("fails closed when an artifact contains a known secret", ...);
it("preserves artifact bytes exactly when the secret scan is clean", ...);
it("atomically writes --out, refuses overwrite by default, and prints only a receipt", ...);
it("lets exactly one no-force writer win without changing its bytes under contention", ...);
it("emits one envelope and exits 0/1/130 according to the public process contract", ...);
it("maps first SIGINT through cleanup and treats a second signal as the envelope exception", ...);
it("uses the same manifest record for route, validation, effect/cost gate and describe", ...);
```

**验证:**

```bash
bun test packages/gkit
bun run --cwd packages/gkit check-types
gkit --profile app-a dataforseo doctor
gkit --profile app-a dataforseo api call --operation-id ... --input @req.json --allow-spend --max-spend-usd 0.05 --dry-run
gkit --profile app-a dataforseo api call --operation-id ... --input @req.json --allow-spend --max-spend-usd 0.05 --out r.json
```

最后一条 live call 只有在 sandbox/fixture 通过后才执行,且必须是已核价的最小请求。

```bash
git add packages/gkit
git commit -m "feat: gkit vertical slice with dataforseo"
```

**Gate:** 执行本节定义的 2 个 executable + 2 个 negative dogfood 用例;全部通过且 ledger/secret/artifact closure 成立后进入 Slice 2。该 gate 已于 2026-07-14 完成。

### Slice 1.5: Google Ads REST feasibility spike,先验证再锁 runtime

这是一个 1–2 天、不可顺手抽象的 spike。只记录事实与决策,不删除旧包:

- 用真实 profile 完成其实际认证模式 → access token;当前 profile 是 service-account JSON,access token 立即注册为派生 secret。只有出现真实 user OAuth profile 时才增加 refresh-token mode。
- 调用 `customers:listAccessibleCustomers`、`googleAdsFields:search` 和一个小结果 GAQL;GAQL 默认走 `googleAds:search` 并显式翻页到终止,验证 `login-customer-id` manager 场景。
- 固定一个明确 API major version(禁止 `latest`/隐式默认),记录升级步骤:手工 bump → refresh snapshot → review manifest/docs diff → contract/live smoke。
- 捕获并安全投影 HTTP status、Google Ads error code、request ID;确认日志、错误、URL 与 fixture 均不含 developer/access/refresh token。
- 对现有 `google-ads-cli` 做命令级盘点,尤其验证 `keywordPlan dataset ideas` 和 `historicalMetrics` 的 REST 可覆盖性,并逐条写下 `replace | keep | drop`;没有结论前不得退役该包。
- 对大结果记录分页内存曲线与 artifact 行为;只有真实 bulk 用例证明需要时才增加 `searchStream`。

**Gate:** spike 结论必须是以下二选一并写入本文档修订版:(a) bounded read surface 可由 REST 完整承载,继续 Slice 4;(b) 有具体必需能力/可靠性缺口,先修改 runtime 决策。不能以“官方有 REST endpoint”代替真实验证。

**2026-07-14 implementation result — scoped (a), conditional pass:**

- 固定 Google Ads REST `v24`,Discovery revision `20260624`,snapshot SHA-256 `202028d3abcb9e4681d35f3c28d06e6ced1eaac2ec57c56357c8ab5d522841d7`;升级固定为手工 bump major → refresh snapshot → review source/manifest/docs diff → contract/live smoke。
- 真实 `openclaw-web` profile 使用 service-account OAuth,不是 refresh token。派生 access token 在请求前注册为 secret;developer token、access token 与 private key 均未出现在 summary 或 10 个 raw artifacts 中。
- `customers:listAccessibleCustomers`、两页 `googleAdsFields:search`、12-row GAQL、850-row 较大 GAQL、两页 Keyword Ideas、Historical Metrics 与一个预期失败 GAQL 全部真实执行。9 个 success + 1 个预期 HTTP 400;错误安全保留 `INVALID_ARGUMENT`、`queryError:UNRECOGNIZED_FIELD` 与 request ID。
- Keyword Ideas 与 Historical Metrics 的 REST 结果分别为 4 和 1 rows,与 legacy Python CLI 相同;campaign GAQL 也同为 12 rows。REST 保留 provider-native camelCase,不复制 Python protobuf converter 的 snake_case 偏好。
- 10 个 artifact 共 279,092 bytes;最大页 265,558 bytes,观测 peak heap delta 1,266,192 bytes。显式 `pageToken` + per-page artifact 足够,不引入 `searchStream`。
- 当前 profile 只有一个直接可访问的非 manager account,没有合法 manager→child 组合。因此不能声称 `login-customer-id` live gate 已通过。考虑当前 CLI 唯一消费者只需要这个单账户 profile,Slice 4 可以继续实现单账户 surface;manager behavior 必须保持不暴露/未验证,直到真实 MCC profile 完成 live smoke。
- 完整脱敏证据见 [`packages/gkit/evals/google-ads-rest-spike.md`](../../packages/gkit/evals/google-ads-rest-spike.md),逐命令 `replace | keep | drop` 见 [`packages/gkit/evals/google-ads-migration-matrix.md`](../../packages/gkit/evals/google-ads-migration-matrix.md)。旧包不删除。

### Slice 2: DataForSEO reviewed manifest + inventory/docs/describe → 按行为退役旧包

**Files:**

- Create: `packages/gkit/sources/dataforseo/**` — pinned local OpenAPI snapshot + source metadata/checksum
- Create: `packages/gkit/policy/dataforseo.reviewed.json` — 人工确认 exposure/effect/cost model,只作为 generator 输入
- Create: `packages/gkit/scripts/generate-dataforseo.ts` — 从 pinned snapshot + reviewed policy 生成 executable manifest/inventory/docs,`--check` 离线校验字节稳定
- Modify: `packages/gkit/generated/dataforseo/manifest.json` — 扩到已 review 的可执行面,不是“OpenAPI 全量即执行面”
- Create: `packages/gkit/generated/dataforseo/inventory.json`
- Create: `packages/gkit/docs/providers/dataforseo/*.md`
- Modify: `packages/gkit/src/describe.ts`
- Create: `packages/gkit/src/docs.ts`
- Modify: `src/providers/dataforseo.ts` — adapter 只按 manifest 的 adapter key dispatch;不读取 reviewed policy
- Delete: `packages/backlink-cli`、`packages/serp-snapshot-cli`、`packages/ai-optimization-cli`(三个包分别完成命令盘点、behavior golden 与最小真实验证后;不要求同一 commit 删除)
- Modify: 根 `package.json` scripts

**Contract:**

- `api call` 只接受 manifest 内的 operation ID;origin 固定,不接受任意 URL/header。
- 无法确认 exposure/effect/cost bound 的 operation 不进入 executable manifest(可留在 inventory,不可路由,不猜测)。
- runtime routing、input validation、effect/cost gate、describe 与 docs 对同一 manifest 做一致性 contract test;CI 禁止第二份可执行 registry。
- describe/docs 离线;root `--schema` < 2,000 tokens。

**2026-07-14 implementation result:**

- 固定 DataForSEO 官方 OpenAPI revision
  `2d905ad34863444e2f1eb4272f8c9569032e4628` 与 SHA-256;generator 从该
  snapshot 和 reviewed policy 字节稳定地产生 manifest、554-operation
  inventory 与 docs,`--check` 已通过。
- executable manifest 现有四项:Bulk Ranks、Backlink Summary、Referring
  Domains、Google Organic Live Advanced;其余 operation 都只在 inventory。
- Summary、Referring Domains、SERP 均通过同 input dry-run 和一次最小 live
  gate;新增实际费用 `$0.050072`,ledger 最终 `unresolved=0` 且无 policy
  breach。证据见
  [`packages/gkit/evals/slice2-baseline.md`](../../packages/gkit/evals/slice2-baseline.md)。
- LLM Mentions 保持 inventory-only:官方最低 request cost `$0.10` 高于当前
  profile 的 `$0.03/call` hard cap,不得为了迁移静默抬高 profile policy。
- 已完成命令级 migration matrix;Backlink 的 anchors/backlinks 与 page
  summary gate、SERP batch、全部 AI Optimization data workflow 仍为 `keep`,
  因此本 slice 不删除三个旧 package。见
  [`packages/gkit/evals/dataforseo-migration-matrix.md`](../../packages/gkit/evals/dataforseo-migration-matrix.md)。

```bash
bun run --cwd packages/gkit generate:dataforseo -- --check
bun test packages/gkit
gkit describe --id dataforseo.backlinks.bulk_ranks.live
git commit -m "feat: generate reviewed dataforseo manifest and docs"
```

每个通过行为 gate 的旧包另行 retire,不与 generator commit 捆绑。

### Slice 3: 第二个 provider 先纵切,再按真实重复决定是否提炼

按当周真实需求选 GSC 或 PostHog。先沿 Slice 1 的 public contracts 直接接入并跑通;完成后比较两个 adapter 的真实 diff。只有重复代码已经稳定、且提炼能删除分支/重复时,才创建最小 interface。若没有足够重复,本 slice 完成时仍可以没有 `src/core/provider.ts`。

- Conditional create: `packages/gkit/src/core/provider.ts`(需要时才出现 `src/core/`;若创建,capability descriptor 直接引用 manifest record,不另设 schema/handler registry)
- Create: `packages/gkit/src/providers/<gsc|posthog>/**` + manifest generator + docs
- Delete: 对应旧 package(完成命令级 `replace | keep | drop` 与 behavior gate 后)
- `doctor` 约定:检查 profile section、secret 注入、可选无副作用 probe;无法安全 probe 时返回 `unknown`,不伪造 ready。

**2026-07-14 implementation result:**

- 按真实重复需求选择 PostHog;固定官方 schema snapshot 与 SHA-256,生成
  2,516-operation inventory,仅 `posthog.query.run` 进入 executable manifest。
- gkit 的 schema/describe/docs 现可同时发现 DataForSEO 与 PostHog;执行仍按
  provider 独立路由,PostHog profile 只允许固定 US/EU origin、数字 project ID
  与一个 token env reference。
- `clonesite.ai` 真实 dry-run 与一次 live HogQL gate 通过:返回 10 行 × 2 列,
  raw artifact 为 2,838 bytes;token 未进入 artifact。
- 内嵌 `LIMIT`、write statement、comment bypass 均在 dispatch 前拒绝;PostHog
  read 前后 ledger 都保持 8 attempts、0 unresolved、0 breach。
- 未创建 `src/core/provider.ts`:两个 provider 的稳定公共面已经由 manifest、
  profile、envelope、discovery 与 artifact contracts 承担,但 DataForSEO 的
  spend authorization/settlement 与 PostHog 的 bounded read 执行仍有实质差异;
  此时提炼只会搬运分支,不会删除分支。
- 命令级 matrix 仅将 `query dataset results` 标为 `replace`;其余 12 个旧命令
  为 `keep`,因此不删除 `packages/posthog-cli`。证据见
  [`packages/gkit/evals/slice3-baseline.md`](../../packages/gkit/evals/slice3-baseline.md)
  与
  [`packages/gkit/evals/posthog-migration-matrix.md`](../../packages/gkit/evals/posthog-migration-matrix.md)。

```bash
git commit -m "feat: add second gkit provider"
git commit -m "refactor: extract repeated provider seam"
git commit -m "refactor: retire <old package>"
```

第二条 refactor commit 仅在真实 diff 证明需要时存在。

### Slice 4: Productize 已验证的 Google Ads REST + Bing + 剩余 provider

- Google Ads:Slice 1.5 的单账户 gate 已 conditional pass。提供 `fields search/describe`、显式分页的 `query gaql`(`googleAds:search`)以及在盘点中标为 `replace` 的 Keyword Planner read;先实现真实 profile 所需的 service-account OAuth。只有真实 profile 需要时再加入 refresh-token mode;manager account behavior 在 MCC live gate 前不暴露。不开放 mutate,`searchStream` 继续留在扩张门槛后。
- Bing:复用现有 `bing-webmaster-cli` 已验证的 JSON REST contract。API key 按 provider 要求放在 `apikey` query parameter,但 request builder 必须同时产生不含 key 的 `diagnosticUrl`;日志、错误、telemetry 只能使用后者。若未来显式切 OAuth,才改为 Bearer。
- PostHog/GSC 中未在 Slice 3 接入的那个。
- Delete: `packages/google-ads-cli`、`packages/bing-webmaster-cli`、`packages/gsc-cli`、`packages/posthog-cli`(各自完成命令盘点、behavior golden、真实 smoke 后逐个退役;Google Ads 的两条 Keyword Planner workflow 必须有显式结论)。

**Required tests(Google Ads):**

```ts
it("derives an access token from service-account credentials without logging its value", ...);
it("uses the pinned API major version", ...);
it("rejects manager profile fields and argv until the real MCC gate passes", ...);
it("maps a Google Ads REST error to an allowlisted, redacted details projection", ...);
it("paginates googleAds:search to completion without buffering past the artifact policy", ...);
it("preserves request ID while redacting developer, private-key and access-token variants", ...);
it("covers every Google Ads workflow marked replace, including retained Keyword Planner reads", ...);
```

**2026-07-14 Google Ads sub-slice implementation result:**

- 提交 `v24` Discovery snapshot(revision `20260624`,SHA-256 `202028d3abcb9e4681d35f3c28d06e6ced1eaac2ec57c56357c8ab5d522841d7`)与 checksum-bound reviewed policy。生成 176-method inventory,其中 5 个 upstream methods 映射为 6 个 executable capabilities:accessible customers、field search/describe、GAQL、Keyword Ideas、Historical Metrics。
- 新 provider 使用真实 profile 所需的 service-account OAuth;dry-run 在 secret resolution、OAuth、adapter load 与 artifact reservation 前停止。live 时派生 access token 立即进入 `SecretRegistry`;developer/access/private-key variants 同时进入 streaming artifact scanner。
- `googleAds:search`、field search 与 Keyword Ideas 都使用显式 `pageToken` loop,最多 1,000 页 fail-closed。artifact 以 JSON array 流式组合每个 exact raw REST page,不把全量 rows 缓存在内存。
- `openclaw-web.json` 只保存 customer scope 和两个 `env:` refs,mode `0600`;不接受 `loginCustomerId`,argv 也没有 manager flag。MCC gate 前 manager routing 保持不可表达。
- 真实 dogfood 6/6 success:accessible customers `1/1 page/row`,field describe `1/1`,field search `2/2`,GAQL `1/12`,Keyword Ideas `1/12`,Historical Metrics `1/1`。负例 GAQL 正确返回 HTTP 400 / `INVALID_ARGUMENT` / `queryError:UNRECOGNIZED_FIELD` + safe request ID。
- 7 个 artifacts 共 27,009 bytes,全部 mode `0600` 且可解析为 raw-page bundle;runtime access-token scan 与持久 developer-token/private-key scan 均为 0 findings。所有 envelope 均为 `read`,`cost:null`,`attemptId:null`;ledger 仍为 8 attempts / 0 unresolved / 0 breaches。
- Google Ads package tests:17 files / 115 tests / 424 expectations;workspace:10 package typechecks、61 files / 255 tests / 853 expectations;三个 generator `--check` 与 frozen install 均通过。证据见 [`packages/gkit/evals/slice4-google-ads-baseline.md`](../../packages/gkit/evals/slice4-google-ads-baseline.md)。
- 此处记录的是 Google Ads checkpoint;legacy Google Ads package 继续保留,因为 doctor 的 network/MCC 语义与 4 个 curated performance commands 仍为 `keep`。Bing 与 GSC 的后续结果见下方各自 checkpoint。

**Required tests(Bing):**

```ts
it("sends apikey as a query parameter but exposes only a key-free diagnosticUrl", ...);
it("redacts the encoded and decoded API key from every failure path", ...);
```

**2026-07-14 Bing sub-slice implementation result:**

- 提交 checksum-bound JSON contract、17-method inventory 与 17 个 read-only executable capabilities,完整映射旧 `bing-webmaster-cli` 的 sites、traffic、crawl、links、feeds 与 URL reads。
- request builder 同时产生含 `apikey` 的真实 request URL 与不含 key 的 `diagnosticUrl`;dry-run、成功 metadata、failure details 只允许后者。明文与 URL-encoded key 的成功/失败路径测试均通过。
- 一次性 invalid-key 实网负例到达 `GetUserSites`,返回 HTTP 400 + provider code `3`;dogfood 据此把该组合从普通 provider error 修正为 `AUTH_FAILED`,envelope 只包含 key-free diagnostic URL。
- `siteUrl` 可由 profile 默认或 request 显式覆盖;query/page/link/feed/url 参数继续按旧 contract 做 JSON-string encoding。origin 固定,不接受 transport override。
- 真实 `openclaw-web` profile 对 `https://openclawai.io/` 完成 17/17 gkit reads 与 17/17 same-input legacy calls。15 个 provider payload 完全一致;两个 query-list payload 行集合一致、仅 Bing 在分次请求中返回顺序不同。invalid-key 实网负例仍正确映射为 `AUTH_FAILED`。
- 17 个 gkit exact-response artifacts 共 26,855 bytes,全部 JSON、mode `0600`;与 legacy 合计 34 个 evidence files / 66,632 bytes,API-key scan 为 0。所有 gkit envelope 均为 `read`,`cost:null`,`attemptId:null`;ledger 保持 8 attempts / 0 unresolved / 0 breaches,且无 Bing entries。
- Bing 的 17 个旧 provider-data commands 全部改为 `replace`;network-aware doctor 仍为 `keep`,所以 legacy package 暂不删除。证据见 [`packages/gkit/evals/slice4-bing-baseline.md`](../../packages/gkit/evals/slice4-bing-baseline.md)。

**Required tests(GSC):**

```ts
it("derives only a webmasters.readonly service-account token", ...);
it("keeps Search Analytics POST classified as a read", ...);
it("encodes URL-prefix and sc-domain properties without accepting origin overrides", ...);
it("maps Google errors to an allowlisted projection", ...);
it("covers properties, analytics, sitemap list/get, and indexed URL inspection", ...);
```

**2026-07-14 GSC sub-slice implementation result:**

- 提交 checksum-bound 10-method reviewed contract:5 个 executable reads(properties list、Search Analytics、sitemap list/get、URL Inspection),5 个 write/destructive 或未使用 reads 保持 inventory-only。
- service-account OAuth scope 固定为 `webmasters.readonly`;profile 只保存可选 property scope 与 `serviceAccountFile` 的 `env:` ref。两个官方 origin 均固定,无 base URL override。
- `openclaw-web` 真实 dogfood 5/5 success:properties 2 rows、Search Analytics 25 rows、sitemap list/get 各 1 row、URL Inspection 1 row。相同输入的 legacy CLI comparison 得到相同 row/object outcomes。
- inaccessible property 负例返回 HTTP 403 / `AUTH_FAILED` / confirmed outcome 与 474-byte raw error artifact;provider-controlled message 未进入 envelope。
- 6 个 artifacts 共 6,776 bytes,全部 JSON、mode `0600`;runtime 扫描 access token/private key,持久 pattern scan 为 0。所有 envelope 均为 `read`,`cost:null`,`attemptId:null`;ledger 保持 8 attempts / 0 unresolved / 0 breaches。
- GSC provider-data commands 均为 `replace`;legacy network-aware doctor 为 `keep`,skill path/print/install 为 `drop`,因此本 slice 不删除旧 package。证据见 [`packages/gkit/evals/slice4-gsc-baseline.md`](../../packages/gkit/evals/slice4-gsc-baseline.md)。
- Bing 与 GSC 的重复仅提炼为 `execute-read-provider.ts` 的 profile/dry-run/artifact/envelope orchestration;request planning、auth、response validation 与 error allowlist 仍由各 provider 拥有,没有创建统一 transport 或 `src/core/provider.ts`。

**Slice 4 current verdict:** Google Ads single-account、GSC 与 Bing provider-data sub-slices 全部 PASS,可以进入 Slice 5 的全量 eval 与 curated 晋升。三个 legacy packages 中尚为 `keep` 的 doctor/manager/curated behavior 继续保留,不因 provider-data gate 通过而提前删除。

### Slice 5: 全量 eval + curated 晋升 + 清理

- 扩充 `evals/tasks.jsonl` 到 40 个(10 明确 provider / 15 业务目标 / 10 长尾 native / 5 negative),继续保留 observable behavior 与旧 workflow disposition key。
- 目标:provider top-1 ≥ 95%;两步内完成发现;首条可执行命令 ≥ 90%;negative precision ≥ 95%;所有 `replace` workflow 的 provider request/effect/output/error/exit/artifact golden 通过。
- Promotion rule:同一 native workflow 真实出现 ≥ 3 次且 curated contract 能显著降低失败/context/调用次数,才进入该 provider 的 `curated/`。
- **显式决策 `page-extract-cli` 与 `sitemap-watch-cli` 的归宿**(它们不属于任何 provider):独立保留、废弃、或以本地工具形态并入——三选一,写入本文档的修订版,不允许被清理动作静默删除。
- 输出最终 migration matrix:每个旧 command 都有 `replace | keep | drop`、证据与目标 capability;不存在仅凭 package 名称完成的退役。
- 收尾:若全部旧包退役完成,可选择把 `packages/gkit` 提升为仓库根(纯外观,不改变行为);重写 README 与 CI。

```bash
rg -n "@deniffer/.*-cli|product-growth-tools|PRODUCT_GROWTH_PROFILE" . --glob '!docs/plans/**'
bun test && bun run check-types
git commit -m "feat: evaluated curated commands and final cleanup"
```

上述 `rg` 只允许命中 migration matrix 中已显式决定保留的包。

**2026-07-14 Slice 5 implementation result:**

- `tasks.jsonl` 已扩充为 40 个任务:10 explicit provider、15 business goal、10 long-tail native、5 negative。`bun run --filter gkit eval:slice5` 强制检查分布、observation 完整性、manifest/provider/effect 一致性、首条 API command 可解析性与四项阈值。
- 本轮 implementation-agent contract dogfood 得到 provider top-1 35/35、两步内发现 35/35、首条可执行命令 33/33、negative precision 5/5;两个 DataForSEO LLM Mention task 因 cost floor 高于 profile cap 保持 inventory-only,不进入 executable denominator。该 baseline 是当前实现 agent 的逐条 contract review,不是 40 次 blinded cross-model run;未来模型比较应追加独立 observation set,不能覆盖本结果。
- Slice 5 不重复发起付费或真实 provider 请求;所有 `replace` command 的 request/effect/output/error/exit/artifact golden 继续由 Slice 1–4 same-input live baseline 与 provider tests 提供。最终索引为 33 `replace`、33 `keep`、4 `drop`;没有任何 provider legacy package 满足整包删除条件。
- curated promotion 为 0:eval 中构造的重复 prompt 不计为独立真实需求;现有 PostHog、Bing、GSC 与 DataForSEO 候选也没有同时满足“同一 typed workflow 真实出现三次”和“显著减少失败/context/调用次数”。
- `page-extract-cli` 与 `sitemap-watch-cli` 均选择**独立保留**。前者拥有 ctx 多调用后的稳定 SEO/GEO normalization contract;后者拥有本地 registry、递归 sitemap、dedupe 与确定性分类语义。两者都不是 provider adapter,不并入 gkit。
- `packages/gkit` 不提升到仓库根:七个 provider legacy packages 仍各自有 `keep` command,此时改变 workspace layout 只有外观收益。根 README 已改为 gkit-first,发布 workflow 明确跳过 private gkit,旧 package repository metadata 已指向改名后的 gkit repo。
- 证据见 [`packages/gkit/evals/slice5-baseline.md`](../../packages/gkit/evals/slice5-baseline.md) 与 [`packages/gkit/evals/slice5-final-migration-matrix.md`](../../packages/gkit/evals/slice5-final-migration-matrix.md)。

**2026-07-14 sole-consumer hard-cut override:**

- 唯一 CLI 消费者随后明确要求删除全部旧工具。该决定将此前 33 个 `keep` command 全部转为显式 `drop`;原有 33 个 behaviorally verified `replace` 保持指向 gkit,原有 4 个 `drop` 不变。
- 已删除七个 provider legacy packages、`page-extract-cli`、`sitemap-watch-cli`、共享 legacy profile runtime、runtime sync script、旧 live-validation 文档与 npm publish workflow。最终旧命令归宿为 **33 replace / 41 drop**。
- 仓库现在只保留 `packages/gkit`;根 workspace scripts、CI、README 与 lockfile 以单 package 为准。不提供 alias、deprecation binary 或 legacy fallback。
- Slice 2–4 migration matrices 保留为历史 behavior evidence,但状态为 `superseded`;当前结论只以 [`slice5-final-migration-matrix.md`](../../packages/gkit/evals/slice5-final-migration-matrix.md) 为准。

## 7. 扩张门槛(触发条件成立前不做)

| 延后项                              | 触发条件                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| 内建 `gkit search`                  | eval 中 rg+describe 两步发现成功率 < 90%                                                          |
| Python/polyglot/isolated runtime    | Slice 1.5 证明 REST 不能可靠覆盖必需能力、开放 Google Ads mutate,或引入不可信 provider/dependency |
| npm 发布                            | gkit 需要分发到本 workspace 之外                                                                  |
| sandboxed `gkit exec` / code runner | 出现真实 shell-less host                                                                          |
| write/destructive capability        | 逐 provider 有真实用例,随附 dry-run、idempotency/unknown-outcome 与 audit contract                |
| 统一 async job subsystem            | 多 provider async task 需要统一监控的真实场景                                                     |
| external plugin protocol            | 第三方需要独立发布 provider;必须同时定义隔离与 credential boundary                                |

## 8. Review gates

请判断六个根决策:

1. v1 暂定 Bun/TypeScript 单进程;Google Ads REST 必须先通过真实账号 spike,失败就修改 runtime 决策,而不是保护既定结论。
2. reviewed executable manifest 是 runtime/validation/effect-cost gate/describe/docs 的单一事实源;inventory 不可执行;内建 search 继续由 eval 触发。
3. 纵切生长:第二个 provider 也先直接实现;只有真实 diff 证明重复稳定时才提炼,不以数量机械触发 `ProviderModule`。
4. 逐包退役替代原子 cutover;每个旧 command 必须有 `replace | keep | drop` 与行为证据,包括 Keyword Planner、`page-extract`、`sitemap-watch`。
5. Profile/effect/envelope/atomic artifact/无全局 run/spend outcome 六条不变量从第一天锁死(见 §2),shell exit 与 secret-safe details 属于 public contract。
6. 不发 npm;spend 从 Slice 1 就有双 cap、无自动 retry、authorized/settled ledger 与 unknown reconciliation。

## References

- [对案:provider-native-agent-surface](./2026-07-13-gkit-provider-native-agent-surface.md)
- [Google Ads REST interface overview](https://developers.google.com/google-ads/api/rest/overview)
- [Google Ads Search & SearchStream over REST](https://developers.google.com/google-ads/api/rest/common/search)
- [Google Ads REST authentication](https://developers.google.com/google-ads/api/rest/auth)
- [Google Ads: Generate keyword ideas](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas)
- [DataForSEO OpenAPI](https://github.com/dataforseo/OpenApiDocumentation)
- [DataForSEO API sandbox](https://docs.dataforseo.com/v3/appendix/sandbox/)
- [argc v7.5.0 release](https://github.com/ethan-huo/argc/releases/tag/v7.5.0)
- [Bing Webmaster API protocols](https://learn.microsoft.com/en-us/bingwebmaster/api-protocols)
- [Bing Webmaster API access methods](https://learn.microsoft.com/en-us/bingwebmaster/getting-access)
- [GSC Discovery document](https://searchconsole.googleapis.com/$discovery/rest?version=v1)
- [PostHog Query API](https://posthog.com/docs/api/queries)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Cloudflare: Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/)
