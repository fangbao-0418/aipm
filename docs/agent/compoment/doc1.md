你现在要做的核心不是让 Agent “自由生成页面”，而是让它：

> 基于已导入 Sketch 的 AntD 风格资产，按约束生成页面。

否则它一定会布局乱、风格飘。

## 一句话方案

把 Sketch 解析结果变成一套 **Design System + Layout Rules + Component Templates**，Agent 只能在这套规则里组装页面，不能随便画。

---

# 1. 先从 Sketch 提取“风格资产”

你已经能完美复原 Sketch，那么要进一步抽取：

```ts
DesignSystem {
  colors: Token[]
  typography: Token[]
  spacing: Token[]
  radius: Token[]
  shadows: Token[]
  components: ComponentTemplate[]
  pageLayouts: LayoutTemplate[]
}
```

重点不是保存所有节点，而是提炼这些东西：

```txt
按钮样式
表格样式
查询表单样式
卡片样式
页面标题区
操作按钮区
分页区
列表页整体布局
```

例如从 Sketch 里识别出：

```txt
AntD订单列表页模板：
- 页面背景：#f5f7fa
- 主内容卡片：白底、圆角8、padding 24
- 查询区：Form inline，间距16
- 表格区：margin-top 16
- 操作按钮：右上角
- 表格行高：54
- 主按钮颜色：品牌蓝
```

这些要沉淀成机器可读规则。

---

# 2. 不要让 Agent 直接生成 Schema

错误方式：

```txt
用户：生成订单列表页
Agent：直接生成一堆 rect/text/group/table
```

这样必乱。

正确方式：

```txt
用户：生成订单列表页
Agent：先选择页面模板
Agent：再选择组件模板
Agent：最后填充业务字段
```

生成链路应该是：

```txt
用户需求
  ↓
页面意图识别：订单列表页
  ↓
匹配模板：AntD后台列表页模板
  ↓
生成页面结构 DSL
  ↓
映射为 Sketch Schema / 你自己的 Schema
  ↓
布局校验
  ↓
风格校验
  ↓
渲染
```

---

# 3. 中间必须有一层 Page DSL

不要直接让模型生成 Sketch JSON。

先让它生成这种结构：

```ts
const pageDSL = {
  type: "page",
  name: "订单列表页",
  layout: "antd-admin-list-page",
  sections: [
    {
      type: "queryForm",
      fields: [
        { label: "订单编号", type: "input" },
        { label: "订单状态", type: "select" },
        { label: "下单时间", type: "dateRange" }
      ],
      actions: ["search", "reset"]
    },
    {
      type: "toolbar",
      actions: ["新增订单", "批量导出"]
    },
    {
      type: "table",
      columns: [
        "订单编号",
        "患者姓名",
        "服务类型",
        "护理员",
        "订单状态",
        "下单时间",
        "操作"
      ],
      operations: ["查看", "编辑", "取消"]
    }
  ]
}
```

然后由你的程序把 DSL 转成真实 Schema。

这样模型负责“理解业务”，程序负责“稳定布局”。

---

# 4. Agent 分角色，不要一个 Agent 干完

你可以这样拆：

```txt
1. Product Agent
   负责理解需求，拆出页面模块、字段、业务动作

2. UI Designer Agent
   负责选择 Sketch 中已有的 AntD 风格模板

3. Layout Agent
   负责套用布局规则，计算位置、宽高、间距

4. Schema Executor
   负责生成/修改 schema

5. Validator Agent
   负责检查是否风格一致、是否越界、是否重叠
```

重点：
**UI Designer Agent 不应该自由发挥，它只允许从模板库里选。**

---

# 5. 最关键：建立 AntD 风格模板库

你需要从导入的 Sketch 里抽出这些模板：

```txt
PageTemplate:
- 后台列表页
- 表单页
- 详情页
- 弹窗表单
- 左侧菜单布局
- 顶部导航布局

ComponentTemplate:
- 查询表单
- 操作栏
- 数据表格
- 状态 Tag
- 分页
- 卡片容器
- 面包屑
- 页面标题
```

例如：

```ts
const listPageTemplate = {
  id: "antd-admin-list-page",
  canvas: {
    width: 1440,
    background: "#f5f7fa"
  },
  layout: {
    sidebarWidth: 208,
    headerHeight: 56,
    contentPadding: 24,
    cardPadding: 24,
    sectionGap: 16
  },
  sections: [
    "breadcrumb",
    "pageTitle",
    "queryCard",
    "tableCard"
  ]
}
```

Agent 生成订单列表页时，只能套这个。

---

# 6. 解决“布局乱”的本质方法

你现在布局乱，通常是因为模型在做这几件它不擅长的事：

```txt
计算 x/y
计算宽高
控制对齐
处理自适应
处理组件间距
处理表格列宽
```

这些不要交给模型。

