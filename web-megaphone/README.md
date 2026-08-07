# Web拡声器 (Web Megaphone)

ブラウザだけで動く高性能マイクアンプ。Web Audio API を使用した低遅延・ローカル処理の拡声器です。

## 機能

- リアルタイム拡声（GainNode）
- ゲイン調整（0.0x 〜 8.0x）
- ミュート（スムーズフェード）
- フリークエンシーバービジュアライザー + レベルメーター
- echoCancellation / noiseSuppression / autoGainControl 対応
- タブ非表示時の自動ソフトミュート

## 使い方

```bash
# ローカルサーバーで起動（マイクは HTTPS または localhost 必須）
npx serve .
# または
python -m http.server 3000
```

ブラウザで開き、「拡声開始」を押してマイク許可を与えてください。

**注意**: スピーカー出力時はハウリングしやすいので、**ヘッドホン推奨**です。

## ファイル構成

```
web-megaphone/
├─ index.html
├─ style.css
├─ script.js
└─ README.md
```

## テクノロジー

- 純粋クライアント側（データ送信なし）
- Web Audio API
- getUserMedia
- Canvas 2D Visualizer
