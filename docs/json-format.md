# dot-plate-pro JSON Format

`dot-plate-pro` の `.json` ファイルは、ドット絵からドットプレート / STL を生成するための **プロジェクト保存形式** です。

STL の直接的なジオメトリデータではなく、エディタ上の状態、ピクセルデータ、レイヤ設定、寸法パラメータを保存し、あとから同じ状態を復元するために使います。

## Format Version

現在の保存処理では、`version` は `"1.4"` として出力されます。

```json
{
  "version": "1.4"
}
```

## Top-level Structure

```json
{
  "version": "1.4",
  "projectName": "sample",
  "outputFileName": "sample",
  "author": "",
  "createdAt": "2026/04/26 00:00:00",
  "originalFilePath": "source.png",
  "gridSize": 32,
  "dotSize": 1.0,
  "layerThickness": 1.0,
  "baseThickness": 0.0,
  "padSensitivity": 1,
  "layerOrder": [
    "[255,0,0]",
    "[0,0,255]"
  ],
  "layerHeightAdjustments": {
    "[255,0,0]": {
      "plus": 0,
      "minus": 0
    }
  },
  "layerSmoothingSettings": {
    "[255,0,0]": {
      "smoothOuter": false,
      "smoothInner": false,
      "tolerance": 0.1,
      "offset": 0
    }
  },
  "pixels": [
    [
      [255, 0, 255],
      [255, 0, 0]
    ],
    [
      [255, 0, 255],
      [0, 0, 255]
    ]
  ],
  "sourceImage": "data:image/png;base64,..."
}
```

## Fields

| Field | Type | Required | Description |
|---|---:|---:|---|
| `version` | string | yes | JSON フォーマットのバージョン。現行保存処理では `"1.4"`。 |
| `projectName` | string | yes | プロジェクト名。保存 JSON のファイル名にも使われる。 |
| `outputFileName` | string | yes | STL や画像などの出力ファイル名のベース。 |
| `author` | string | yes | 作者名。空文字の場合あり。 |
| `createdAt` | string | yes | 作成日時の表示用文字列。例: `YYYY/MM/DD HH:mm:ss`。 |
| `originalFilePath` | string | yes | 元画像ファイル名。新規キャンバスでは空文字。 |
| `gridSize` | number | yes | 画像読み込み・新規作成時の基準グリッドサイズ。通常は横方向の解像度として扱われる。 |
| `dotSize` | number | yes | 1 ドットの物理サイズ。単位は mm 想定。 |
| `layerThickness` | number | yes | 各色レイヤの基本厚み。単位は mm 想定。 |
| `baseThickness` | number | yes | ベース部分の厚み。単位は mm 想定。 |
| `padSensitivity` | number | yes | 操作用の感度設定。 |
| `layerOrder` | string[] | yes | 色レイヤの積層順。色は RGB 配列を JSON 文字列化したキーで表現する。 |
| `layerHeightAdjustments` | object | yes | 色ごとの高さ補正。キーは色キー。 |
| `layerSmoothingSettings` | object | yes | 色ごとのスムージング設定。キーは色キー。 |
| `pixels` | number[][][] | yes | ピクセル配列。`pixels[y][x] = [r, g, b]`。 |
| `sourceImage` | string \| null | yes | 元画像の Data URL。新規キャンバスでは `null` の場合あり。 |

## Color Representation

色は RGB 配列で表現します。

```json
[255, 0, 0]
```

各値は `0` から `255` の整数です。

### Transparent Color

透明色は固定で次の RGB 値です。

```json
[255, 0, 255]
```

これはマゼンタを透明扱いするためのセンチネル値です。

実装上はこの配列を `JSON.stringify()` した文字列が透明判定キーとして使われます。

```json
"[255,0,255]"
```

## Pixel Matrix

`pixels` は 2 次元配列です。

```json
"pixels": [
  [
    [255, 0, 255],
    [255, 0, 0]
  ],
  [
    [0, 0, 255],
    [255, 0, 255]
  ]
]
```

読み方は以下です。

```txt
pixels[y][x] = [r, g, b]
```

- 外側の配列: 行、つまり Y 方向
- 内側の配列: 列、つまり X 方向
- 各セル: RGB 配列