应该交给规则引擎。

例如：

```ts
layoutEngine.renderListPage({
  template: "antd-admin-list-page",
  fields,
  columns,
  actions
})
```

布局引擎负责：

```txt
x = sidebarWidth + contentPadding
y = headerHeight + contentPadding
width = canvasWidth - sidebarWidth - contentPadding * 2
```

模型只输出：

```txt
有哪些字段
有哪些列
有哪些按钮
页面是什么类型
```

---

# 7. 解决“没有风格”的本质方法

不要让 Agent 写：

```txt
蓝色按钮
白色卡片
灰色背景
```

而是让它引用 Token：

```ts
{
  background: "token.color.pageBg",
  cardBg: "token.color.containerBg",
  primaryColor: "token.color.primary",
  borderRadius: "token.radius.card",
  fontSize: "token.font.body"
}
```

也就是：

```txt
Agent 不决定颜色
Agent 只决定用哪个语义 Token
```

---

# 8. 推荐你的最终架构

```txt
Sketch Importer
   ↓
Design System Extractor
   ↓
Template Library
   ↓
User Prompt
   ↓
Requirement Agent
   ↓
Page DSL
   ↓
Template Matcher
   ↓
Layout Engine
   ↓
Schema Generator
   ↓
Validator
   ↓
Preview / Diff / Apply
```

---

# 你现在下一步最该做什么

不要先做完整 Agent。

先做一个固定闭环：

```txt
输入：
“生成一个订单列表页，用 AntD 风格”

输出：
稳定生成一个订单列表页
```

实现顺序：

```txt
1. 手写一个 antd-admin-list-page 模板
2. 手写 queryForm / table / toolbar 三个组件模板
3. 让模型只生成 Page DSL
4. 你用代码把 Page DSL 转成 Sketch Schema
5. 加一个 overlap / alignment / token 校验器
```

只要这个跑通，后面 Agent 才有意义。

核心原则：

> Agent 负责理解，模板负责风格，布局引擎负责稳定，Schema Executor 负责落地。



## 要考虑还有其他组件库，还要考虑组件库定制

需要，而且**非常需要**。

但不要做成“AntD 全量 schema 工具”，而是做成：

> **AntD 组件模板工具 + 布局生成工具 + 风格 Token 工具**

也就是 Agent 不直接画页面，而是调用工具：

```txt
createAntdListPage()
createAntdSearchForm()
createAntdTable()
createAntdToolbar()
createAntdStatusTag()
```

## 推荐工具形态

```ts
tools = {
  createAntdListPage(args),
  createAntdSearchForm(args),
  createAntdTable(args),
  createAntdToolbar(args),
  createAntdPagination(args),
  createAntdButton(args),
  createAntdModalForm(args),
}
```

比如用户说：

```txt
生成一个订单列表页
```

Agent 不生成 JSON 节点，而是调用：

```ts
createAntdListPage({
  title: "订单列表",
  searchFields: [
    { label: "订单编号", type: "input" },
    { label: "订单状态", type: "select" },
    { label: "下单时间", type: "dateRange" }
  ],
  toolbarActions: ["新增订单", "批量导出"],
  columns: [
    "订单编号",
    "患者姓名",
    "服务类型",
    "护理员",
    "订单状态",
    "下单时间",
    "操作"
  ]
})
```

工具内部负责：

```txt
x / y / width / height
间距
字体
颜色
圆角
表格行高
按钮样式
对齐
分页
```

Agent 只负责：

```txt
页面类型
字段
列
按钮
业务语义
```

## 最小 MVP 先做这些工具

```txt
1. createPageFrame
2. createSearchForm
3. createToolbar
4. createTable
5. createStatusTag
6. createPagination
7. validateLayout
```

先不要做全量 AntD。

你现在最应该做的是：

```txt
订单列表页工具链
```

跑通一个闭环。

## 关键原则

不要让 Agent 直接写：

```json
{ "x": 123, "y": 456, "fill": "#1677ff" }
```

而是让它写：

```json
{
  "component": "AntdTable",
  "variant": "default",
  "token": "antd.default",
  "columns": [...]
}
```

再由工具生成你自己的 Sketch schema。

## 结论

是的，要做。

但它本质不是“schema 工具”，而是：

> **把 AntD 设计规范封装成 Agent 可调用的页面搭建工具。**

这样才能解决你现在的两个核心问题：

```txt
布局乱：交给工具布局
没有风格：交给模板和 token
```


## 比如要创建一个antd风格的交互，antd的属性怎么来，需要我把antd都抽成组件资源吗

不需要把 **AntD 全量属性** 都抽成组件资源。
你真正需要抽的是：

> **高频组件 + 常用属性 + 设计态渲染规则 + 默认模板**

不是把 AntD 文档搬一遍。

## 你要分清 3 层

