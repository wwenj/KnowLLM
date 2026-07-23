# llmWikiNext 查询 Tools 使用文档

本文档说明 `LlmWikiNextToolsService` 当前已经实现的查询能力、HTTP 调用方式、返回结构、搜索规则和 Agent 推荐调用流程。

## 1. 设计目标

llmWikiNext 查询 Tools 用于让 Agent 或人工测试程序以只读方式消费已经正式发布的 Wiki。

核心边界：

- 只读取 `published/current.json` 指向的最新 Published Revision。
- 只读取该 Published Revision 引用的原文 Source。
- 不读取 Staging、CompilePool、Source Overlay 或编译报告。
- 不提供上传、编译、发布、删除或修改能力。
- 不提供向量检索、Embedding、通用 RAG 或模糊搜索。
- Tool 不接受 `revisionId`。每次调用都会读取当时最新的正式版本。

一次 Tool 调用只会读取一个完整 Published Snapshot，不会混入 Staging 数据。但多个 Tool 调用之间没有版本锁定；如果期间发生了新发布，下一次调用会直接读取新版本。

## 2. Service 与 HTTP 接口

Service 类：

```ts
export class LlmWikiNextToolsService {
  // 只读查询方法见下方接口定义。
}
```

Service 方法：

```ts
getCatalog(): ToolsCatalog;
readPage(pageKey: string): ToolsPageDetail;
readSource(
  sourceId: string,
  startLine?: number,
  endLine?: number,
): ToolsSourceDetail;
searchWiki(query: string): ToolsSearchResult;
```

对应 HTTP 接口：

| Tool         | Method | URL                                          |
| ------------ | ------ | -------------------------------------------- |
| `getCatalog` | GET    | `/api/llm-wiki-next/tools/catalog`           |
| `readPage`   | GET    | `/api/llm-wiki-next/tools/pages/:pageKey`    |
| `readSource` | GET    | `/api/llm-wiki-next/tools/sources/:sourceId` |
| `searchWiki` | GET    | `/api/llm-wiki-next/tools/search?q=关键词`   |

服务默认监听地址为 `http://localhost:39247`。

### 2.1 HTTP 响应信封

Controller 返回的数据会被全局响应拦截器包装。

成功响应：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

失败响应示例：

```json
{
  "code": 404,
  "msg": "Wiki 页面不存在",
  "data": {
    "error": "WIKI_PAGE_NOT_FOUND"
  }
}
```

全局异常过滤器会统一返回 HTTP 200，因此调用方不能只判断 HTTP 状态码，必须同时检查响应体中的 `code`。`code === 0` 才代表调用成功。

直接注入并调用 `LlmWikiNextToolsService` 时不会经过 HTTP 信封包装，得到的是方法原始返回值，参数错误会直接抛出 Nest `HttpException`。

## 3. 公共数据结构

### 3.1 页面摘要 `ToolsPageSummary`

```ts
interface ToolsPageSummary {
  pageKey: string;
  title: string;
  goal: string;
  sourceIds: string[];
  factCount: number;
}
```

- `pageKey`：8 位页面唯一标识，是 `readPage` 的查询参数。
- `title`：页面标题。
- `goal`：页面的简洁内容和用途说明。
- `sourceIds`：生成或更新该页面的正式原文 ID。
- `factCount`：页面当前包含的 Fact 数量。

页面摘要不包含正文和 Fact 内容，需要使用 `readPage` 继续读取。

### 3.2 原文摘要 `ToolsSourceSummary`

```ts
interface ToolsSourceSummary {
  sourceId: string;
  filename: string;
  contentHash: string;
  charCount: number;
  lineCount: number;
  pageKeys: string[];
}
```

- `sourceId`：16 位原文唯一标识，是 `readSource` 的查询参数。
- `filename`：原始文件名。
- `contentHash`：原文内容 SHA-256。
- `charCount`、`lineCount`：原文字符数和行数。
- `pageKeys`：该原文在当前正式 Wiki 中对应的全部页面。

