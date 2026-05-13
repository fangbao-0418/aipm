你现在的问题，本质上不是：

```txt
模型不够强
```

而是：

# 你让 LLM 在直接生成“最终 Sketch Schema”。

这是根本错误。

LLM 最不擅长的事情就是：

```txt
精确布局
复杂约束
长链一致性
全局对齐
细节稳定
```

所以：

```txt
AI → 最终 Sketch Schema
```

一定会：

* 越改越乱
* patch 崩
* 对齐漂移
* hierarchy 混乱
* spacing 不稳定
* 改一个地方全局炸

这是必然。

---

# 一、真正方案（直接给结论）

你必须改成：

# AI 不生成 Sketch Schema

而生成：

# “Layout Intent Tree”

然后：

# 你自己编译成 Sketch Schema。

---

# 二、正确架构（真正能落地）

```txt
用户需求
 ↓
Intent Agent
 ↓
Layout Tree（语义结构）
 ↓
Layout Engine（自动布局）
 ↓
Component Compiler
 ↓
Sketch Scene Graph
 ↓
导出 Sketch Schema
```

---

# 三、核心原则（非常重要）

---

# AI 决定：

```txt
结构
层级
信息组织
组件关系
```

---

# Engine 决定：

```txt
x/y
width/height
gap
padding
alignment
```

---

# Renderer 决定：

```txt
Rectangle
Text
ShapePath
```

---

# 四、你现在为什么一直失败

因为：

你现在其实是：

```txt
AI 同时做：

1. 信息架构
2. 布局
3. spacing
4. hierarchy
5. primitive
6. 坐标
7. 尺寸
8. 对齐
```

LLM 不可能稳定。

---

# 五、真正可行方案（核心）

---

# 第一步：

# 定义 Layout DSL（最重要）

不要再让 AI 输出：

```json
{
  "_class":"rectangle",
  "x":123
}
```

---

让 AI 输出：

```json
{
  "type":"Page",

  "layout":"vertical",

  "children":[
    {
      "type":"Toolbar"
    },

    {
      "type":"FilterBar"
    },

    {
      "type":"List"
    }
  ]
}
```

---

# 六、第二步：

# 写 Layout Engine

你真正缺的是：

# AutoLayout。

不是 AI。

---

# 你至少实现：

---

## vertical stack

---

## horizontal stack

---

## grid

---

## fill/hug

---

## padding/gap

---

# 七、例如：

```json
{
  "type":"Stack",

  "direction":"vertical",

  "gap":"md",

  "padding":"lg"
}
```

---

Layout Engine：

自动算：

```txt
child.y
child.width
child.height
```

---

# 八、第三步：

# Design Token System

这是 UI 高级感核心。

---

例如：

```ts
spacing = {
  xs:4,
  sm:8,
  md:16,
  lg:24
}
```

---

AI：

只能：

```json
{
  "gap":"md"
}
```

不能：

```json
{
  "gap":17
}
```

---

# 九、第四步：

# Component Compiler

例如：

---

# AI 输出：

```json
{
  "type":"Button",

  "label":"保存",

  "variant":"primary"
}
```

---

# Compiler：

自动：

```txt
Group
 ├── Rectangle
 └── Text
```

---

并自动：

* padding
* radius
* color
* alignment

---

# 十、第五步：

# Sketch Renderer

最终：

```txt
Button
 ↓
Sketch Group
 ↓
Rectangle/Text
```

---

# 十一、真正关键：

# Sketch Schema 是“输出格式”

不是：

# AI 输入格式。

---

# 十二、你真正应该做的工具

不要：

```txt
createRectangle
setX
```

---

而是：

```txt
createStack
appendChild
setLayout
setVariant
```

---

# 十三、真正应该有的节点（足够了）

---

# Layout

```txt
Page
Stack
Grid
Split
Section
```

---

# Surface

```txt
Card
Panel
Sheet
```

---

# Content

```txt
Title
Text
MetaList
Image
```

---

# Action

```txt
Button
Tabs
Toolbar
SearchBar
```

---

# 十四、最关键：

# AI 只做“结构”

不要做：

```txt
具体视觉
```

---

# 十五、真正的 UI 质量：

# 来自 Compiler。

不是：

# 来自 Prompt。

---

# 十六、你现在真正要补的是：

---

# 1. Layout Engine

---

# 2. Token System

---

# 3. Component Compiler

---

# 4. Constraint System

---

# 5. Patch System

---

# 十七、Patch System（很重要）

不要：

```txt
重新生成整个页面
```

---

而是：

```json
{
  "target":"toolbar",

  "patch":[
    {
      "path":"layout.gap",
      "value":"sm"
    }
  ]
}
```

---

# 十八、真正成熟的 AI UI：

不是：

# generation

而是：

# iterative refinement。

---

# 十九、真正推荐你：

# 立刻这么做（现实路线）

---

# P0（马上）

## 1. Layout DSL

## 2. AutoLayout

## 3. Token

## 4. Compiler

---

# P1

## 5. Patch Editing

## 6. Critic Agent

---

# P2

## 7. Semantic Inference

## 8. Sketch Import

---

# 二十、最后一句（真正核心）

你现在的问题不是：

# “AI 不会生成 UI”

而是：

# “你让 AI 直接生成了最终渲染层”。




Figma AI、Sketch、Motiff、Stitch 这类产品，虽然对外看起来像：

```txt
一句话 → UI稿
```

但内部基本都不是：

```txt
LLM → 最终图层 JSON
```

真正架构更接近：

