`shapePath` 要分两部分解析：

```text
shapePath.points → 生成 SVG path d
shapePath.style / 父级 shapeGroup.style → 生成 SVG 样式
```

很多 Sketch 文件里，**真正样式不在 shapePath 上，而在父级 shapeGroup 上**，这是重点。

---

## 1. 基本结构

通常是这样：

```json
{
  "_class": "shapeGroup",
  "style": {
    "fills": [],
    "borders": [],
    "shadows": []
  },
  "layers": [
    {
      "_class": "shapePath",
      "points": []
    }
  ]
}
```

所以解析时要：

```ts
const style = shapePath.style || parentShapeGroup.style;
```

---

## 2. shapePath → SVG 样式映射

| Sketch                      | SVG                          |
| --------------------------- | ---------------------------- |
| `style.fills[]`             | `fill`                       |
| `style.borders[]`           | `stroke`                     |
| `border.thickness`          | `strokeWidth`                |
| `borderOptions.dashPattern` | `strokeDasharray`            |
| `shadows[]`                 | `filter` 或 CSS `drop-shadow` |
| `contextSettings.opacity`   | `opacity`                    |
| `blendMode`                 | `mixBlendMode`               |

---

## 3. 样式解析代码

```ts
function parseShapePathStyle(layer: any, parent?: any) {
  const style = layer.style || parent?.style || {};

  return {
    fill: parseFill(style.fills),
    stroke: parseStroke(style.borders, style.borderOptions),
    opacity: style.contextSettings?.opacity ?? 1,
    filter: parseShadowFilter(style.shadows),
  };
}
```

---

## 4. 解析 fill

```ts
function parseFill(fills: any[] = []) {
  const fill = fills.find((item) => item.isEnabled !== false);

  if (!fill) return "none";

  // solid color
  if (fill.fillType === 0) {
    return parseSketchColor(fill.color);
  }

  // 渐变先降级，后面用 <defs><linearGradient />
  if (fill.fillType === 1) {
    return parseSketchColor(fill.gradient?.stops?.[0]?.color) || "none";
  }

  // 图片填充 shapePath 不建议直接做，先降级
  if (fill.fillType === 4) {
    return "none";
  }

  return "none";
}
```

---

## 5. 解析 stroke

```ts
function parseStroke(borders: any[] = [], borderOptions: any = {}) {
  const border = borders.find((item) => item.isEnabled !== false);

  if (!border) {
    return {
      color: "none",
      width: 0,
    };
  }

  return {
    color: parseSketchColor(border.color),
    width: border.thickness ?? 1,
    dashArray: borderOptions.dashPattern?.join(" "),
    lineCap: mapLineCap(borderOptions.lineCapStyle),
    lineJoin: mapLineJoin(borderOptions.lineJoinStyle),
  };
}

function mapLineCap(value?: number) {
  switch (value) {
    case 0:
      return "butt";
    case 1:
      return "round";
    case 2:
      return "square";
    default:
      return undefined;
  }
}

function mapLineJoin(value?: number) {
  switch (value) {
    case 0:
      return "miter";
    case 1:
      return "round";
    case 2:
      return "bevel";
    default:
      return undefined;
  }
}
```

---

## 6. 解析颜色

```ts
function parseSketchColor(color: any) {
  if (!color) return undefined;

  const r = Math.round((color.red ?? 0) * 255);
  const g = Math.round((color.green ?? 0) * 255);
  const b = Math.round((color.blue ?? 0) * 255);
  const a = color.alpha ?? 1;

  return a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${a})`;
}
```

---

## 7. 渲染 SVG

```tsx
function RenderVector({ node }: any) {
  return (
    <svg
      style={{
        position: "absolute",
        left: node.layout.x,
        top: node.layout.y,
        width: node.layout.width,
        height: node.layout.height,
        opacity: node.style.opacity,
      }}
      viewBox={`0 0 ${node.layout.width} ${node.layout.height}`}
    >
      <path
        d={node.svg.d}
        fill={node.style.fill}
        stroke={node.style.stroke.color}
        strokeWidth={node.style.stroke.width}
        strokeDasharray={node.style.stroke.dashArray}
        strokeLinecap={node.style.stroke.lineCap}
        strokeLinejoin={node.style.stroke.lineJoin}
      />
    </svg>
  );
}
```

---

## 8. 完整转换形态

```ts
function convertShapePath(layer: any, parent: any) {
  const style = parseShapePathStyle(layer, parent);

  return {
    id: layer.do_objectID,
    type: "Vector",
    name: layer.name,
    layout: {
      x: parent.frame?.x ?? layer.frame?.x ?? 0,
      y: parent.frame?.y ?? layer.frame?.y ?? 0,
      width: parent.frame?.width ?? layer.frame?.width ?? 0,
      height: parent.frame?.height ?? layer.frame?.height ?? 0,
    },
    svg: {
      d: buildSvgPath(layer.points, {
        width: parent.frame?.width ?? layer.frame?.width ?? 0,
        height: parent.frame?.height ?? layer.frame?.height ?? 0,
      }),
    },
    style,
  };
}
```

---

## 重点记住

```text
shapePath 负责形状路径
shapeGroup 通常负责样式
```

所以你解析样式时，不要只看：

```ts
shapePath.style
```

还要看：

```ts
shapeGroup.style
```

否则 icon 很容易变成：

```text
路径有了，但没有颜色 / 没有描边 / 不显示
```