查询 Tools 不返回 Source 的编译状态、任务状态和编译报告。

## 4. getCatalog：获取完整目录

### 4.1 用途

一次性获取当前正式 Wiki 的全部页面目录、页面显式关联、Fact 统计和原文到页面的映射。适合 Agent 在开始查询时完成全局规划。

当前正式产物没有 `parentKey`、目录路径、页面类型或面包屑字段，因此 Catalog 表达的是：

- 全量页面目录；
- 页面之间的有向关联；
- Source 与 Page 的溯源关系；
- 页面正文内部的 Markdown 标题层级不在 Catalog 中，需要通过 `readPage` 获取。

Catalog 不构造不存在的父子目录树。

### 4.2 参数

无参数。

### 4.3 调用示例

```bash
curl http://localhost:39247/api/llm-wiki-next/tools/catalog
```

Service 调用：

```ts
const catalog = toolsService.getCatalog();
```

### 4.4 返回结构

```ts
interface ToolsCatalog {
  stats: {
    pageCount: number;
    factCount: number;
    sourceCount: number;
  };
  pages: Array<
    ToolsPageSummary & {
      relatedPageKeys: string[];
    }
  >;
  sources: ToolsSourceSummary[];
}
```

`relatedPageKeys` 是页面主动声明的有向关联。它不保证双向：页面 A 关联页面 B，不代表页面 B 一定关联页面 A。

`sources` 只包含当前 Published `source-map.sourceToPages` 中实际出现的 Source。磁盘中已上传但尚未发布的 Source 不会出现在 Catalog 中。

Catalog 返回全量数据，不分页，也不返回页面正文。调用方应缓存本次查询过程所需的 Catalog，避免无意义地重复调用。

## 5. readPage：读取 Wiki 页面

### 5.1 用途

根据 Catalog 或搜索结果中的 `pageKey` 读取 Wiki 正文、Facts、原文摘要和关联页面。

### 5.2 参数

```ts
{
  pageKey: string; // 必须是 8 位字母或数字
}
```

HTTP 调用：

```bash
curl http://localhost:39247/api/llm-wiki-next/tools/pages/9C11vVPN
```

Service 调用：

```ts
const detail = toolsService.readPage("9C11vVPN");
```

### 5.3 返回结构

```ts
interface ToolsPageDetail {
  page: {
    pageKey: string;
    title: string;
    goal: string;
    sourceIds: string[];
    factCount: number;
    relatedPageKeys: string[];
    bodyMarkdown: string;
    keyFacts: Array<{
      fact: string;
      sourceId: string;
      sourceLine: number | null;
    }>;
  };
  relations: {
    outgoing: ToolsPageSummary[];
    incoming: ToolsPageSummary[];
    sameSource: ToolsPageSummary[];
  };
  sources: ToolsSourceSummary[];
}
```

### 5.4 relations 语义

`relations` 分成三个独立维度：

| 字段         | 含义                               | 数据来源                             |
| ------------ | ---------------------------------- | ------------------------------------ |
| `outgoing`   | 当前页面主动关联的页面             | 当前页面的 `relatedPageKeys`         |
| `incoming`   | 主动关联当前页面的其他页面         | 反向扫描全部页面的 `relatedPageKeys` |
| `sameSource` | 与当前页面引用同一份原文的其他页面 | `source-map.sourceToPages`           |

行为约束：

- 当前页面自身会被排除。
- 每个关系数组内部会去重。
- 已不存在的关联页面不会返回。
- 三类关系可能重叠。例如一个页面既可能是 `outgoing`，也可能与当前页面属于 `sameSource`。
- 关系项只返回 `ToolsPageSummary`，不返回关联页面正文。需要继续扩展时，使用关系项的 `pageKey` 再调用 `readPage`。

### 5.5 Facts 与原文定位

`keyFacts` 中的 `sourceId` 和 `sourceLine` 用于追溯原文：

```ts
{
  fact: "要启用 API 服务器，klippy.py 运行时应加上 -a 参数。",
  sourceId: "17XJfkXBLmuS29xD",
  sourceLine: 12,
}
```