### 1. 组件资源层

比如：

```ts
Button
Input
Select
DatePicker
Form
Table
Card
Tag
Modal
Tabs
Pagination
```

这些要抽。

### 2. 属性协议层

不用全量抽，只抽 Agent 生成页面常用的：

```ts
ButtonProps {
  text
  type: "primary" | "default" | "danger"
  size: "small" | "middle" | "large"
  disabled
  icon
}
```

```ts
TableProps {
  columns
  dataPreview
  rowActions
  pagination
  size
  bordered
}
```

```ts
FormProps {
  layout
  fields
  actions
  columns
}
```

### 3. 渲染模板层

最重要的是这一层。

例如 `Button primary` 在你的 Sketch AntD 风格里到底长什么样：

```ts
Button.primary.middle = {
  widthRule: "auto",
  height: 32,
  paddingX: 15,
  radius: "token.radius.sm",
  background: "token.color.primary",
  textColor: "token.color.white",
  fontSize: 14
}
```

Agent 不应该知道这些细节。
它只说：

```json
{
  "component": "Button",
  "props": {
    "type": "primary",
    "text": "查询"
  }
}
```

工具负责生成具体 schema。

---

# AntD 属性怎么来？

有 3 个来源。

## 来源一：AntD 官方属性

用于定义“能力边界”。

比如 Button 有：

```txt
type
size
disabled
loading
icon
danger
```

但你不需要全量支持。

第一版只支持 20% 高频属性。

## 来源二：你导入的 Sketch 样式

用于决定“长什么样”。

比如：

```txt
primary button 高度多少
表格行高多少
查询表单 label 多宽
Card padding 多少
Tag 颜色怎么用
```

这个比官方文档更重要。

## 来源三：你自己的业务模板

用于决定“怎么组合”。

例如订单列表页：

```txt
SearchForm + Toolbar + Table + Pagination
```

这不是 AntD 官方属性，而是你的产品模板。

---

# 是否要把 AntD 都抽成组件资源？

不要。

第一阶段只抽这些就够了：

```txt
页面级：
- AdminListPage
- AdminFormPage
- AdminDetailPage

布局级：
- PageFrame
- ContentCard
- SearchForm
- Toolbar
- DataTable

基础组件：
- Button
- Input
- Select
- DateRangePicker
- Table
- Tag
- Pagination
- Modal
```

不要一开始抽：

```txt
Tree
Upload
Transfer
Cascader
Calendar
Timeline
Statistic
Tour
Watermark
```

除非你的业务马上要用。

---

# 推荐你的组件资源格式

```ts
type ComponentResource = {
  id: string;
  kit: "antd";
  name: string;
  category: "basic" | "form" | "data" | "layout" | "feedback";
  propsSchema: JSONSchema;
  variants: Record<string, VariantSchema>;
  renderSchema: RenderTemplate;
  layoutRules: LayoutRules;
};
```

例如 Button：

```ts
{
  id: "antd.button",
  name: "Button",
  propsSchema: {
    text: "string",
    type: ["primary", "default", "dashed", "text", "link"],
    size: ["small", "middle", "large"],
    danger: "boolean",
    disabled: "boolean",
    icon: "string?"
  },
  variants: {
    "primary.middle": {
      height: 32,
      paddingX: 15,
      radius: "token.radius.sm",
      background: "token.color.primary",
      textColor: "token.color.white"
    }
  }
}
```

---

# Agent 应该怎么用？

用户说：

```txt
创建一个订单列表页，AntD 风格
```

Agent 输出不要是 Sketch schema。

而是：

```json
{
  "designKit": "antd",
  "pageType": "admin-list",
  "title": "订单列表",
  "components": [
    {
      "type": "SearchForm",
      "fields": [
        { "label": "订单编号", "component": "Input" },
        { "label": "订单状态", "component": "Select" },
        { "label": "下单时间", "component": "DateRangePicker" }
      ]
    },
    {
      "type": "DataTable",
      "columns": [
        { "title": "订单编号", "dataIndex": "orderNo" },
        { "title": "患者姓名", "dataIndex": "patientName" },
        { "title": "订单状态", "dataIndex": "status", "render": "Tag" },
        { "title": "操作", "render": "Actions" }
      ]
    }
  ]
}
```

然后你的 `DesignKitTool` 负责：

```txt
查找 AntD 组件资源
套用 Sketch 风格
计算布局
生成 schema
```

---

# 最小实现路线

你现在先做这个：

```txt
1. 抽 10 个 AntD 高频组件
2. 每个组件只支持 5～10 个常用属性
3. 每个组件定义 2～3 个 variant
4. 做 3 个页面模板：列表页、表单页、详情页
5. Agent 只生成 UI DSL
6. 工具把 UI DSL 转 Sketch Schema
```

## 最关键的一句

