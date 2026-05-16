重新整理：

## 1. 图片选择 / 图片资源来自哪里

图片节点是这个：

```json
{
  "_class": "bitmap",
  "name": "图片中英翻译",
  "image": {
    "_class": "MSJSONFileReference",
    "_ref_class": "MSImageData",
    "_ref": "images/0b841d59efdc23e126149974f69d3888313d6725.png"
  }
}
```

关键字段：

```json
"image": {
  "_ref": "images/0b841d59efdc23e126149974f69d3888313d6725.png"
}
```

这个就是图片文件路径。

---

## 2. 图片旋转来自哪里

同一个 bitmap 节点里：

```json
"rotation": 15.0000008855283
```

所以图片旋转角度是：

```txt
15°
```

---

## 3. 图片透明度到底来自哪里

这个 bitmap 自己的透明度是：

```json
"style": {
  "contextSettings": {
    "blendMode": 0,
    "opacity": 1
  }
}
```

重点：

```json
"opacity": 1
```

说明：

```txt
图片节点本身没有被设置透明
```

也就是不是：

```txt
bitmap opacity = 0.5
```

---

## 4. 图片为什么看起来像透明 / 发灰

原因不是透明度，而是 bitmap 自己的颜色控制：

```json
"colorControls": {
  "isEnabled": true,
  "brightness": 0.0799999982118607,
  "contrast": 1,
  "hue": 0.41642466370159,
  "saturation": 1
}
```

关键是：

```json
"isEnabled": true
```

说明 Sketch 对这张图片启用了颜色调整。

所以结论是：

```txt
图片不是被透明层盖住；
图片自己 opacity = 1；
图片发灰/变色来自 colorControls。
```

---

最终对应关系：

| 作用      | Sketch 字段                              |
| ------- | -------------------------------------- |
| 选择哪张图片  | `bitmap.image._ref`                    |
| 图片旋转    | `bitmap.rotation`                      |
| 图片自身透明度 | `bitmap.style.contextSettings.opacity` |
| 图片发灰/变色 | `bitmap.style.colorControls`           |
