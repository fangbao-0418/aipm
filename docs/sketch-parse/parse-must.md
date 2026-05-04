可以这么说，但要加一句关键补充：

> 👉 **类型入口是 `_class` ✅**
> 👉 **但“最终类型判断”不能只靠 `_class` ❗**

---

# 一、最直接回答你

你问：

> 类型判断是不是都依照 `_class`？

### ✔ 正确答案：

```text
80% 场景：是的（用 _class 做入口）
20% 场景：必须结合结构/上下文再判断
```

---

# 二、你应该怎么用 `_class`

正确用法是👇

## Step 1：用 `_class` 做“第一层分发”

```ts
switch (layer._class) {
  case "text":
  case "shapeGroup":
  case "shapePath":
  case "bitmap":
  case "symbolInstance":
}
```

👉 这一层是对的，必须这么做

---

## Step 2：再做“类型修正”

因为 `_class` 不等于最终类型

---

# 三、典型“不能只看 _class”的情况

---

## ① shapePath ❌

```json
{ "_class": "shapePath" }
```

👉 如果你直接当一个图形：

```text
错 ❌
```

👉 正确：

```text
它只是路径
真正图形 = shapeGroup
```

---

## ② shapeGroup ✅（但要升级）

```json
{ "_class": "shapeGroup" }
```

👉 你不能简单当 div

👉 要判断：

```text
是否包含 shapePath → Vector
是否是简单矩形 → Shape
是否有 boolean → Complex Vector
```

---

## ③ rectangle / oval ⚠️

```json
{ "_class": "rectangle" }
```

👉 你要判断：

```text
简单 → div
复杂（gradient/shadow）→ 仍然 div
但某些情况 → SVG 更准
```

---

## ④ text ⚠️

```json
{ "_class": "text" }
```

👉 还要判断：

```text
普通文本 → Text
iconfont → 实际是 icon
```

---

## ⑤ symbolInstance ❌

```json
{ "_class": "symbolInstance" }
```

👉 不能直接渲染

必须：

```text
symbolID → 找 symbolMaster
```

---

# 四、你真正应该做的是“类型推导”

---

## 推荐最终类型（你系统内部）

```ts
type NodeType =
  | "Frame"
  | "Group"
  | "Text"
  | "Image"
  | "Shape"
  | "Vector"
  | "Symbol";
```

---

## 转换逻辑👇

```ts
function resolveNodeType(layer) {
  switch (layer._class) {
    case "text":
      return isIconFont(layer) ? "Icon" : "Text";

    case "bitmap":
      return "Image";

    case "shapeGroup":
      return isVector(layer) ? "Vector" : "Shape";

    case "shapePath":
      return "Vector"; // 但通常不直接用

    case "rectangle":
    case "oval":
      return "Shape";

    case "symbolInstance":
      return "Symbol";

    case "group":
      return "Group";

    case "artboard":
      return "Frame";

    default:
      return "Group";
  }
}
```

---

# 五、关键辅助判断（你必须加）

---

## 判断是否 vector

```ts
function isVector(layer) {
  return (layer.layers || []).some(
    (l) => l._class === "shapePath"
  );
}
```

---

## 判断 iconfont

```ts
function isIconFont(layer) {
  const font =
    layer.attributedString?.attributes?.[0]?.attributes
      ?.MSAttributedStringFontAttribute?.attributes?.name || "";

  return font.toLowerCase().includes("iconfont");
}
```

---

## 判断 boolean

```ts
function hasBoolean(layer) {
  return layer.booleanOperation != null && layer.booleanOperation !== -1;
}
```

---

# 六、最终正确理解

---

## ❌ 错误方式

```text
_class = 类型
```

---

## ✅ 正确方式

```text
_class = 类型入口
+ 结构
+ 属性
+ 内容
→ 最终类型
```

---

# 七、一句话总结

> 👉 `_class` 决定“你走哪个解析函数”
> 👉 但不能决定“你最终渲染成什么”

---

# 八、给你一个工程级建议（很重要）

你现在应该做的是👇

```text
Sketch Layer
↓
resolveNodeType（类型推导）
↓
convert（渲染逻辑）
```

而不是：

```text
switch(_class) → 直接渲染 ❌
```

---

如果你下一步要继续，我可以帮你👇

👉 出一套「完整类型推导规则（100%覆盖 Sketch）」
👉 或「Sketch → 设计引擎架构（和 Figma 一样的分层）」

你现在已经进入“渲染引擎核心设计阶段”了。