> AntD 属性负责“能表达什么”，Sketch 解析结果负责“长什么样”，你的页面模板负责“怎么组合”。

所以，不要全量抽 AntD。
先抽你要生成页面必须用到的那一小部分。


## 怎么抽，创建本地组件吗，组件集合，一个组件就是一个schema

对，建议你做成**本地组件集合**，但不要理解成“一个组件 = 一个固定 schema”。

更准确是：

> **一个组件 = 组件定义 + 属性协议 + 风格变体 + schema 生成器**

也就是它不是死 JSON，而是一个“可参数化的组件工厂”。

## 推荐结构

```txt
/design-kits
  /antd
    kit.json
    tokens.json
    /components
      Button.json
      Input.json
      Select.json
      SearchForm.json
      DataTable.json
      Card.json
      Tag.json
    /templates
      AdminListPage.json
      AdminFormPage.json
```

## 一个组件长这样

以 Button 为例：

```ts
{
  "id": "antd.Button",
  "name": "Button",
  "propsSchema": {
    "text": "string",
    "type": ["primary", "default", "danger"],
    "size": ["small", "middle", "large"]
  },
  "defaultProps": {
    "type": "default",
    "size": "middle",
    "text": "按钮"
  },
  "variants": {
    "primary.middle": {
      "height": 32,
      "paddingX": 15,
      "radius": 6,
      "background": "token.colorPrimary",
      "textColor": "#fff",
      "fontSize": 14
    }
  },
  "schemaFactory": "renderButton"
}
```

这里的 `schemaFactory` 才是真正生成你 Sketch schema 的地方。

---

# 不建议：一个组件就是一个 schema

这种方式：

```txt
Button = 一坨固定 schema
Table = 一坨固定 schema
```

前期很快，但后面会崩。

因为你会遇到：

```txt
按钮文字长度不同
表格列数不同
表单字段不同
不同主题颜色不同
不同尺寸不同
不同组件库不同
```

所以不要存死 schema。

---

# 推荐：组件资源 + schema 模板

比如 Button 可以生成：

```ts
renderButton({
  text: "查询",
  type: "primary",
  size: "middle"
})
```

输出：

```ts
{
  type: "group",
  name: "Button/Primary",
  width: 64,
  height: 32,
  children: [
    {
      type: "rect",
      fill: "token.colorPrimary",
      radius: 6
    },
    {
      type: "text",
      content: "查询",
      fontSize: 14,
      color: "#fff"
    }
  ]
}
```

也就是说：

```txt
组件定义：说明它是什么
propsSchema：说明它能配置什么
variants：说明它有哪些样式
schemaFactory：负责真正画出来
```

---

# 对复杂组件要分两层

比如表格，不要一个 Table schema 写死。

应该拆成：

```txt
DataTable
  ├─ TableHeader
  ├─ TableRow
  ├─ TableCell
  ├─ StatusTag
  ├─ ActionLinks
  └─ Pagination
```

表格组件定义：

```ts
{
  "id": "antd.DataTable",
  "propsSchema": {
    "columns": "Column[]",
    "rows": "number",
    "size": ["middle", "small"],
    "bordered": "boolean",
    "pagination": "boolean"
  },
  "schemaFactory": "renderDataTable"
}
```

Agent 只传：

```json
{
  "component": "DataTable",
  "columns": [
    { "title": "订单编号", "width": 160 },
    { "title": "患者姓名", "width": 120 },
    { "title": "订单状态", "width": 120, "render": "StatusTag" },
    { "title": "操作", "width": 160, "render": "Actions" }
  ]
}
```

工具负责生成表头、行、分割线、分页。

---

# 最小落地方式

你现在可以先这么做：

## 第一步：建组件注册表

```ts
const componentRegistry = {
  "antd.Button": renderButton,
  "antd.Input": renderInput,
  "antd.Select": renderSelect,
  "antd.SearchForm": renderSearchForm,
  "antd.DataTable": renderDataTable,
  "antd.Card": renderCard,
  "antd.Tag": renderTag,
};
```

## 第二步：定义统一调用格式

```ts
createComponent({
  kit: "antd",
  component: "Button",
  props: {
    text: "查询",
    type: "primary"
  }
});
```

## 第三步：输出你的页面 schema

```ts
const schema = createPage({
  kit: "antd",
  template: "AdminListPage",
  title: "订单列表",
  sections: [
    {
      component: "SearchForm",
      props: {
        fields: [
          { label: "订单编号", component: "Input" },
          { label: "订单状态", component: "Select" }
        ]
      }
    },
    {
      component: "DataTable",
      props: {
        columns: [
          { title: "订单编号" },
          { title: "患者姓名" },
          { title: "订单状态", render: "Tag" },
          { title: "操作", render: "Actions" }
        ]
      }
    }
  ]
});
```

---

# 最佳理解

你要抽的不是：

