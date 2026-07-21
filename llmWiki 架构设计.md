# llmWiki 架构设计

> 本文是 llmWiki 新架构的持续设计稿，只保留已经确认的核心设计；未确定内容放在对应章节的 TODO 中，后续继续补充。

llmWiki 是编译型语义 Wiki：原始文档是事实来源，模型将原文整理成稳定、可读、适合 Agent 使用的 Wiki 页面。

```text
Source
  -> 可选切片
  -> Wiki Page Plan
  -> 页面生成与合并
  -> 验收并发布
  -> Agent
```

核心原则：准确度优先；模型调用和 Token 可以高，但必须在执行前可估算并有硬上限，禁止隐式增加调用。

## 1. 切片

切片只用于解决原文超过模型有效上下文的问题，不代表 Wiki 页面结构。完整原文能够被模型稳定处理时，默认不切片。

### 1.1 三种方式

#### 不切片（推荐）

推荐用户按照自然主题人工管理 Source。完整请求在模型有效上下文内时，直接把整篇原文交给后续 Planner 和 Writer。

#### 快速切片

快速切片完全由程序执行，不调用模型：

1. 按 Markdown 标题、段落、列表、代码块和表格形成不可随意拆开的基础单元。
2. 按原文顺序装入切片，以目标字符数控制大小，以实际 Token 估算执行最终硬校验。
3. 在不超过有效 Token 上限的前提下，每片尽量多放内容，使切片数量最少。
4. 单个基础单元本身超限时，才允许在内部兜底切分，并记录连续关系。

它只保证顺序不变、内容不丢、主要 Markdown 结构不被破坏，不保证每片语义独立。

#### 超长上下文模型语义切片

当存在价格和稳定性可接受、能够完整读取原文的超长上下文模型时，把完整原文一次交给模型，让模型只标记语义边界。

程序先给 Markdown 基础单元增加 `U0001`、`U0002` 等机械编号；这不是语义分析，也不增加模型调用。

```ts
type SemanticSlicePlan = {
  segments: Array<{
    startUnitId: string; // 语义片段起始原文单元
    endUnitId: string; // 语义片段结束原文单元
    topic: string; // 该片段的主要主题
  }>;
};
```

语义切片提示词：

```text
System:

你是 llmWiki 的原文语义切片器。

你会收到一篇完整原文，原文中的标题、段落、列表、代码块和表格已经按顺序编号。

你的任务只是在原文单元之间标记语义边界。

规则：
1. 所有原文单元必须按原顺序完整覆盖，不能遗漏或重复。
2. 只有用户任务、主题对象或独立知识目标明显变化时才切分。
3. 同一操作的条件、步骤、结果和警告不能拆开。
4. 代码或表格与其解释不能拆开。
5. 在保证语义完整的前提下尽量减少片段数量。
6. 不改写、不摘要、不删除原文，不生成 Wiki 页面。
7. 只返回符合 SemanticSlicePlan 的 JSON。

User:

完整原文：

<source>
{{numberedSource}}
</source>

请返回：

{
  "segments": [
    {
      "startUnitId": "U0001",
      "endUnitId": "U0017",
      "topic": "片段主题"
    }
  ]
}
```

### 1.2 切片产物

```ts
type SourceSegment = {
  segmentId: string; // 切片稳定标识
  sourceId: string; // 原始 Source 标识
  content: string; // 未改写的原文内容
  startOffset: number; // 在原文中的起始位置
  endOffset: number; // 在原文中的结束位置
  contentHash: string; // 用于缓存和完整性校验
  mode: "none" | "fast" | "semantic"; // 本次采用的切片方式
};
```

### 1.3 TODO

- 如何确定不同模型在 llmWiki 编译任务中的有效上下文上限。
- 快速切片的目标字符数与 Token 硬上限如何换算。
- PDF、扫描件、图片和复杂表格如何转换成可靠的基础单元。
- 文档后续内容持续依赖开头全局定义时，如何携带上下文；无法安全切分时应允许阻止编译。

## 2. Wiki Page Plan

当前先按完整原文不需要切片的情况设计。Planner 直接读取完整原文和当前已发布 Wiki 页面目录，只决定应该创建或更新哪些页面，不生成正文，也不增加 Contribution、Fact 等中间层。

```text
完整原文 + 已发布页面目录
  -> Page Planner（1 次模型调用）
  -> WikiPagePlan
```

### 2.1 数据结构

已有页面目录来自正式 Wiki 元数据；第一次编译时为空数组。

```ts
type ExistingPage = {
  pageKey: string; // 已有页面的稳定语义标识
  title: string; // 已有页面标题
  goal: string; // 已有页面负责的内容范围
};

type WikiPagePlan = {
  pages: Array<{
    pageKey: string; // 页面稳定语义标识
    operation: "create" | "update"; // 新建页面或更新已有页面
    title: string; // 页面标题
    goal: string; // 页面应承载的原文内容和解决的问题
    relatedPageKeys: string[]; // 相关但不应合并的其他页面
  }>;
};
```

当前不设置 `pageType`。页面用途和写作要求统一由 `goal` 表达；只有以后真正实现不同 Writer 模板时才重新评估。

### 2.2 Planner 提示词

