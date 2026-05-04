对，你这个判断更准确：**主要是层级/父子坐标关系有问题**，不是单纯样式问题。

从图看最明显的是：

```text
标题选框覆盖到很大区域
内容整体被包在错误父级里
部分元素位置相对父级错了
弹窗/气泡组件的子元素层级没有跟随父容器
```

你要重点查这几个：

## 1. child 坐标被当成全局坐标了

Sketch 里：

```text
child.frame.x / y 是相对 parent 的
```

如果你渲染时又按全局定位，就会偏。

正确：

```ts
function renderLayer(layer, parentAbsX = 0, parentAbsY = 0) {
  const absX = parentAbsX + layer.frame.x;
  const absY = parentAbsY + layer.frame.y;
}
```

但如果 DOM 用父级 `position: relative`，子级就不要再累加父级：

```tsx
// 父级 relative
<div style={{ position: "absolute", left: parent.x, top: parent.y }}>
  <div style={{ position: "absolute", left: child.x, top: child.y }} />
</div>
```

二选一，不要混用。

---

## 2. group/frame 没作为父容器渲染

正确层级应该是：

```text
Artboard
 ├ Group
 │   ├ Text
 │   ├ Shape
 │   └ Button
```

如果你把所有节点拍平成 artboard 直接渲染：

```text
Artboard
 ├ Text
 ├ Shape
 ├ Button
```

就会导致：

```text
组合组件散开
气泡箭头不跟随
按钮不在卡片内
```

---

## 3. children 顺序可能反了

Sketch 图层顺序和 Web `z-index` 顺序经常需要验证。

你可以试：

```ts
const children = [...layer.layers].reverse();
```

如果遮挡关系变正常，说明顺序反了。

规则建议：

```text
先按 Sketch 原始顺序测试
如果整体遮挡反了，再统一 reverse
不要局部乱反
```

---

## 4. shapeGroup / shapePath 层级处理错

正确：

```text
shapeGroup 是一个整体节点
shapePath 是它内部路径
```

不要把 shapePath 提升到和 shapeGroup 同级。

错误：

```text
Artboard
 ├ shapeGroup
 ├ shapePath
 ├ shapePath
```

正确：

```text
Artboard
 ├ Vector(shapeGroup)
     ├ path(shapePath)
```

---

## 5. SymbolInstance 不能直接展开到页面根部

如果是 Symbol：

```text
symbolInstance
 └ symbolMaster children
```

展开时必须保留 symbolInstance 的外层坐标：

```text
symbolInstance frame
  ↓
内部 children 按 master 坐标渲染
```

不要把 master children 直接塞到页面根节点。

---

## 你现在先做一个检查

打印树：

```ts
function printTree(layer, depth = 0) {
  console.log(
    " ".repeat(depth * 2),
    layer._class,
    layer.name,
    layer.frame
  );

  (layer.layers || []).forEach(child => printTree(child, depth + 1));
}
```

再对比你的渲染树：

```text
如果 Sketch 树是嵌套的
但你的 schema 是平铺的
那就是层级转换错
```

## 最推荐的修复策略

先不要优化样式，先保证层级规则统一：

```text
1. artboard / group / symbolInstance 都必须成为容器
2. child 坐标只相对 parent
3. 不要 flatten
4. shapePath 不成为独立 DOM 节点
5. z-index 顺序统一处理
```