```txt
AntD 的完整源码组件
```

也不是：

```txt
Sketch 里的一坨静态节点
```

而是：

```txt
可被 Agent 调用的设计组件资源
```

一个组件应该包含：

```txt
1. 名称
2. 支持属性
3. 默认值
4. 风格 token
5. layout 规则
6. schema 生成函数
7. 校验规则
```

最终形态：

```txt
Agent 生成 DSL
组件资源负责风格
schemaFactory 负责落地
layoutEngine 负责排版
validator 负责防乱
```

所以答案是：

> 是，创建本地组件集合；但一个组件不要等于一个固定 schema，而应该等于一个“可配置 schema 工厂”。

## 可是我把sketch的antd搞成组件他就是死的schema，怎么变活，怎么对你这说的那一套抽象层，还有token
关键是：**不要直接把 Sketch 组件当最终组件用**。
Sketch 里的 AntD 组件确实是“死 schema”，你要做的是把它拆成“样板 + 参数 + 规则”。

可以这么变活：

```txt
死 schema
  ↓
分析节点结构
  ↓
识别可变区域
  ↓
提取 token
  ↓
提取 variant
  ↓
生成 schemaFactory
```

## 1. 先把死 schema 分成三类

以 Button 为例：

```txt
固定部分：
- rect 背景
- text 文本
- group 层级

可变部分：
- 文案
- 宽度
- 背景色
- 文本色
- icon
- disabled 状态

规则部分：
- 高度 32
- 左右 padding 15
- 文本居中
- 宽度 = 文本宽度 + padding * 2
```

然后原来的 schema 不再直接复用，而是变成：

```ts
renderButton({
  text: "查询",
  type: "primary",
  size: "middle"
})
```

## 2. 从 Sketch schema 里提 token

比如你解析到：

```json
{
  "fill": "#1677ff",
  "radius": 6,
  "fontSize": 14,
  "height": 32
}
```

不要直接写死在组件里，变成：

```json
{
  "fill": "token.color.primary",
  "radius": "token.radius.sm",
  "fontSize": "token.font.body",
  "height": "token.control.height.md"
}
```

也就是建立一个映射表：

```ts
tokens = {
  color: {
    primary: "#1677ff",
    text: "#1f1f1f",
    textSecondary: "#8c8c8c",
    border: "#d9d9d9",
    bgContainer: "#ffffff",
    bgLayout: "#f5f5f5"
  },
  radius: {
    sm: 6,
    md: 8
  },
  font: {
    body: 14,
    title: 20
  },
  control: {
    heightSm: 24,
    heightMd: 32,
    heightLg: 40
  },
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24
  }
}
```

## 3. 原始 Sketch 组件只作为“参考样本”

比如你从 Sketch 得到一个按钮：

```json
{
  "type": "group",
  "width": 74,
  "height": 32,
  "children": [
    { "type": "rect", "fill": "#1677ff", "radius": 6 },
    { "type": "text", "content": "查询", "fontSize": 14 }
  ]
}
```

你不要保存成固定按钮，而是抽成模板：

```ts
function renderButton(props, ctx) {
  const token = ctx.tokens;
  const height = token.control.heightMd;
  const paddingX = 15;
  const textWidth = measureText(props.text, 14);

  return {
    type: "group",
    name: `Button/${props.type}`,
    width: textWidth + paddingX * 2,
    height,
    children: [
      {
        type: "rect",
        x: 0,
        y: 0,
        width: "100%",
        height,
        radius: token.radius.sm,
        fill: props.type === "primary"
          ? token.color.primary
          : token.color.bgContainer,
        border: props.type === "default"
          ? token.color.border
          : undefined
      },
      {
        type: "text",
        content: props.text,
        x: paddingX,
        y: 6,
        fontSize: token.font.body,
        color: props.type === "primary"
          ? "#fff"
          : token.color.text
      }
    ]
  };
}
```

这一步就从“死 schema”变成“活组件”。

## 4. 抽象层最小可以这样做

```ts
type ComponentDefinition = {
  id: string;
  propsSchema: any;
  defaultProps: any;
  variants: Record<string, any>;
  render: (props: any, ctx: RenderContext) => SchemaNode;
};

type RenderContext = {
  tokens: DesignTokens;
  kit: "antd" | "element" | "custom";
};
```

注册组件：

```ts
registerComponent({
  id: "antd.Button",
  propsSchema: {
    text: "string",
    type: ["primary", "default"],
    size: ["small", "middle", "large"]
  },
  defaultProps: {
    text: "按钮",
    type: "default",
    size: "middle"
  },
  render: renderButton
});
```

调用时：

```ts
createComponent("antd.Button", {
  text: "查询",
  type: "primary"
});
```

## 5. 对复杂组件，不要整体变活，要拆子组件

表格不要从一个大 schema 改。

拆成：

