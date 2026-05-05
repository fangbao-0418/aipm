Codex 智能不是因为“一个超复杂 prompt”，而是因为它是**Agent 工程系统**。

核心思路可以拆成 6 层：

## 1. 大模型负责推理和规划

Codex 背后用的是偏代码/工程任务优化的模型。它不是只回答，而是会把任务拆成：

```text
理解需求 → 查项目结构 → 找相关文件 → 制定修改方案 → 执行命令 → 看报错 → 再修复 → 运行验证 → 总结结果
```

这就是你说的“问一句，自己把链路做完”。

## 2. 工具层让模型能真的“动手”

Codex CLI 是本地运行的 coding agent，可以读写项目、执行命令、跑测试、看 git diff。OpenAI 官方说明里也强调 Codex CLI 是运行在本机的编码 Agent。([GitHub][1])

也就是模型不是凭空猜，它会不断调用工具：

```text
ls / find / grep
cat 文件
编辑文件
npm install
npm run build
npm test
git diff
```

## 3. ReAct 循环：边想边做边观察

内部大概是这种循环：

```text
用户目标
  ↓
模型生成计划
  ↓
选择工具
  ↓
执行工具
  ↓
读取结果
  ↓
判断是否成功
  ↓
继续下一步 / 修复错误 / 结束
```

比如你让它“给页面左侧加菜单”，它不是直接改代码，而是：

```text
1. 先找路由和布局文件
2. 找 schema / page config
3. 找已有菜单组件
4. 判断应该复用还是新建
5. 修改代码
6. 跑类型检查 / 构建
7. 看报错继续修
8. 输出最终 diff 和说明
```

## 4. 上下文管理：知道项目里有什么

Codex 会把项目文件、命令输出、错误日志、diff、用户指令都塞进上下文里。

但上下文不是无限的，所以它通常会做：

```text
先粗扫目录
再精确读取相关文件
避免一次性读全项目
只把关键片段放进上下文
```

你做 UI Agent / schema Agent 时，也要这么设计，不能一上来把整个 schema 全塞给模型。

## 5. 沙箱和权限控制

Codex 能自主执行，是因为有沙箱边界。OpenAI 官方文档说，Codex 执行本地命令时会运行在受约束环境里，而不是默认拥有机器的完整权限。([OpenAI 开发者][2])

同时还有 approval 机制，比如：

```text
只读模式
workspace-write 模式
需要用户确认的高风险命令
网络访问控制
写入工作区外文件需要审批
```

OpenAI 的安全文档也明确提到 Codex 通过 sandboxing、approvals、network access controls 来安全运行。([OpenAI 开发者][3])

所以它不是“完全放飞”，而是：

```text
低风险自动做
高风险先申请
失败就把错误暴露出来
```

## 6. 任务状态机

真正的 Agent 通常不是一次 LLM 调用，而是一个状态机：

```ts
enum AgentState {
  Understand = "understand",
  Plan = "plan",
  SearchContext = "search_context",
  Execute = "execute",
  Observe = "observe",
  Repair = "repair",
  Verify = "verify",
  Summarize = "summarize",
}
```

每一步都有明确输入输出。

你要做自己的 UI Agent，可以按这个架构：

```text
主 Agent
  ├─ 需求理解器
  ├─ Planner 规划器
  ├─ Context Retriever 项目上下文检索
  ├─ Schema Tool 执行器
  ├─ UI Designer Agent
  ├─ Validator 校验器
  ├─ Renderer Preview 预览器
  └─ Result Reporter 总结器
```

关键不是让模型“更聪明”，而是给它一套工程化执行链路。

最小实现可以这样：

```text
用户输入
  ↓
主 Agent 输出计划
  ↓
查找相关 schema
  ↓
UI Designer Agent 给设计建议
  ↓
主 Agent 决定修改方案
  ↓
调用 schema tools 修改
  ↓
schema validator 校验
  ↓
渲染预览 / diff
  ↓
失败则把错误返回给模型继续修
  ↓
成功后总结
```

一句话：**Codex 的智能 = 强模型 + 工具调用 + 上下文检索 + 执行循环 + 校验反馈 + 沙箱权限。**

你要复刻，不要先追求模型多强，先把 **Plan → Tool → Observe → Repair → Verify** 这条闭环做出来。

[1]: https://github.com/openai/codex?utm_source=chatgpt.com "openai/codex: Lightweight coding agent that runs in your ..."
[2]: https://developers.openai.com/codex/concepts/sandboxing?utm_source=chatgpt.com "Sandbox – Codex"
[3]: https://developers.openai.com/codex/agent-approvals-security?utm_source=chatgpt.com "Agent approvals & security – Codex"



ReAct 循环本质是一个 **while 循环 + LLM 决策 + Tool 执行 + 结果回填**。

最小版长这样：

