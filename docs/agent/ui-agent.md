可以，下面是整理后的 **Agent 接入需求文档 v1**。

# Agent 接入需求文档

## 1. 产品定位

在现有 UI 编辑器基础上，接入一个具备规划、推理、执行和工具调用能力的 Agent。

目标不是普通聊天，而是：

```text
用户自然语言
↓
Agent 理解需求
↓
规划操作步骤
↓
调用工具修改 Schema / 页面 / 文件 / 截图 / 搜索
↓
更新画布
↓
返回结果
```

---

# 2. Agent 核心能力

## 2.1 多轮执行能力

Agent 需要支持：

```text
理解用户目标
拆解任务
生成计划
逐步执行
执行后检查
失败重试
结果总结
```

示例：

```text
用户：把这个页面改成医疗后台风格

Agent：
1. 分析当前页面 schema
2. 找到主色、按钮、卡片、表格
3. 生成修改计划
4. 调用 schema update tool
5. 截图对比
6. 返回修改结果
```

---

## 2.2 规划模式

支持两种模式：

### 普通模式

```text
用户说什么，Agent 直接执行
```

### 规划模式

```text
Agent 先生成计划
用户确认后再执行
```

需要支持切换：

```text
开启规划模式
关闭规划模式
只预览计划不执行
执行当前计划
```

---

## 2.3 自我判断能力

Agent 需要判断：

```text
是否需要修改 Schema
是否需要截图
是否需要搜索
是否需要读取文件
是否需要图片识别
是否需要用户确认
```

---

# 3. Agent Tool 系统

## 3.1 Tool 设计原则

所有能力都必须 Tool 化。

```text
Agent
↓
Tool Router
↓
Schema Tools
Page Tools
Canvas Tools
File Tools
Search Tools
Image2Schema Tools
```

每个 Tool 必须包含：

```ts
{
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  handler: Function;
}
```

description 后期可调整，用于提升模型识别准确度。

---

# 4. Schema Tool 能力

## 4.1 Schema 基础能力

需要支持：

```text
读取完整 Schema
校验 Schema
新增节点
删除节点
修改节点
复制节点
移动节点
批量修改节点
读取节点详情
读取节点子树
替换节点子树
```

---

## 4.2 Schema 校验能力

Tool：

```ts
validate_schema
```

能力：

```text
校验节点 id 唯一
校验 parentId 是否存在
校验 children 结构
校验 layout 字段
校验 style 字段
校验 component 字段
校验非法类型
校验图片资源是否存在
```

---

## 4.3 节点级操作

### 通用节点

```text
Text
Image
Group
Frame
Shape
ShapeGroup
Vector
Component
Table
Form
Button
Input
Card
Modal
```

### 通用操作

```text
新增
删除
修改
复制
移动
重命名
隐藏
显示
锁定
解锁
调整层级
```

---

## 4.4 Text Tool

```ts
update_text_node
```

支持修改：

```text
文本内容
字体
字号
字重
颜色
行高
字间距
对齐
宽高
是否自动换行
```

---

## 4.5 Image Tool

```ts
update_image_node
```

支持修改：

```text
src
宽高
裁剪方式
圆角
透明度
替换图片
```

---

## 4.6 Group Tool

```ts
update_group_node
```

支持修改：

```text
x / y
width / height
children
层级
对齐
背景
圆角
阴影
```

---

## 4.7 ShapeGroup Tool

```ts
update_shape_group_node
```

支持修改：

```text
fills
borders
shadows
opacity
path
viewBox
svg paths
booleanOperation
```

---

# 5. Page Tool 页面能力

## 5.1 页面操作

需要 Tool 化：

```text
新增页面
删除页面
重命名页面
复制页面
移动页面
读取页面
读取页面列表
设置当前页面
根据页面生成截图
根据页面 Schema 生成描述
```

---

## 5.2 Tool 示例

```ts
create_page
delete_page
rename_page
duplicate_page
move_page
get_page_schema
update_page_schema
```

---

# 6. Canvas Tool 画布能力

## 6.1 截图能力

需要支持：