```txt
Table
  HeaderCell
  BodyCell
  Row
  StatusTag
  ActionLinks
  Pagination
```

表格的活来自：

```txt
columns 数量可变
column width 可变
row count 可变
cell render 可变
pagination 可开关
```

也就是：

```ts
renderTable({
  columns: [
    { title: "订单编号", width: 160 },
    { title: "患者姓名", width: 120 },
    { title: "订单状态", width: 120, render: "Tag" },
    { title: "操作", width: 160, render: "Actions" }
  ],
  rows: 5,
  pagination: true
});
```

## 6. 你真正要做的转换流程

```txt
Sketch AntD 样稿
  ↓
提取 tokens
  ↓
识别组件样本
  ↓
标记可变字段
  ↓
写 render factory
  ↓
注册到 DesignKit
  ↓
Agent 通过 DSL 调用组件
```

## 7. 第一版不要追求自动抽象

建议先半自动：

```txt
1. 用程序从 Sketch 里提颜色、字体、圆角、间距
2. 人工确认 token 命名
3. 选 10 个组件样本
4. 人工写 render factory
5. 后面再让 AI 辅助生成 factory
```

## 8. 最重要的一句话

Sketch 里的 schema 是：

```txt
结果态
```

你要抽象出来的是：

```txt
生成规则
```

也就是从：

```txt
这个按钮长这样
```

变成：

```txt
所有 primary button 都按这个规则生成
```

最终你需要的不是“组件库 schema”，而是：

```txt
组件库生成器。
```

这样 Agent 生成订单列表页时，就不会乱画，而是调用：

```txt
AdminListPage → SearchForm → Button/Input/Table/Tag
```

每一层都走 token、variant、layout rule，风格自然就统一了。

## 还有就是很依赖本地的antd组件资源

对，会很依赖本地组件资源。

但这是**必须依赖**，只是不要依赖成“死组件库”，而要依赖成：

> **本地 Design Kit 资产库 + 可降级生成能力**

## 你应该接受这个依赖

因为 Agent 自己不会稳定生成 AntD 风格。
稳定风格一定来自本地资产：

```txt
tokens
组件模板
页面模板
布局规则
schemaFactory
```

这就是你的核心壁垒。

## 但要避免强绑定 AntD

不要这样：

```txt
Agent → antd.Button schema
```

而是这样：

```txt
Agent → UI DSL → 当前 DesignKit → Schema
```

当前项目可以选择：

```txt
designKit = antd
designKit = element-plus
designKit = hospital-custom
designKit = imported-sketch-kit
```

## 做一个资源依赖等级

建议分 4 级：

```txt
Level 1：完整组件资源
直接用本地组件 factory 生成，效果最好

Level 2：有组件样本
从 Sketch 样本推断尺寸、颜色、结构

Level 3：只有 tokens
用通用组件 factory + token 生成

Level 4：什么都没有
用默认 AntD fallback 生成
```

这样不会因为缺一个组件就卡死。

## Agent 调用时先查资源

```txt
用户：生成订单列表页
↓
查当前项目 designKit
↓
有没有 AdminListPage 模板？
↓
有没有 SearchForm / Table / Button / Tag？
↓
有：走本地资源
没有：走 fallback factory
↓
生成后校验
```

## 你本地资产库就是产品核心

可以这么理解：

```txt
大模型负责理解需求
本地组件资源负责专业度
布局引擎负责稳定性
校验器负责兜底
```

所以依赖本地组件资源不是缺点，反而是你的护城河。

## 最合理结论

是的，会依赖本地 AntD 组件资源。

但你要做成：

```txt
强依赖 DesignKit
弱依赖 AntD
强依赖规则
弱依赖死 schema
```

你的第一版可以只支持：

```txt
antd-admin
```

但架构上保留：

```txt
custom-design-kit
element-plus
naive-ui
```

这样后面就不会被 AntD 绑死。

---

# 本地组件库已落地能力

前面讨论的是 Agent 生成页面时为什么要依赖 DesignKit、组件资源、模板和布局规则。现在产品侧已经有了第一版本地组件库能力，它的定位要更明确：

```txt
用户侧：
  管理从画布沉淀出来的组件资产
  支持复用、插入、编辑、归类和删除

Agent 侧：
  读取本地组件库摘要
  根据组件库名称、组件名称、描述和节点特征做检索
  在生成页面时优先使用已有组件资产约束风格
```

所以本地组件库不是 Sketch 导入后的自动组件列表，而是用户主动沉淀的项目级组件资产。

## 1. 当前产品交互

组件模块现在分三层：

```txt
组件
  ├─ 本地组件库入口
  │   ├─ 组件库列表
  │   └─ 组件库详情 / 组件列表
  ├─ 基础组件 presets
  └─ 页面预览
```

本地组件库入口展示：

