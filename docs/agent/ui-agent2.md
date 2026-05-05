可以，这里把你的要求整理成 **Agent 执行规范 v2**，偏 Codex 风格：**先说明计划，再执行；失败直接暴露错误；不做 fallback；自主规划但过程透明**。

# Agent 执行规范 v2

## 1. 核心原则

```text
用户输入需求
↓
Agent 先输出执行计划
↓
按计划调用 tool
↓
每一步输出简要结果
↓
失败直接输出错误
↓
完成后给最终反馈
```

参考 Codex 的关键点是：复杂任务不要跳过规划；遇到不确定、测试失败或执行失败时，要明确告知用户，而不是假装成功。OpenAI Codex 文档也强调复杂任务需要规划，失败/不确定时应明确沟通。([OpenAI 开发者][1])

---

# 2. Agent 响应格式

## 2.1 执行前必须输出

示例用户输入：

```text
页面左侧添加一个菜单组件
```

Agent 先输出：

```text
我准备这样做：

1. 读取当前项目页面列表
2. 获取当前页面 schema
3. 查找左侧布局容器
4. 判断是否已有菜单组件
5. 如果没有，创建菜单节点
6. 插入到左侧区域
7. 校验 schema
8. 刷新画布并输出结果
```

---

## 2.2 执行中输出

每个阶段简要输出：

```text
已读取当前页面 schema
已定位左侧容器：layout-sidebar
已创建菜单组件：menu_xxx
已完成 schema 校验
```

---

## 2.3 执行失败输出

不 fallback，不隐藏错误：

```text
执行失败：

Tool: update_node
Error: parentId "layout-sidebar" 不存在
Context:
- 当前页面：home
- 尝试插入节点：Menu
- 插入目标：layout-sidebar

建议：
请先确认页面中是否存在左侧容器，或允许我创建一个新的侧边栏容器。
```

---

# 3. 自主规划规则

Agent 需要自己判断先做什么。

## 3.1 默认优先级

```text
1. 优先读取当前项目 schema
2. 优先读取当前页面 schema
3. 优先读取选中节点
4. 必要时读取 workspace 文件
5. 如果允许联网，再联网搜索
6. 最后才提出建议
```

---

## 3.2 示例：页面左侧添加菜单组件

Agent 的内部判断：

```text
用户要修改页面
↓
需要知道当前页面结构
↓
调用 get_current_page
↓
调用 get_page_schema
↓
查找左侧容器
↓
调用 create_node
↓
调用 validate_schema
```

---

# 4. 不满足条件时的行为

如果当前条件不足，不要瞎执行。

## 示例

```text
当前没有打开页面
```

输出：

```text
当前无法执行：

原因：
没有当前激活页面，无法判断菜单应该插入到哪个页面。

建议：
请先打开一个页面，或指定页面名称。
```

---

## 示例

```text
没有 schema
```

输出：

```text
当前无法执行：

原因：
当前项目没有可用 schema。

建议：
可以先通过「新建页面」或「导入 Sketch」生成页面 schema。
```

---

# 5. Tool 失败处理规则

## 5.1 失败不 fallback

```text
Tool 调用失败
↓
停止当前步骤
↓
输出 tool 名称
↓
输出错误信息
↓
输出上下文
↓
给出建议
```

---

## 5.2 错误输出结构

```json
{
  "status": "failed",
  "tool": "update_node",
  "error": {
    "code": "PARENT_NOT_FOUND",
    "message": "parentId layout-sidebar not found"
  },
  "context": {
    "pageId": "page_home",
    "targetParentId": "layout-sidebar",
    "nodeType": "Menu"
  },
  "suggestion": "请先创建侧边栏容器，或指定插入位置。"
}
```

---

# 6. Tool 调用设计

每个 Tool 要标准化：

```ts
type AgentTool = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  handler: (input, context) => Promise<ToolResult>;
};
```

结果必须统一：

```ts
type ToolResult<T = any> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
};
```

---

# 7. Agent 执行器伪代码

