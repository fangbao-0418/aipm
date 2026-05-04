有，这个 schema 片段已经能看出你之前飞线/错位的核心原因了：**你不能只用 `shapeGroup.frame` 去缩放所有 `shapePath.points`，还必须把每个 `shapePath.frame.x/y/width/height` 纳入计算。** 你这份数据里每个 `shapePath` 都有自己的 frame，例如第一个路径 `x=0,y=4.964,width=7.007,height=4.964`，第二个路径 `x=7.007,y=0,width=6.992,height=9.928`，点是相对于各自 `shapePath.frame` 的归一化坐标，不是相对于整个 `shapeGroup.frame`。

正确规则：

```text
shapeGroup.frame → SVG 外层定位和 viewBox
shapePath.frame  → 当前 path 在 shapeGroup 内的位置和尺寸
shapePath.points → 当前 path 内部的 0~1 坐标
```

所以点坐标应该这样算：

```ts
x = shapePath.frame.x + point.x * shapePath.frame.width
y = shapePath.frame.y + point.y * shapePath.frame.height
```

而不是：

```ts
x = point.x * shapeGroup.frame.width
y = point.y * shapeGroup.frame.height
```

你的这类数据可以参考这个解析方式：

```ts
function parsePoint(raw: string) {
  const nums = raw.match(/-?\d+(\.\d+)?/g)?.map(Number) || [0, 0];
  return { x: nums[0] ?? 0, y: nums[1] ?? 0 };
}

function pointToGroupSvgPoint(pointRaw: string, pathFrame: any) {
  const p = parsePoint(pointRaw);

  return {
    x: pathFrame.x + p.x * pathFrame.width,
    y: pathFrame.y + p.y * pathFrame.height,
  };
}

function shapePathToD(pathLayer: any) {
  const frame = pathLayer.frame;
  const points = pathLayer.points || [];
  if (!points.length) return "";

  const first = pointToGroupSvgPoint(points[0].point, frame);
  let d = `M ${first.x} ${first.y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    const end = pointToGroupSvgPoint(curr.point, frame);

    const c1 = prev.hasCurveFrom
      ? pointToGroupSvgPoint(prev.curveFrom, frame)
      : null;

    const c2 = curr.hasCurveTo
      ? pointToGroupSvgPoint(curr.curveTo, frame)
      : null;

    if (c1 && c2) {
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
    } else {
      d += ` L ${end.x} ${end.y}`;
    }
  }

  if (pathLayer.isClosed !== false) d += " Z";

  return d;
}
```

你这份数据里所有点的 `hasCurveFrom/hasCurveTo` 都是 `false`，所以虽然有 `curveFrom/curveTo` 字段，也应该按直线 `L` 处理，不要强行走贝塞尔曲线。

`shapeGroup` 渲染应该这样：

```tsx
function RenderShapeGroup({ group }: any) {
  const frame = group.frame;
  const fill = parseFill(group.style?.fills);

  return (
    <svg
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        overflow: "visible",
      }}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
    >
      {(group.layers || [])
        .filter((l: any) => l._class === "shapePath")
        .map((p: any) => (
          <path
            key={p.do_objectID}
            d={shapePathToD(p)}
            fill={fill}
            fillRule={group.style?.windingRule === 1 ? "evenodd" : "nonzero"}
          />
        ))}
    </svg>
  );
}
```

这份数据的 `shapePath.style.fills` 都是空，真正填充色在 `shapeGroup.style.fills[0]`，颜色是黑色，所以样式要从父级 `shapeGroup.style` 继承。

一句话：你之前的问题主要不是 boolean，而是**坐标参考系错了**：`points` 要乘自己的 `shapePath.frame`，再加 `shapePath.frame.x/y`，最后放在 `shapeGroup` 的 SVG viewBox 里。