Agent 可以围绕 `sourceLine` 调用 `readSource`，例如读取第 8 至 18 行验证上下文。`sourceLine` 类型允许为 `null`；为 `null` 时代表当前 Fact 没有可靠行号，仍可以根据 `sourceId` 读取原文或查看同源页面。

## 6. readSource：读取正式原文

### 6.1 用途

读取当前正式 Wiki 已引用的原文，并反查该原文对应的全部 Wiki 页面和指定行区间内的 Facts。

即使某个 Source 文件存在于磁盘，只要它没有出现在当前 Published Source Map 中，`readSource` 也会拒绝访问。

### 6.2 参数

```ts
{
  sourceId: string;  // 必须是 16 位字母或数字
  startLine?: number;
  endLine?: number;
}
```

行号从 `1` 开始，`startLine` 和 `endLine` 都是闭区间。

| 参数组合         | 返回范围                           |
| ---------------- | ---------------------------------- |
| 都不传           | 返回完整原文                       |
| 只传 `startLine` | 从 `startLine` 返回到原文末尾      |
| 只传 `endLine`   | 从第 1 行返回到 `endLine`          |
| 两者都传         | 返回 `[startLine, endLine]` 闭区间 |

不会自动截断行数。省略两个可选参数时可能返回较大的完整原文，Agent 查询通常应优先根据 Fact 行号读取必要区间。

### 6.3 调用示例

读取完整原文：

```bash
curl http://localhost:39247/api/llm-wiki-next/tools/sources/17XJfkXBLmuS29xD
```

读取第 20 至 80 行：

```bash
curl --get \
  --data-urlencode "startLine=20" \
  --data-urlencode "endLine=80" \
  http://localhost:39247/api/llm-wiki-next/tools/sources/17XJfkXBLmuS29xD
```

只读取第 100 行至末尾：

```bash
curl --get \
  --data-urlencode "startLine=100" \
  http://localhost:39247/api/llm-wiki-next/tools/sources/17XJfkXBLmuS29xD
```

Service 调用：

```ts
const full = toolsService.readSource("17XJfkXBLmuS29xD");
const range = toolsService.readSource("17XJfkXBLmuS29xD", 20, 80);
```

### 6.4 返回结构

```ts
interface ToolsSourceDetail {
  source: ToolsSourceSummary;
  range: {
    startLine: number;
    endLine: number;
    totalLines: number;
    hasMore: boolean;
    nextStartLine: number | null;
  };
  content: string;
  pages: ToolsPageSummary[];
  factRefs: Array<{
    pageKey: string;
    fact: string;
    sourceLine: number;
  }>;
}
```

- `content`：所选行区间的原文，不额外添加行号前缀。
- `pages`：该 Source 在当前正式 Wiki 中关联的全部页面，不受行区间限制。
- `factRefs`：只返回属于当前 Source、具有有效 `sourceLine` 且行号位于本次区间内的 Facts。
- `hasMore`：`endLine` 后面是否还有原文。
- `nextStartLine`：如果 `hasMore` 为 `true`，表示下一段可以从哪一行开始；否则为 `null`。

`hasMore` 只表示当前区间之后是否还有内容，不表示 `startLine` 之前是否还有内容。

### 6.5 参数校验

- `startLine`、`endLine` 必须是正整数。
- `startLine`、`endLine` 不能超过原文总行数。
- 同时传入时，`startLine` 不能大于 `endLine`。

## 7. searchWiki：关键词匹配

### 7.1 用途

当 Agent 无法仅凭 Catalog 确定候选页面时，通过关键词在正式 Wiki 搜索索引中补充召回页面。

搜索只使用 Published `search-index.json`，不会搜索原文 Source、Source 文件名、`pageKey` 或 `sourceId`。

### 7.2 参数

```ts
{
  query: string; // 去除首尾空格后不能为空
}
```

HTTP 调用：

```bash
curl --get \
  --data-urlencode "q=传感器调试" \
  http://localhost:39247/api/llm-wiki-next/tools/search
```