```ts
async function runAgentTask(userInput: string, context: AgentContext) {
  const plan = await planner.createPlan(userInput, context);

  await ui.showPlan(plan);

  for (const step of plan.steps) {
    await ui.showStepStart(step);

    const result = await toolExecutor.run(step.tool, step.input);

    if (!result.ok) {
      await ui.showToolError({
        step,
        tool: step.tool,
        error: result.error,
        context: step.input,
        suggestion: buildSuggestion(result.error, step),
      });

      return {
        ok: false,
        failedStep: step,
        error: result.error,
      };
    }

    await ui.showStepResult({
      step,
      result: summarizeToolResult(result.data),
    });
  }

  return {
    ok: true,
    summary: await summarizeFinalResult(plan),
  };
}
```

---

# 8. 计划对象结构

```ts
type AgentPlan = {
  title: string;
  userGoal: string;
  assumptions: string[];
  steps: AgentStep[];
};

type AgentStep = {
  id: string;
  title: string;
  reason: string;
  tool: string;
  input: any;
  expectedResult: string;
};
```

---

# 9. 示例计划

用户：

```text
页面左侧添加一个菜单组件
```

Agent 输出：

```json
{
  "title": "在当前页面左侧添加菜单组件",
  "userGoal": "给页面增加左侧菜单",
  "assumptions": [
    "优先修改当前激活页面",
    "优先查找已有左侧容器",
    "如果没有左侧容器，则停止并给出建议"
  ],
  "steps": [
    {
      "id": "step_1",
      "title": "读取当前页面",
      "reason": "需要确定要修改哪个页面",
      "tool": "get_current_page",
      "input": {},
      "expectedResult": "返回当前页面 ID"
    },
    {
      "id": "step_2",
      "title": "读取页面 schema",
      "reason": "需要找到左侧区域或根容器",
      "tool": "get_page_schema",
      "input": {
        "pageId": "{{step_1.pageId}}"
      },
      "expectedResult": "返回当前页面完整 schema"
    },
    {
      "id": "step_3",
      "title": "查找左侧容器",
      "reason": "菜单应该插入到左侧区域",
      "tool": "find_nodes",
      "input": {
        "query": {
          "layoutPosition": "left",
          "types": ["Frame", "Group", "Container"]
        }
      },
      "expectedResult": "返回左侧容器节点"
    },
    {
      "id": "step_4",
      "title": "创建菜单组件",
      "reason": "将菜单插入左侧容器",
      "tool": "create_node",
      "input": {
        "type": "Menu",
        "parentId": "{{step_3.nodeId}}",
        "props": {
          "items": [
            { "label": "首页", "key": "home" },
            { "label": "订单管理", "key": "orders" },
            { "label": "系统设置", "key": "settings" }
          ]
        }
      },
      "expectedResult": "返回新建菜单节点"
    },
    {
      "id": "step_5",
      "title": "校验 schema",
      "reason": "确保修改后 schema 合法",
      "tool": "validate_schema",
      "input": {
        "pageId": "{{step_1.pageId}}"
      },
      "expectedResult": "schema 校验通过"
    }
  ]
}
```

---

# 10. 前端交互建议

Agent 面板显示：

```text
用户需求
执行计划
执行进度
Tool 调用结果
错误详情
最终反馈
```

不要只显示一句：

```text
已完成
```

要显示：

```text
已完成：
- 修改页面：首页
- 新增节点：Menu
- 插入位置：layout-sidebar
- schema 校验：通过
```

---

# 11. 最终行为规范

```text
1. Agent 自主规划
2. 执行前展示计划
3. 优先读取当前项目 schema
4. 有联网能力时按需联网
5. Tool 失败直接输出错误
6. 不做 fallback
7. 不隐藏失败
8. 不假装完成
9. 条件不足时给明确建议
10. 每次执行后给简要总结
```

这版可以直接作为 Agent Runtime 的执行协议。

[1]: https://developers.openai.com/codex/learn/best-practices?utm_source=chatgpt.com "Best practices – Codex"
