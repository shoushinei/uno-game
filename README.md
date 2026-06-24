# 🃏 UNO オンライン

リアルタイムマルチプレイヤー UNO ゲーム（Firebase Realtime Database 使用）

## ファイル構成

```
uno-game/
│
├── index.html              # エントリーポイント（HTML構造のみ）
│
├── css/
│   ├── base.css            # リセット・共通スタイル（ボタン・input・タグなど）
│   ├── lobby.css           # ホーム画面・ロビー画面のスタイル
│   ├── game.css            # ゲーム画面（カード・フィールド・リアクション）
│   └── result.css          # リザルト画面のスタイル
│
└── js/
    ├── firebase-config.js  # Firebase 初期化・設定（⚠️ .gitignore 推奨）
    ├── db.js               # Firebase DB ヘルパー（get / set / update / listen）
    ├── game-logic.js       # UNO ゲームロジック（純粋関数・副作用なし）
    ├── state.js            # アプリ状態管理（myId / roomId など）
    ├── ui.js               # UI 描画関数（renderGame / renderLobby など）
    └── app.js              # メインコントローラー（イベント・Firebase 操作）
```

## 各ファイルの役割

| ファイル | 役割 |
|---|---|
| `firebase-config.js` | Firebase の接続情報。APIキーを管理する唯一の場所。 |
| `db.js` | Firebase の読み書きを薄くラップ。`fbGet / fbSet / fbUpdate / fbListen` を提供。 |
| `game-logic.js` | UNO のルール実装。DOM・Firebase に一切依存しないため、単体テストが容易。 |
| `state.js` | `myId` `myName` `roomId` など、セッション中に保持すべき状態をまとめた場所。 |
| `ui.js` | DOM を直接操作する描画関数。状態変更は行わない。 |
| `app.js` | ユーザー操作 → Firebase → UI の橋渡し。`window.xxx` に関数を公開。 |

## 実装済み機能

- ✅ Firebase Realtime Database によるリアルタイム同期
- ✅ 2〜5人マルチプレイヤー
- ✅ ロビー・準備完了システム
- ✅ スキップ / リバース / +2 / ワイルド / ワイルド+4
- ✅ ドロー累積（+2/+4 スタック）
- ✅ UNO 宣言（忘れると2枚ペナルティ）
- ✅ 順位システム（複数人が順番にゴール）
- ✅ リアクション機能（クールダウン + 自分のリアクションが画面中央にポップアップ）
- ✅ ゲームログ表示

## ローカルでの起動

ES Modules を使用しているため、ローカルサーバーが必要です。

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .
```

ブラウザで `http://localhost:8080` を開いてください。

## .gitignore への追加推奨

Firebase の APIキーは `firebase-config.js` に含まれています。  
公開リポジトリにプッシュする場合は、環境変数や `.env` に切り出すことを検討してください。

```gitignore
# Firebase設定（任意）
js/firebase-config.js
```