# AI → Design Intent → Layout System → Scene Graph → Renderer

它们真正强的不是模型，而是：

# “设计运行时（Design Runtime）”。

你现在卡住，就是因为你缺的是这层。

---

# 一、先说行业真相（非常重要）

现在所有高级 AI UI 产品：

都已经发现：

# “LLM 不能直接生成最终设计稿”

所以：

它们都在做：

# 中间抽象层。

---

# 二、Figma AI 真正架构（大概率）

Figma AI 不可能：

```txt
LLM
 ↓
直接生成：
Rectangle/Text
```

因为：

Figma 内部不是 JSON 编辑器。

而是：

# Scene Graph + AutoLayout Engine。

---

它真正更像：

```txt
Prompt
 ↓
Intent Parser
 ↓
UI Plan
 ↓
AutoLayout Tree
 ↓
Component System
 ↓
Scene Graph
 ↓
Canvas Renderer
```

---

# 三、Figma 最大的核心其实是：

# AutoLayout

不是 AI。

---

为什么 Figma UI 看起来稳定：

因为：

# Layout 不是 AI 算的。

---

而是：

```txt
padding
gap
hug
fill
constraints
```

引擎算的。

---

# 四、Figma AI 真正强的地方

其实是：

# AI 操作已有 Design Runtime。

不是：

# AI 自己画图。

---

# 五、你现在和 Figma 最大差距

你：

```txt
AI
 ↓
最终 Sketch Schema
```

---

Figma：

```txt
AI
 ↓
Figma Node Tree
 ↓
AutoLayout Engine
 ↓
Renderer
```

---

# 六、Sketch 新 AI（Sketch Assist）

也不是：

# “自由生成图层”。

它本质：

# 是在操作 Sketch 的文档模型。

---

例如：

Sketch 内部：

```txt
Artboard
Group
Shape
Text
Symbol
StackLayout
```

---

AI：

只是：

# 改变结构树。

---

# 七、Sketch 最大特点

和 Figma 不同：

# Sketch 更 Component/Layer Driven。

---

但：

它同样：

# 不会让 AI 直接写 primitive 坐标。

---

# 八、真正行业共同点（非常关键）

---

# 1. Scene Graph

都有：

```txt
Node Tree
```

---

# 2. Layout System

都有：

```txt
AutoLayout / Constraint
```

---

# 3. Component System

都有：

```txt
Button
Card
Toolbar
```

---

# 4. Token System

都有：

```txt
spacing
typography
radius
```

---

# 5. Patch Editing

都不是：

```txt
重生成整个页面
```

---

# 九、真正高级系统：

# AI 只做“意图”

---

例如：

用户：

```txt
做一个订单管理页
```

---

AI 真正输出：

不是：

```txt
Rectangle
```

---

而是：

```txt
这是：
- data dense
- table-first
- admin page
- needs filter
- needs bulk actions
```

---

然后：

# Design Runtime 接管。

---

# 十、Motiff / MasterGo AI（国内）

更明显。

它们：

# 已经开始做：

```txt
AI + Scene Graph
```

---

不是：

```txt
AI + Canvas
```

---

# 十一、真正高级 AI UI：

# 都有 Layout Grammar

例如：

---

# Page Pattern

```txt
dashboard
table_filter
master_detail
```

---

# Component Grammar

```txt
card
toolbar
tabs
table
```

---

# Layout Grammar

```txt
stack
grid
split
```

---

# 十二、Stitch（Google）

官方已经透露很多了：

它支持：

* 文字 → UI
* 图片 → UI
* 多方案
* theme
* export

但关键是：

# 它是 AI-native Canvas。

---

意味着：

不是：

```txt
LLM → HTML
```

---

而是：

# 有自己的中间运行时。

---

# 十三、为什么他们 UI 稳定

因为：

# AI 不负责：

* 对齐
* gap
* padding
* hierarchy

---

这些：

# 全是 Runtime 做的。

---

# 十四、真正行业核心：

# Constraint System

---

例如：

```txt
hug
fill
min/max
```

---

这东西：

# 比模型重要得多。

---

# 十五、真正成熟系统：

# 都是“编译式”

不是：

# “生成式”。

---

例如：

---

# AI：

```txt
生成结构树
```

---

# Compiler：

```txt
生成 Scene Graph
```

---

# Layout Engine：

```txt
计算 frame
```

---

# Renderer：

```txt
生成 UI
```

---

# 十六、你现在真正该学的

不是：

# Prompt Engineering

而是：

---

# Flutter Layout

---

# Yoga/Flexbox

---

# Scene Graph

---

# AutoLayout

---

# Figma Node Model

---

# 十七、你真正应该模仿的不是：

# HTML/CSS

而是：

# Flutter/Figma Runtime。

---

因为：

HTML：

```txt
太自由
```

---

AI：

很难稳定。

---

# 十八、真正推荐你的最终架构

---

# Layer1：Semantic DSL

```txt
Card
List
Toolbar
```

---

# Layer2：Layout Tree

```txt
stack
grid
padding
gap
```

---

# Layer3：Scene Graph

```txt
Group
Rectangle
Text
```

---

# Layer4：Renderer

```txt
Canvas/WebGL
```

---

# 十九、真正核心认知（非常关键）

Figma AI 不是：

# “AI 画图”

而是：

# “AI 操作设计引擎”。

---

# 二十、最后一句（真正答案）

你现在真正应该做的：

不是：

# “优化 schema prompt”

而是：

# “建立自己的 Design Runtime”。
