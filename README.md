# superGame

現実世界をブラウザ上で探索する3Dオープンワールド・プロトタイプです。

Minecraftのコード・名称・画像・音声・テクスチャは使用せず、CesiumJSと公開地理データを基盤に独自実装しています。

## 現在の機能

- 地球上の任意地点へ地名または緯度・経度で移動
- 実在地形と3D建物のストリーミング表示
- 一人称の徒歩移動、走行、ジャンプ
- 車モードの加速、後退、操舵、制動
- OpenStreetMapの実在線路を取得する電車モード
- 最終地点のローカル保存
- PC・モバイル幅に対応したHUD

## 操作

| 操作 | キー |
| --- | --- |
| 移動・加減速 | `W` `A` `S` `D` または矢印キー |
| 走る・高速走行 | `Shift` |
| ジャンプ・ブレーキ | `Space` |
| 視点 | マウス |
| 徒歩・車・電車 | `1` `2` `3` |
| マウス操作解除 | `Esc` |

## 起動

Node.js 22を推奨します。

```bash
npm install
cp .env.example .env
npm run dev
```

`VITE_CESIUM_ION_TOKEN` は任意です。未設定でもOpenStreetMap画像と楕円体地形で起動します。設定するとCesium World TerrainとCesium OSM Buildingsが有効になります。

```env
VITE_CESIUM_ION_TOKEN=your_token_here
```

テスト:

```bash
npm test
```

本番ビルド:

```bash
npm run build
npm run preview
```

## 構成

```text
src/
├─ main.js          # 最小のエントリーポイント
├─ app.js           # アプリケーションのユースケース調整
├─ world.js         # Cesium Viewer・地形・建物・画像
├─ controller.js    # 徒歩・車・電車の状態遷移
├─ input.js         # キーボード・マウス入力
├─ rail.js          # OpenStreetMap線路の取得と接続
├─ geocoder.js      # 地名・座標検索
├─ geo.js           # 汎用地理計算
├─ persistence.js   # 位置のローカル保存
├─ ui.js            # DOM操作
└─ style.css        # UIスタイル
```

## データと外部サービス

- CesiumJS
- Cesium World Terrain / Cesium OSM Buildings（ionトークン設定時）
- OpenStreetMapタイル
- Photon geocoding
- Overpass API

各サービスの利用規約、レート制限、帰属表示に従ってください。公開運用では共有APIへの過剰アクセスを避け、キャッシュまたは自前バックエンドの導入が必要です。

## 現在の制約

- 車は現実地形上を自由走行する初期実装で、道路ネットワークへの拘束は未実装です。
- 電車は周辺線路を形状接続して走行する段階で、信号・駅停車・ダイヤ・分岐選択は未実装です。
- 建物内部、交通、人物、天候、時間同期、ボクセル編集は未実装です。

## 長期方針

1. 道路グラフと経路探索を追加し、車を実在道路へ拘束する
2. 駅・路線・分岐・ダイヤを含む鉄道シミュレーションへ拡張する
3. 近距離の地形・建物を編集可能なボクセルへ変換する
4. 天候、昼夜、交通、NPC、室内、永続世界を段階的に追加する
5. 大規模データはサーバー側で前処理・キャッシュし、クライアントへストリーミングする