```txt
组件库数量
组件数量
进入本地组件库列表
```

进入组件库列表后：

```txt
有组件库：
  展示组件库名称、描述、组件数量
  点击组件库进入组件列表
  支持修改组件库信息
  支持删除组件库

没有组件库：
  展示空状态
  提供创建组件库入口
```

组件库是组件的一级组织单位。组件必须归属到某个组件库，后续 Agent 也应该先识别组件库，再识别组件。

## 2. 组件库管理

组件库支持：

```txt
新增组件库
修改组件库
删除组件库
```

组件库信息包括：

```txt
组件库名称
组件库描述
createdAt
updatedAt
```

组件库名称用于用户识别和 Agent 检索，组件库描述用于补充这套组件资产的适用场景，例如：

```txt
AntD 后台列表组件库
医疗护理业务组件库
移动端表单组件库
```

删除组件库时，库下面的本地组件也会一起删除。这样数据关系保持简单：

```txt
component_library 1 -> n local_component
```

## 3. 从画布创建本地组件

用户可以在画布上框选一组节点，然后右击创建组件。

创建组件时必须填写或选择：

```txt
组件名称
所属组件库
组件描述
```

如果还没有组件库，可以在创建组件流程里直接创建组件库，然后把组件归到新组件库下面。

组件保存时不使用画布坐标，而是保存为组件自己的局部坐标系：

```txt
组件根节点 x = 0
组件根节点 y = 0
子节点 x / y = 相对组件左上角的位置
```

这个规则非常重要。组件资产不是画布实例，它只是可复用模板；真正插入画布时，才根据目标位置重新计算实例坐标。

现在创建组件时还做了性能约束：

```txt
不渲染组件缩略预览
不触发整份 design file 自动保存
只调用组件接口写入 SQLite
前端只做轻量状态更新
```

这能避免大画布下创建组件卡顿。

## 4. 组件卡片行为

当前本地组件卡片不再做预览渲染，避免节点较多时卡顿。

组件卡片的主要行为是：

```txt
拖拽组件：
  插入到当前画布
  插入位置使用拖拽落点坐标

点击组件：
  作为快速插入行为
  使用默认插入坐标
```

插入画布时：

```txt
读取组件内部节点
克隆出新的节点 id
根据落点坐标平移组件
保持组件内部相对位置
选中新插入的节点
```

也就是说，组件资产本身一直保持局部坐标，画布实例才拥有实际 x / y。

## 5. 组件更多操作

本地组件卡片右上角的 `...` 是更多操作入口。

当前支持：

```txt
修改图层
修改信息
删除组件
```

其中：

```txt
修改图层：
  进入组件编辑路由
  把当前组件回显到画布上
  用户可以像编辑普通画布一样编辑组件结构和样式
  保存后回写组件资产

修改信息：
  打开弹窗
  只修改组件元信息
  包括组件名称、所属组件库、组件描述

删除组件：
  删除 SQLite 中的组件记录
  前端从当前组件库列表中移除
```

这里要分清：

```txt
修改图层 = 编辑组件 schema / 节点结构
修改信息 = 编辑组件 metadata
```

这两个操作不要混在一个弹窗里。图层编辑是画布级编辑，信息编辑是表单级编辑。

## 6. 数据持久化

本地组件库和本地组件不再只存在于前端 state 或 design file JSON 里，而是落到 SQLite。

当前接口形态：

```txt
POST   /api/workspace/projects/:id/design/component-libraries
PUT    /api/workspace/projects/:id/design/component-libraries/:libraryId
DELETE /api/workspace/projects/:id/design/component-libraries/:libraryId

POST   /api/workspace/projects/:id/design/components
PUT    /api/workspace/projects/:id/design/components/:componentId
DELETE /api/workspace/projects/:id/design/components/:componentId
```

存储表可以按两个核心实体理解：

```txt
workspace_component_libraries
workspace_design_components
```

组件库保存：

```txt
id
projectId
name
description
createdAt
updatedAt
```

组件保存：

```txt
id
projectId
libraryId
name
description
sourceFileName = 本地组件集合
nodeCount
nodes
```

读取 design file 时，服务端会把 SQLite 中的组件库和本地组件 hydrate 回设计文件结构，供前端和 Agent 使用。保存整份 design file 时，也会同步本地组件数据，兼容历史数据迁移。

## 7. Sketch 导入和本地组件库的边界

Sketch 导入现在只负责生成页面和资源，不再默认生成组件。

原因是 Sketch 的顶层图层并不一定等于可复用业务组件，自动生成会带来几个问题：

```txt
组件数量不可控
组件命名不准确
组件描述缺失
Agent 难以判断真实用途
前端组件列表渲染压力大
```

所以导入 Sketch 后的正确链路是：

