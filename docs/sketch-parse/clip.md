对，你理解已经接近 Sketch/Figma 的核心渲染机制了。

# 核心规则

在 Sketch 里：

```text
某个 layer 开启 hasClippingMask=true
```

它会变成：

```text
后续兄弟图层的裁剪区域
```

直到：

* group 结束
* mask chain 被中断
* 或新的 mask 出现

---

# 结构示例

例如：

```text
Group
 ├── Rectangle (hasClippingMask=true)
 ├── Image
 ├── Text
 └── Shape
```

结果：

```text
Image/Text/Shape
都会被 Rectangle 裁剪
```

---

# 重要：只影响“后面的兄弟”

不是：

```text
父级所有 children
```

而是：

```text
mask 后面的 sibling
```

所以：

---

## 正确

```text
1. Mask
2. Image
3. Text
```

Text 会被裁剪。

---

## 错误顺序

```text
1. Image
2. Text
3. Mask
```

Mask 不会影响前面的层。

因为：

Sketch 渲染是：

```text
从上到下（layer order）
```

---

# 它像什么？

非常像：

```svg
<clipPath>
```

或者：

```canvas
ctx.clip()
```

---

# 不是 DOM 树式 mask

很多前端开发会误解成：

```html
<div class="mask">
  children...
</div>
```

但 Sketch 不是这样。

它是：

```text
绘制流（render pipeline）
```

---

# 是适用于所有 class 吗？

答案：

## 理论上：

✅ 几乎所有可渲染 layer 都会受影响

包括：

| Layer Type     | 是否会被裁剪 |
| -------------- | ------ |
| bitmap/image   | ✅      |
| text           | ✅      |
| shapePath      | ✅      |
| rectangle      | ✅      |
| oval           | ✅      |
| symbolInstance | ✅      |
| group          | ✅      |

---

# 但谁可以“作为 mask”？

不是所有 layer 都适合当 mask。

通常：

| Layer       | 能否作为 mask   |
| ----------- | ----------- |
| ShapePath   | ✅           |
| Rectangle   | ✅           |
| Oval        | ✅           |
| Vector Path | ✅           |
| Text        | 某些情况下可以     |
| Bitmap      | 一般不用于 mask  |
| Group       | 通常不是直接 mask |

---

# 最常见的是：

```text
ShapePath / Rectangle / Oval
```

---

# Sketch 内部更准确的理解

实际上：

```text
mask layer
```

会生成：

```text
alpha mask / vector clip region
```

后续 layer：

```text
只在这个区域内可见
```

---

# 一个特别重要的点

Sketch 的：

```text
Mask Chain
```

是连续的。

---

# 举例

```text
Group
 ├── Mask A
 ├── Image
 ├── Text
 ├── Mask B
 ├── Shape
```

这里：

---

## Mask A

影响：

```text
Image
Text
```

---

## Mask B

开始新的 mask chain：

影响：

```text
Shape
```

---

# 所以你解析 AST 时

不能只看：

```json
hasClippingMask
```

你必须：

## 建立：

```text
render stack
```

或者：

```text
mask scope
```

---

# 你现在做 Sketch → React 最容易错的点

很多解析器：

```text
直接递归 children
```

然后：

```tsx
<div>{children}</div>
```

这是错的。

因为：

Sketch 是：

```text
绘制流模型
```

不是：

```text
DOM layout 模型
```

---

# 正确应该：

你需要：

---

## 第一阶段

解析：

```text
Layer Order
Mask Chain
ZIndex
Blend
```

---

## 第二阶段

构建：

```text
Visual Render Tree
```

---

## 第三阶段

再推理：

```text
真实 UI 语义
```

例如：

---

# 示例

Sketch：

```text
Rectangle(mask)
Image
```

AI 应推理：

```tsx
<Avatar />
```

而不是：

```tsx
<div style="clip-path">
```

---

# 再强调一个关键点

mask：

## 是“视觉约束”

不是：

## “布局约束”

它不会影响：

* flex
* auto layout
* intrinsic size

它只影响：

```text
最终像素显示区域
```

---

# 最后一句总结

`hasClippingMask: true`

本质是：

> 当前 layer 成为一个“渲染裁剪节点”，后续 sibling layers 的可见区域会被它限制。

它：

✅ 基本影响所有可渲染 layer
✅ 强依赖 layer 顺序
✅ 属于 render pipeline
❌ 不是普通 DOM 父子裁剪关系



`clipBounds`

在 Sketch 里本质表示：

> 当前容器的“裁剪边界（Clipping Bounds）”。

可以理解成：

```text
这个容器允许子内容显示的可见区域
```

它和你前面问的：

```text
hasClippingMask
```

非常容易混淆。

但它们不是一回事。

---

# 一、最核心区别