Service 调用：

```ts
const result = toolsService.searchWiki("传感器调试");
```

调用方不能传 `limit`，服务固定最多返回 20 条。

### 7.3 查询规范化

1. 去除 `query` 首尾空格。
2. 使用 `toLocaleLowerCase()` 转为小写。
3. 按空白字符拆分 token。
4. 使用字符串 `includes` 匹配，不进行中文分词、词干处理或拼写纠错。

例如：

- `传感器调试` 没有空格，只产生一个 token：`传感器调试`。
- `传感器 调试` 产生两个 token：`传感器`、`调试`。

多个 token 采用宽松的 OR 式召回：任意 token 命中任意被检索字段，就可能得到正分。当前不要求所有 token 同时出现。

### 7.4 检索字段

| 字段           | 内容                       |
| -------------- | -------------------------- |
| `title`        | Wiki 页面标题              |
| `goal`         | 页面简洁内容和目标         |
| `facts`        | 页面全部 Fact 文本拼接结果 |
| `bodyMarkdown` | Wiki 页面正文              |

### 7.5 评分规则

```text
完整 query 命中 title：+20
否则，完整 query 命中 goal：+12

对每个 token 分别累计：
命中 title：+8
命中 goal：+5
命中 facts：+3
命中 bodyMarkdown：+1
```

注意：完整 query 的标题分和 goal 分是 `if/else` 关系。如果完整 query 同时出现在标题和 goal 中，只增加标题的 `20` 分，不会同时增加 `12` 分。每个 token 的字段得分则可以同时累计。

完成评分后：

1. 过滤 `score <= 0` 的页面。
2. 按 `score` 降序排列。
3. 同分时按标题排序。
4. 取前 20 条。

### 7.6 返回结构

```ts
interface ToolsSearchResult {
  query: string;
  items: Array<
    ToolsPageSummary & {
      score: number;
      matchedFields: Array<"title" | "goal" | "fact" | "body">;
      matchedFacts: string[];
      snippet: string;
    }
  >;
}
```

- `matchedFields`：完整 query 或任意 token 命中的字段集合。
- `matchedFacts`：匹配完整 query 或任意 token 的 Fact，最多 3 条。
- `snippet`：结果摘要，最长 240 字符。

snippet 选择顺序：

1. 第一条 `matchedFacts`；
2. 命中的 `goal`；
3. `bodyMarkdown` 中首次匹配位置附近的文本。

搜索结果不返回完整 Wiki 正文。确认候选页面后，必须使用 `readPage(pageKey)` 获取正文和完整 Facts。

### 7.7 评分示例

查询：

```text
传感器调试
```

某页面的 `goal` 和正文都包含完整的“传感器调试”，标题和 Facts 不包含。由于查询中没有空格，它只有一个 token，得分为：

```text
完整 query 命中 goal：12
token 命中 goal：5
token 命中 bodyMarkdown：1
总分：18
```

此时：

```json
{
  "score": 18,
  "matchedFields": ["goal", "body"],
  "matchedFacts": []
}
```

由于没有匹配 Fact，而 goal 命中，`snippet` 会直接使用 goal。

## 8. Agent 推荐调用流程

### 8.1 标准流程

```text
getCatalog
  ↓
根据 title / goal / relatedPageKeys / Source 映射制定查询计划
  ↓
无法直接确定页面时调用 searchWiki
  ↓
使用 pageKey 调用 readPage
  ↓
沿 outgoing / incoming / sameSource 逐层扩展必要页面
  ↓
根据 keyFacts.sourceId + sourceLine 调用 readSource 核验原文
  ↓
基于 Wiki 正文、Facts 和必要原文生成答案
```

### 8.2 调用原则