画像アップロード時は、元画像のアスペクト比に応じて高さが決まるため、`gridSize` と `pixels.length` が常に同じとは限りません。

`gridSize` は主に横方向の基準解像度として扱われ、実際の高さは `pixels.length` を見る必要があります。

## Layer Color Key

レイヤ設定のキーには、RGB 配列を JSON 文字列化した値を使います。

例:

```json
"[255,0,0]"
```

これは実際の色配列ではなく、文字列キーです。

```json
{
  "[255,0,0]": {
    "plus": 0,
    "minus": 0
  }
}
```

## layerOrder

`layerOrder` は色レイヤの順番を表します。

```json
"layerOrder": [
  "[255,0,0]",
  "[0,0,255]",
  "[255,255,255]"
]
```

透明色 `[255,0,255]` はレイヤ対象から除外されます。

## layerHeightAdjustments

色ごとの高さ補正を表します。

```json
"layerHeightAdjustments": {
  "[255,0,0]": {
    "plus": 0.2,
    "minus": 0
  }
}
```

### Fields

| Field | Type | Description |
|---|---:|---|
| `plus` | number | 基本レイヤ厚みに対する追加高さ。 |
| `minus` | number | 基本レイヤ厚みからの減算高さ。 |

古い形式では、色キーの値が単純な数値だった可能性があります。読み込み後の操作処理では、数値の場合に `{ plus: value, minus: 0 }` 相当へ正規化する処理があります。

## layerSmoothingSettings

色ごとのスムージング設定を表します。

```json
"layerSmoothingSettings": {
  "[255,0,0]": {
    "smoothOuter": true,
    "smoothInner": false,
    "tolerance": 0.1,
    "offset": 0
  }
}
```

### Fields

| Field | Type | Description |
|---|---:|---|
| `smoothOuter` | boolean | 外周輪郭をスムージングするか。 |
| `smoothInner` | boolean | 内側輪郭をスムージングするか。 |
| `tolerance` | number | 輪郭簡略化・スムージングの許容量。mm 想定。 |
| `offset` | number | 輪郭のオフセット量。mm 想定。正負値を取り得る。 |

## sourceImage

`sourceImage` はアップロード元画像を Data URL として保存します。

```json
"sourceImage": "data:image/png;base64,iVBORw0KGgo..."
```

新規キャンバスの場合は `null` になることがあります。

このフィールドはファイルサイズが大きくなる原因になりますが、元画像表示や再サンプリングに使われます。

## Minimal Example

```json
{
  "version": "1.4",
  "projectName": "minimal",
  "outputFileName": "minimal",
  "author": "",
  "createdAt": "2026/04/26 00:00:00",
  "originalFilePath": "",
  "gridSize": 2,
  "dotSize": 1,
  "layerThickness": 1,
  "baseThickness": 0,
  "padSensitivity": 1,
  "layerOrder": [
    "[255,0,0]"
  ],
  "layerHeightAdjustments": {},
  "layerSmoothingSettings": {},
  "pixels": [
    [
      [255, 0, 255],
      [255, 0, 0]
    ],
    [
      [255, 0, 0],
      [255, 0, 255]
    ]
  ],
  "sourceImage": null
}
```

## Validation Rules

読み込み可能な JSON として最低限必要なのは `pixels` です。

実装上、ロード処理は `d.pixels` が存在する場合にプロジェクトとして復元します。

推奨バリデーションは以下です。

- `pixels` は空でない 2 次元配列であること
- 各セルは `[r, g, b]` の 3 要素配列であること
- `r`, `g`, `b` は `0`〜`255` の整数であること
- 各行の長さが揃っていること
- `layerOrder` の各値は `pixels` 内に存在する非透明色キーであることが望ましい
- `layerHeightAdjustments` / `layerSmoothingSettings` のキーは色キー形式であること
- `dotSize`, `layerThickness`, `baseThickness` は 0 以上の数値であることが望ましい

## Notes

- 透明はアルファ値ではなく、固定 RGB `[255,0,255]` で表現する。
- レイヤ設定のキーは RGB 配列ではなく、RGB 配列を文字列化した値。
- STL 形状そのものは JSON に保存されない。
- JSON から STL を再生成するには、`pixels` と寸法・レイヤ設定を読み込み、アプリ側の STL 生成処理を再実行する必要がある。