| 能力          | hasClippingMask | clipBounds       |
| ----------- | --------------- | ---------------- |
| 类型          | 矢量 Mask         | 容器裁剪             |
| 裁剪形状        | 任意路径            | 通常矩形             |
| 作用对象        | 后续 sibling      | children/subtree |
| 类似          | SVG clipPath    | overflow:hidden  |
| 依赖 layer 顺序 | 强依赖             | 不依赖              |
| 本质          | Render Pipeline | Container Bounds |

---

# 二、clipBounds 更像什么

它更接近：

```css
overflow: hidden;
```

---

# 举例

例如：

```text
Group (300x300)
 ├── 大图片（1000x1000）
```

如果：

```text
clipBounds = true
```

那么：

```text
超出 group 区域的内容不可见
```

---

# 三、它和 hasClippingMask 的本质差别

---

# hasClippingMask

是：

```text
矢量裁剪
```

例如：

```text
圆形
星形
贝塞尔路径
```

---

# clipBounds

是：

```text
容器边界裁剪
```

通常：

```text
矩形区域
```

---

# 四、为什么 Sketch 需要 clipBounds

因为：

Sketch 本质：

```text
无限画布
```

如果没有 clip：

很多 layer：

```text
会溢出 artboard/group
```

所以：

需要：

```text
clipBounds
```

控制：

```text
是否裁剪子内容
```

---

# 五、最常见场景

---

## 1. Scroll 容器

非常常见。

例如：

```text
一个 300px 高列表
内部内容 3000px
```

如果：

```text
clipBounds=true
```

才会像：

```css
overflow: auto;
```

---

## 2. 卡片内容裁切

例如：

```text
Card
 ├── Image
```

图片超出：

```text
border-radius
```

时。

---

## 3. Artboard

很多 artboard 默认：

```text
clip content
```

否则：

所有元素会溢出画板。

---

# 六、在 Sketch AST 里的表现

有时：

```json
{
  "hasClippingMask": false,
  "clippingMaskMode": 0
}
```

有时：

```json
{
  "clipBounds": true
}
```

不同版本字段不完全一致。

Sketch 历史兼容非常复杂。

---

# 七、和 Group 的关系

很多时候：

```text
Group + clipBounds=true
```

就相当于：

```css
overflow:hidden
```

---

# 八、它影响的是 children subtree

这一点和：

```text
hasClippingMask
```

完全不同。

---

# hasClippingMask

影响：

```text
后续 sibling
```

---

# clipBounds

影响：

```text
整个子树 children
```

---

# 九、渲染模型区别（很重要）

---

# hasClippingMask

属于：

```text
Render Stack
```

类似：

```canvas
ctx.clip()
```

---

# clipBounds

属于：

```text
Container Layout Bounds
```

类似：

```css
overflow:hidden
```

---

# 十、AI 转 React 时如何处理

---

## clipBounds=true

通常优先推理：

```css
overflow:hidden
```

或者：

```tsx
<Card />
<ScrollArea />
<List />
```

---

## hasClippingMask=true

通常：

```svg
clipPath
```

或者：

```tsx
<Avatar />
```

---

# 十一、你做 Sketch → Antd 时的重要判断

你现在真正需要的是：

---

# 判断：

这是：

```text
视觉 Mask
```

还是：

```text
布局裁切
```

---

# 示例

---

## 情况1

```text
Rectangle
clipBounds=true
```

大概率：

```tsx
<Card />
```

---

## 情况2

```text
Oval
hasClippingMask=true
Image
```

大概率：

```tsx
<Avatar />
```

---

## 情况3

```text
Scroll View
clipBounds=true
内容超长
```

应该推理：

```tsx
<div overflow:auto />
```

---

# 十二、工程实现建议（非常重要）

你不要直接：

```ts
clipBounds => overflow:hidden
```

应该抽象：

```ts
interface ClipBehavior {
  type:
    | "container-clip"
    | "scroll-clip"
    | "visual-mask"
}
```

然后：

AI 再做：

```text
语义恢复
```

---

# 十三、为什么你现在布局会乱

因为：

Sketch：

```text
视觉渲染树
```

而 React：

```text
布局树
```

---

# Sketch 的 clipBounds

很多时候：

只是：

```text
视觉裁切
```

不代表：

```text
真实布局结构
```

所以：

不能：

```text
看到 clip 就套 div overflow hidden
```

否则：

布局层级会炸。

---

# 十四、真正推荐的解析顺序

你现在最正确路线：

---

# 第一阶段

解析：

```text
Render Tree
```

包括：

* mask
* clip
* blend
* opacity
* zIndex

---

# 第二阶段

恢复：

```text
Visual Regions
```

---

# 第三阶段

恢复：

```text
Layout Structure
```

---

# 第四阶段

恢复：

```text
Semantic Components
```

---

# 最后一句总结

`clipBounds`

本质是：

> 容器级的“显示边界裁切”。

它更接近：

```css
overflow:hidden
```

而：

```text
hasClippingMask
```

更接近：

```svg
clipPath
```

两者：

* 作用范围
* 渲染机制
* AST 语义

完全不同。