- 查询开始时调用一次 `getCatalog`，不要把 `searchWiki` 当作唯一入口。
- 优先使用目录和页面关系做规划，搜索用于辅助召回。
- `readPage` 后只扩展与问题有关的关系页面，避免遍历整个关系图。
- 需要原始证据时，优先围绕 `sourceLine` 读取较小区间。
- 只有确实需要完整上下文时，才不传行号读取完整 Source。
- 在 Agent 状态中保留 `pageKey`、`sourceId`、`sourceLine`，方便追踪证据来源。
- 不要把 `sameSource` 当成显式语义关系；它只代表页面来源相同。
- 不要把搜索分数当作答案可信度。分数只表示字符串匹配强弱。

### 8.3 简化伪代码

```ts
const catalog = tools.getCatalog();

const candidates = selectFromCatalog(catalog, question);
const searched = candidates.length ? [] : tools.searchWiki(question).items;
const pageKeys = unique([
  ...candidates,
  ...searched.map((item) => item.pageKey),
]);

for (const pageKey of pageKeys) {
  const detail = tools.readPage(pageKey);

  for (const fact of detail.page.keyFacts) {
    if (fact.sourceLine !== null) {
      const startLine = Math.max(1, fact.sourceLine - 5);
      const endLine = Math.min(
        detail.sources.find((source) => source.sourceId === fact.sourceId)
          ?.lineCount ?? fact.sourceLine + 5,
        fact.sourceLine + 5,
      );
      const evidence = tools.readSource(fact.sourceId, startLine, endLine);
      collectEvidence(pageKey, fact, evidence);
    }
  }
}
```

## 9. 错误码

| error                          | 场景                                            |
| ------------------------------ | ----------------------------------------------- |
| `PUBLISHED_WIKI_NOT_FOUND`     | 当前没有正式 Wiki                               |
| `PUBLISHED_WIKI_UNAVAILABLE`   | 正式 Wiki 指针存在，但正式产物无法完整读取      |
| `INVALID_PAGE_KEY`             | `pageKey` 不是 8 位字母或数字                   |
| `WIKI_PAGE_NOT_FOUND`          | 当前正式 Wiki 中不存在该页面                    |
| `INVALID_SOURCE_ID`            | `sourceId` 不是 16 位字母或数字                 |
| `PUBLISHED_SOURCE_NOT_FOUND`   | Source 存在或不存在，但没有被当前正式 Wiki 引用 |
| `PUBLISHED_SOURCE_UNAVAILABLE` | 正式 Wiki 引用的原文或元数据不可用              |
| `INVALID_START_LINE`           | `startLine` 不是正整数或超出原文行数            |
| `INVALID_END_LINE`             | `endLine` 不是正整数或超出原文行数              |
| `INVALID_LINE_RANGE`           | `startLine` 大于 `endLine`                      |
| `EMPTY_QUERY`                  | 搜索关键词去除空格后为空                        |

所有存储读取异常都会转换为稳定业务错误，不向调用方返回服务器磁盘路径。

## 10. 前端人工测试入口

前端路径：

```text
LLM Wiki Next → 查询工具
```

页面提供四个 Tab：

```text
getCatalog | readPage | readSource | searchWiki
```

- 切换 Tab 只渲染当前 Tool 的参数表单。
- Tool 不会自动执行，必须点击“执行”。
- `readSource` 的 `startLine`、`endLine` 都可以留空。
- 右侧显示本次请求参数和格式化后的响应 `data`。
- HTTP 错误不会弹出全局 Toast，而是在结果区域直接展示。

## 11. 验证命令

后端定向测试：

```bash
pnpm --filter @knowllm/api exec node --test -r ts-node/register \
  src/modules/llmWikiNext/llm-wiki-next-tools.service.spec.ts
```

后端类型检查：

```bash
pnpm --filter @knowllm/api check
```

前端类型检查：

```bash
pnpm --filter @knowllm/web check
```

当前定向测试覆盖：

- Catalog 排除未发布 Source 和 Staging 页面；
- 页面 outgoing、incoming、sameSource 关系；
- 原文完整读取、单边行号和闭区间读取；
- Source 到页面、区间到 Fact 的反查；
- title、goal、fact、body 搜索；
- 最新 Published 自动切换；
- 非法 ID、非法行号、空查询和空 Published 错误。