```txt
导入 Sketch
  ↓
还原页面
  ↓
用户在画布上框选真正有复用价值的区域
  ↓
创建本地组件
  ↓
归入组件库
  ↓
补充名称和描述
  ↓
Agent 后续可检索和复用
```

这让组件库资产从“自动切碎的图层”变成“用户确认过的设计资产”。

## 8. Agent 可读取的组件库上下文

组件库不能只是前端管理模块，还要进入 Agent 的工具上下文。

当前 Agent 上下文可以拿到本地组件库摘要：

```ts
localComponentLibraries: [
  {
    id: "component-library_xxx",
    name: "AntD 后台组件库",
    description: "用于后台管理系统的列表、表单、详情组件。",
    componentCount: 8,
    components: [
      {
        id: "component_xxx",
        name: "查询表单",
        description: "适合列表页顶部筛选区。",
        nodeCount: 24,
        nodeTypes: ["container", "text", "rect"],
        keyTexts: ["订单编号", "订单状态", "查询", "重置"]
      }
    ]
  }
]
```

这样用户说：

```txt
用本地 AntD 组件库生成订单列表页
```

Agent 应该先做资源检索：

```txt
1. 识别目标组件库：AntD / 后台组件库 / 医疗业务组件库
2. 检索组件：查询表单、表格区、操作栏、状态标签、分页
3. 根据组件名称、描述、keyTexts 判断组件用途
4. 生成 UI DSL 或页面计划
5. 调用组件库能力，把组件资产插入或组合成画布 schema
```

组件库信息越完整，Agent 越不需要自由发挥。尤其是组件描述和 keyTexts，会直接影响 Agent 是否能选中正确组件。

## 9. 和 DesignKit 抽象的关系

当前本地组件还是资产组件：

```txt
用户从画布创建出来
保存一份节点 schema
用于拖拽复用和编辑
Agent 先把它当作可检索素材
```

后续要升级成 DesignKit 组件时，可以逐步补：

```txt
propsSchema
variants
tokens
layoutRules
schemaFactory
适用场景 tags
```

升级路径：

```txt
死 schema 组件
  ↓
识别可变字段
  ↓
绑定 token
  ↓
补 propsSchema
  ↓
抽出 schemaFactory
  ↓
进入 DesignKit 注册表
```

第一版不要急着把所有本地组件都变成 schemaFactory。先让用户能稳定沉淀组件、管理组件库、让 Agent 能读取摘要，后面再做参数化和工厂化。

## 10. 当前闭环

当前已经形成的闭环是：

```txt
导入 Sketch / 手动画布设计
  ↓
画布选区
  ↓
右击创建组件
  ↓
选择 / 创建组件库
  ↓
组件以局部坐标保存到 SQLite
  ↓
组件库列表可新增、编辑、删除
  ↓
组件卡片可拖拽插入、修改图层、修改信息、删除
  ↓
服务端读取组件库摘要
  ↓
Agent 在生成页面时获得本地组件库上下文
```

核心原则：

> 用户管理的是本地组件资产，Agent 使用的是组件库能力；两者共享同一套 SQLite 数据，但交互目标不同。

## 11. Agent 组件库工具闭环

本地组件库已经不是纯 UI 面板能力，Agent 也要能直接调用组件库工具：

```txt
component_library.list
component_library.create
component.search
component.insert
component.create_from_nodes
```

这里要分清两个动作：

```txt
创建组件库：component_library.create
把节点保存成组件：component.create_from_nodes
```

用户只说“创建组件库 / 新建本地组件库”时，只调用：

```txt
component_library.create({
  name,
  description
})
```

不要强行读取页面 schema，也不要强行创建组件。

只有用户说“把选区/当前区域/这些节点保存成组件、沉淀组件模板”时，才进入：

```txt
page.get_schema
component_library.create（没有库时）
component.create_from_nodes
```

推荐使用方式：

```txt
1. 生成 UI 前：component_library.list / component.search
2. 有匹配组件：component.insert，避免重新自由生成近似 schema
3. 没有匹配组件：schema.generate_ui_from_requirements 生成高质量区块
4. 生成后发现高质量可复用区块：component.create_from_nodes 沉淀为本地组件
5. 没有合适组件库：component_library.create 自动创建组件库
```

`component.create_from_nodes` 要把组件内部坐标归零，并同步处理 `clipBounds / clipPath`，否则后续插入和移动时裁剪区域会错位。

Agent 生成 UI 稿时的质量策略：

```txt
优先复用用户确认过的本地组件
其次使用 DesignKit / Layout Compiler
最后才允许通用 schema 生成
```

组件摘要要提供给模型：

```txt
组件库名称
组件库描述
组件名称
组件描述
节点类型
关键文本 keyTexts
组件尺寸
布局用途提示 layoutHints
```

这样模型才能判断“查询区组件适合搜索表单”“表格组件适合列表页主区域”，而不是只按名字猜。
