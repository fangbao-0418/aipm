生产环境不要指望“提示词保证 JSON 永远正确”，要做 **协议 + 校验 + 修复 + 重试 + 降级**。

推荐链路：

```txt
用户任务
  ↓
模型输出结构化数据
  ↓
提取 JSON
  ↓
JSON.parse
  ↓
Schema 校验
  ↓
业务校验
  ↓
执行 tools
  ↓
记录日志/失败可追踪
```

核心处理方式：

### 1. 优先用结构化输出，不让模型自由吐 JSON

如果模型/API支持，优先用：

```ts
response_format: {
  type: "json_schema",
  json_schema: {
    name: "agent_plan",
    strict: true,
    schema: AgentPlanSchema
  }
}
```

或者 function/tool calling，让模型填参数，不直接解析自然语言 JSON。

这是生产首选。

---

### 2. JSON 解析前做清洗，但不要过度修复

只做安全清洗：

````ts
function cleanModelJson(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}
````

不要自己乱补括号、补引号，容易把错误计划变成“看似合法但危险”的执行指令。

---

### 3. 用 Zod 做强 Schema 校验

```ts
import { z } from "zod";

const StepSchema = z.object({
  tool: z.enum([
    "page.get_schema",
    "schema.find_nodes",
    "schema.update_node",
    "schema.add_nodes"
  ]),
  args: z.record(z.any())
});

const AgentPlanSchema = z.object({
  mode: z.enum(["plan", "execute"]),
  plan: z.object({
    title: z.string(),
    userGoal: z.string().optional(),
    assumptions: z.array(z.string()).optional()
  }),
  steps: z.array(StepSchema).max(20)
});
```

解析：

```ts
const parsed = JSON.parse(cleanModelJson(output));
const result = AgentPlanSchema.safeParse(parsed);

if (!result.success) {
  throw new Error(result.error.message);
}
```

---

### 4. 失败后不要直接执行，走“修复重试”

生产建议最多重试 1～2 次：

```ts
async function parseWithRetry(output: string) {
  try {
    return validate(output);
  } catch (err) {
    const fixed = await callModel({
      prompt: `
下面 JSON 解析失败，请只修复为合法 JSON。
不要新增业务含义。
不要解释。
错误信息：${String(err)}
原始内容：
${output}
`
    });

    return validate(fixed);
  }
}
```

注意：修复模型只能修格式，不能改业务。

---

### 5. 执行前做业务白名单和权限校验

比如：

```ts
const allowedTools = new Set([
  "page.get_schema",
  "schema.find_nodes",
  "schema.update_node",
  "schema.add_nodes"
]);

for (const step of plan.steps) {
  if (!allowedTools.has(step.tool)) {
    throw new Error(`非法工具: ${step.tool}`);
  }
}
```

并且限制：

```txt
不能删除整页
不能操作未知 pageId
不能一次新增超过 N 个节点
不能修改锁定节点
不能越权访问项目
```

---

### 6. 所有 tool 执行要支持事务/回滚

特别是 UI schema 修改：

```txt
执行前保存 snapshot
  ↓
逐步执行
  ↓
任一步失败
  ↓
回滚到 snapshot
  ↓
返回失败原因
```

不要一边执行一边污染页面。

---

### 7. 最佳实践：不要让模型一次生成超大 schema

你这个问题很可能是输出太长导致截断。

生产更推荐：

```txt
模型只产出计划
  ↓
执行器根据计划调用专门工具生成具体 schema
```

比如不要让模型输出完整 100 个节点，而是：

```json
{
  "tool": "schema.create_menu",
  "args": {
    "pageId": "xxx",
    "containerId": "xxx",
    "theme": "dark",
    "items": ["首页", "订单管理", "用户管理", "系统设置"]
  }
}
```

然后由确定性代码生成具体节点。

这是更稳的。

---

最终推荐方案：

```txt
结构化输出 / tool calling
+ JSON Schema / Zod 校验
+ 白名单工具
+ 重试修复
+ 执行事务
+ 操作日志
+ 大 schema 由代码生成，不让模型硬吐
```

一句话：
**模型负责“决策”，代码负责“结构、校验、执行和兜底”。**

提示词
“当前页面左侧添加菜单栏组件”
agent做完任务就一次性回复信息
“
执行前计划：
UI 设计 Agent 判断：
我准备这样做：
目标：AI Design Agent 执行计划
执行计划如下：
1. page.get_schema：执行工具，输入字段：pageId
2. schema.find_nodes：执行工具，输入字段：pageId、query
3. schema.update_node：执行工具，输入字段：pageId、nodeId、patch
4. schema.validate：执行工具，输入字段：pageId
执行结果：
已完成工具执行：
1. 成功 page.get_schema：已获取页面「当前 表单内容丰富点页面」schema。
2. 成功 schema.find_nodes：已找到 1 个匹配节点。
3. 成功 schema.update_node：已修改节点「左侧菜单栏」。
4. 成功 schema.validate：页面「当前 表单内容丰富点页面」schema 校验通过。
反馈：计划内工具已执行完成。
”
这里不是预期完成的效果