```ts
while (!done) {
  // 1. 把用户目标 + 当前状态 + 工具结果 发给模型
  const decision = await llm({
    goal,
    history,
    tools,
    currentState,
  });

  // 2. 模型决定下一步
  if (decision.type === "final") {
    done = true;
    return decision.answer;
  }

  // 3. 模型选择工具
  if (decision.type === "tool_call") {
    const result = await runTool(decision.tool, decision.args);

    // 4. 把工具结果作为 observation 塞回上下文
    history.push({
      role: "tool",
      tool: decision.tool,
      args: decision.args,
      result,
    });
  }
}
```

核心就是：

```text
Thought / Plan：模型判断下一步做什么
Action：调用工具
Observation：读取工具返回结果
Repeat：继续下一轮
```

但工程里不要让模型输出大段“思考过程”，而是让它输出结构化 JSON。

例如用户说：

```text
页面左侧添加一个菜单组件
```

模型第一轮输出：

```json
{
  "type": "tool_call",
  "tool": "find_schema",
  "args": {
    "keyword": "layout sidebar menu"
  },
  "reason": "需要先找到当前页面布局和已有菜单组件"
}
```

工具执行后返回：

```json
{
  "matchedFiles": [
    "src/pages/home.schema.json",
    "src/components/menu.schema.json"
  ]
}
```

第二轮模型拿到结果后输出：

```json
{
  "type": "tool_call",
  "tool": "read_schema",
  "args": {
    "path": "src/pages/home.schema.json"
  },
  "reason": "读取当前页面 schema，判断插入位置"
}
```

第三轮可能输出：

```json
{
  "type": "tool_call",
  "tool": "update_schema",
  "args": {
    "path": "src/pages/home.schema.json",
    "operation": "insert",
    "target": "root.children[0]",
    "node": {
      "type": "menu",
      "props": {
        "width": 220,
        "position": "left"
      }
    }
  },
  "reason": "在根布局左侧插入菜单组件"
}
```

然后校验：

```json
{
  "type": "tool_call",
  "tool": "validate_schema",
  "args": {
    "path": "src/pages/home.schema.json"
  },
  "reason": "修改后需要校验 schema 是否合法"
}
```

成功后最终输出：

```json
{
  "type": "final",
  "answer": "已在页面左侧添加菜单组件，并通过 schema 校验。"
}
```

你自己的 Agent 可以这样设计：

```ts
type AgentDecision =
  | {
      type: "tool_call";
      tool: string;
      args: Record<string, any>;
      reason: string;
    }
  | {
      type: "final";
      answer: string;
    }
  | {
      type: "ask_user";
      question: string;
    };
```

执行器：

```ts
async function runAgent(userInput: string) {
  const history: any[] = [];
  let step = 0;

  while (step < 20) {
    step++;

    const decision = await callLLM({
      userInput,
      history,
      tools: toolDescriptions,
    });

    if (decision.type === "final") {
      return decision.answer;
    }

    if (decision.type === "ask_user") {
      return decision.question;
    }

    if (decision.type === "tool_call") {
      const tool = toolRegistry[decision.tool];

      if (!tool) {
        history.push({
          role: "observation",
          error: `Unknown tool: ${decision.tool}`,
        });
        continue;
      }

      try {
        const result = await tool.execute(decision.args);

        history.push({
          role: "observation",
          tool: decision.tool,
          args: decision.args,
          result,
        });
      } catch (err: any) {
        history.push({
          role: "observation",
          tool: decision.tool,
          args: decision.args,
          error: err.message,
        });
      }
    }
  }

  return "任务执行超过最大步数，已停止。";
}
```

工具注册表：

```ts
const toolRegistry = {
  find_schema: {
    description: "查找项目中的 schema 文件",
    execute: async (args) => {
      return findSchemaFiles(args.keyword);
    },
  },

  read_schema: {
    description: "读取指定 schema 文件内容",
    execute: async (args) => {
      return readJson(args.path);
    },
  },

  update_schema: {
    description: "修改 schema 节点",
    execute: async (args) => {
      return updateSchema(args.path, args.operation, args.target, args.node);
    },
  },

  validate_schema: {
    description: "校验 schema 合法性",
    execute: async (args) => {
      return validateSchema(args.path);
    },
  },
};
```

Prompt 可以这样写：

```text
你是一个 UI Schema Agent。

你的目标是完成用户任务，而不是只回答问题。

你必须遵守以下循环：
1. 先判断当前信息是否足够。
2. 如果不够，调用工具查找项目上下文。
3. 如果足够，调用工具修改 schema。
4. 修改后必须调用 validate_schema。
5. 如果工具失败，不要 fallback，直接把错误作为 observation 后继续判断。
6. 最终输出执行总结。

你只能输出 JSON，格式如下：

{
  "type": "tool_call",
  "tool": "工具名",
  "args": {},
  "reason": "为什么要调用这个工具"
}

或者：

{
  "type": "final",
  "answer": "最终结果"
}
```

真正落地时，建议分成 5 个模块：

```text
AgentRunner       // 循环调度器
Planner           // 让模型决定下一步
ToolRegistry      // 工具注册中心
Memory/History    // 保存工具结果和上下文
Validator         // 校验输出和 schema
```

最关键的点是：**LLM 不直接改数据，LLM 只决定调用哪个工具；真正修改由工具执行。**

这样才可控、可追踪、可回滚。
