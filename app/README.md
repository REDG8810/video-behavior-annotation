# Video Behavior Annotation Desk

会議実験動画を再生しながら、参加者の行動をPoint / Stateイベントとして記録するローカル完結型のElectronアプリです。

## 起動

```bash
npm install
npm run dev
```

## 配布ビルド

Apple Silicon Mac向けのDMG / ZIPを作成します。

```bash
npm run dist:mac
```

Windows向けNSISインストーラー / Portable EXEを作成します。Windows環境で実行してください。

```bash
npm run dist:win
```

GitHub Actionsの`Build Desktop Apps`を手動実行すると、macOS arm64とWindows x64の成果物をArtifactsから取得できます。

## 対応動画

- HEVC / H.265 `.MOV`
- H.264 `.MP4`

動画はElectron内で読み込まれ、サーバーにはアップロードされません。Electron内でHEVCを再生できない場合は、FFmpegで一時的にH.264へ変換します。元動画のパスとイベントの時間軸は保持されます。

## 保存

- `JSON保存`でプロジェクト情報、Condition、イベント、動画パスを保存します。
- `プロジェクトを開く`でJSONを復元します。
- 動画パスが存在しない場合は、動画を再選択して再リンクします。
- `CSV保存`はUTF-8 BOM付きで出力され、Excelで日本語を開ける形式です。
- `CSV読み込み`で保存済みCSVからイベント進捗を復元できます。

## 検証

```bash
npm test
npm run check
npm run build
```

## 主な操作

- タグボタンでイベントを入力
- Stateタグは1回目で開始、2回目で終了
- タイムラインのイベントをドラッグして時刻を修正
- 選択イベントは右側のインスペクターで属性を変更
- `Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z`でUndo / Redo