```text
整页截图
当前画布截图
选中节点截图
局部区域截图
指定坐标区域截图
```

---

## 6.2 识别能力

截图后可用于：

```text
分析当前 UI
判断布局问题
对比修改前后
根据参考图调整页面
识别局部区域内容
```

---

## 6.3 Tool

```ts
capture_canvas
capture_selected_nodes
capture_region
analyze_screenshot
compare_screenshots
```

---

# 7. 文件 Tool 能力

## 7.1 范围限制

文件能力只允许访问：

```text
workspace 内文件
```

不允许随意访问系统目录。

---

## 7.2 文件操作

```text
读取文件
列出目录
搜索文件
读取图片
读取 JSON
读取 schema 文件
读取上传资源
```

暂不建议第一版开放写文件能力，避免 Agent 误改。

---

# 8. MCP / Skills 能力

## 8.1 MCP 能力

预留 MCP 接入层：

```text
MCP Server
↓
Tool Adapter
↓
Agent Tool Registry
```

支持后期接入：

```text
文件系统
数据库
浏览器
Git
设计资源库
代码生成器
```

---

## 8.2 Skills 能力

Skills 用来封装复杂流程：

```text
导入 Sketch Skill
图片转 Schema Skill
页面优化 Skill
代码生成 Skill
UI 对比 Skill
```

Skill 本质是：

```text
Prompt + Tools + Workflow
```

---

# 9. 联网搜索能力

## 9.1 搜索范围

支持搜索：

```text
Sketch 素材
UI 页面参考
设计风格
组件样式
图标素材
行业页面
```

---

## 9.2 Tool

```ts
web_search
web_image_search
fetch_url_content
```

搜索结果不能直接写入 Schema，必须经过 Agent 判断和用户确认。

---

# 10. 图片转 Schema 能力

## 10.1 输入

```text
上传图片
截图
参考页面
局部区域图片
```

---

## 10.2 输出

```text
页面结构
节点树
布局信息
颜色
字体估算
图片区域
组件识别
```

---

## 10.3 流程

```text
图片
↓
视觉识别
↓
布局分块
↓
组件识别
↓
生成 Schema
↓
Schema 校验
↓
渲染预览
↓
用户调整
```

---

# 11. Agent 执行链路

```text
User Request
↓
Intent Parser
↓
Planner
↓
Tool Selection
↓
Tool Execution
↓
Schema Patch
↓
Schema Validation
↓
Canvas Render
↓
Screenshot Check
↓
Final Response
```

---

# 12. 推荐目录结构

```text
agent/
├─ core/
│  ├─ planner.ts
│  ├─ executor.ts
│  ├─ memory.ts
│  ├─ tool-registry.ts
│  └─ tool-router.ts
│
├─ tools/
│  ├─ schema/
│  ├─ page/
│  ├─ canvas/
│  ├─ file/
│  ├─ search/
│  └─ image-to-schema/
│
├─ skills/
│  ├─ sketch-import/
│  ├─ ui-review/
│  ├─ image-to-schema/
│  └─ d2c/
│
└─ prompts/
   ├─ system.md
   ├─ planner.md
   └─ tool-selection.md
```

---

# 13. 第一版必须实现的 Tool

```text
Schema:
- get_schema
- validate_schema
- update_node
- create_node
- delete_node
- duplicate_node
- move_node

Page:
- list_pages
- get_page
- create_page
- delete_page
- rename_page
- duplicate_page

Canvas:
- capture_canvas
- capture_selected_nodes
- capture_region

File:
- read_workspace_file
- list_workspace_files

AI:
- image_to_schema
- compare_schema_with_image
```

---

# 14. 关键结论

你现在要做的不是简单“接个聊天框”，而是：

```text
Agent + Tool System + Schema Patch Engine
```

核心是：

```text
Agent 不能直接改页面
必须通过标准 Tool 修改 Schema
所有修改必须可校验、可回滚、可追踪
```

这套能力做完，你的产品就从“UI 编辑器”升级成：

```text
AI 驱动的原型 / UI 生成与编辑平台
```