```text
System:

你是 llmWiki 的 Wiki 页面规划器。

你会收到一篇完整原文和当前已经存在的 Wiki 页面目录。你的任务是规划本次应该创建或更新哪些 Wiki 页面。

规则：
1. 完整阅读原文，原文中的有效知识都必须有页面负责承载。
2. 按用户阅读目的组织页面，不要机械照搬原文标题结构。
3. 紧密相关、适合连续阅读的内容应合并到同一页面。
4. 用户目的不同的内容应拆成不同页面，例如操作流程和故障排查。
5. 已有页面与当前内容目标一致时，优先更新已有页面。
6. 没有合适的已有页面时，才创建新页面。
7. 不要创建内容重复、范围过小或范围过大的页面。
8. 每个 pageKey 只能出现一次；同一页面的内容必须合并到一个 Plan。
9. 新页面的标题或 goal 与已有页面、本次其他新页面相同或高度相似时，必须合并。
10. 只规划页面，不生成 Wiki 正文。
11. 只返回指定结构的 JSON，不要输出解释。

User:

当前 Wiki 页面目录：

{{existingPagesJson}}

完整原文：

<source>
{{source}}
</source>

最大页面数：{{maxPages}}

请只返回：

{
  "pages": [
    {
      "pageKey": "页面稳定语义标识",
      "operation": "create 或 update",
      "title": "页面标题",
      "goal": "页面应承载的原文内容和解决的问题",
      "relatedPageKeys": ["相关但不应合并的页面"]
    }
  ]
}
```

### 2.3 Plan 校验

模型返回后，服务端必须校验：

- 同一 Source 内 `pageKey` 唯一；重复目标必须合成一个 Plan。
- `update` 必须指向真实已有页面，`create` 不得与已有 `pageKey` 冲突。
- 新页面标题标准化后不得重复。
- 标题或 `goal` 与已有页面、本次其他新页面高度相似时，应合并而不是重复创建。
- `relatedPageKeys` 必须指向已有页面或本次计划中的页面。
- 页面总数不得超过执行前确认值。

精确重复由程序直接拒绝；疑似语义重复优先由 Planner 合并，仍无法确认时阻止执行，不能静默创建重复页面。

### 2.4 TODO

- 快速切片和语义切片的结果如何进入全局页面规划。
- 语义相似页面的判定和重新规划方式。

## 3. 执行并生成 Wiki

Planner 产出 `P` 个页面计划后，每个计划执行一次 Writer。创建页面时输入完整原文和当前 Plan；更新页面时还要输入目标 Wiki 的最新正文。

```text
create：完整原文 + 当前 Plan
  -> Writer
  -> 新页面完整 Markdown

update：完整原文 + 当前 Plan + 目标 Wiki 最新正文
  -> Writer
  -> 合并后的完整 Markdown
```

### 3.1 数据结构

```ts
type PageWriterInput = {
  source: string; // 当前完整原文
  pagePlan: WikiPagePlan["pages"][number]; // 当前页面计划
  existingPage?: string; // update 时传入目标 Wiki 的最新正文
};

type PageWriterOutput = {
  bodyMarkdown: string; // 完整 Wiki 页面正文
};
```

标题、路径、`pageKey` 和关联页面等元数据由程序根据 Plan 写入，Writer 只返回正文。

### 3.2 Writer 提示词

```text
System:

你是 llmWiki 的 Wiki 页面 Writer。

你会收到完整原文、当前页面 Plan，以及 update 时的已有 Wiki 页面正文。请生成该页面的完整 Markdown 正文。

规则：
1. 完整阅读原文，只选择与当前页面 goal 相关的内容。
2. 原文是新增知识的事实来源，不得编造原文和已有页面都不支持的内容。
3. create 时根据原文和 goal 生成完整页面。
4. update 时保留已有页面中仍然有效且与 goal 相关的内容，加入原文中的新内容并合并重复表达。
5. update 不是在旧页面末尾追加，必须重新整理成一份连贯完整的页面。
6. 命令、参数、数值、链接、条件和警告必须准确保留。
7. 不输出 frontmatter、pageKey、解释或 JSON，只输出 Markdown 正文。

User:

当前页面 Plan：

{{pagePlanJson}}

完整原文：

<source>
{{source}}
</source>

已有 Wiki 页面正文（create 时为空）：

<existing-page>
{{existingPage}}
</existing-page>

请输出该页面的完整 Markdown 正文。
```

### 3.3 并发与页面锁

同一 Source 的 Plan 中 `pageKey` 已保证不重复；不同 Source 可能同时更新同一个页面，因此锁必须在 Writer 开始前获取。

```text
Plan 校验
  -> 一次性申请本 Source 涉及的全部 pageKey 锁
  -> 获取成功后读取目标 Wiki 最新正文
  -> 本 Source 内不同页面的 Writer 可受控并行
  -> 验收、修复、原子发布
  -> 释放全部锁
```

规则：

- `create` 和 `update` 都需要锁。
- 不同页面可以并行，相同页面必须排队。
- 一个 Source 涉及多个页面时一次性申请整组锁，避免死锁和部分发布。
- 等待锁期间不调用 Writer 或 Judge，不消耗模型 Token。
- 获取锁后读取最新页面，不能使用规划时的旧正文。
- 锁覆盖 Writer、验收、修复和发布，任务成功、失败或取消后统一释放。
- 两个任务创建相同 `pageKey` 时，后执行者根据最新状态转为更新或重新规划。
- 锁记录任务所有者和心跳，支持异常退出后的过期回收。

### 3.4 调用与发布

当前基础调用数：

```text
1 次 Page Planner + P 次 Page Writer
```

每个 Writer 都读取完整原文，所以原文输入会重复 `P` 次；这是当前方案明确、可预估的成本，不做隐藏优化。

Writer 结果先写入 Candidate/Staging，全部页面完成并通过验收后再原子发布，失败不能覆盖现有 Wiki。

### 3.5 TODO

- Coverage Claims 如何从原文生成，以及如何验收、集中修复和最终复核。
- 当前原文与已有 Wiki 内容冲突时采用什么保留和版本策略。
- Writer、Judge 和修复的重试次数与 Token 硬上限。
