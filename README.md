# 主題影片自動生成工具

收到主題 → 自動生成短影片。中文 TTS 語音 + Pexels 真實影片背景 + Remotion 渲染，輸出直式 MP4，內含動態字幕。

**兩種使用方式：**
- **手動模式** — 直接執行 Python 腳本，輸出 mp4
- **LINE Bot 模式** — 手機傳主題給 bot，影片自動生成後推回

---

## 安裝

**Mac**
```bash
brew install python3 bun ffmpeg
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip3 install edge-tts requests && bun install
```

**Windows（PowerShell 系統管理員）**
```powershell
winget install Python.Python.3 Bun.Bun Gyan.FFmpeg
git clone https://github.com/sorryxx18/video-test.git; cd video-test; pip install edge-tts requests; bun install
```

**Linux**
```bash
sudo apt install python3 python3-pip ffmpeg -y && curl -fsSL https://bun.sh/install | bash
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip3 install edge-tts requests && bun install
```

---

## 手動模式

直接執行 Python 腳本生成影片：

```bash
# Mac / Linux
PEXELS_API_KEY=你的key python3 render_taipei_weather_0622.py

# Windows（先設好環境變數）
set PEXELS_API_KEY=你的key
python render_taipei_weather_0622.py
```

只需要 `PEXELS_API_KEY`（免費申請：[pexels.com/api](https://www.pexels.com/api/)），不需要其他設定。

輸出位置：`~/Downloads/` 下的 mp4。

---

## LINE Bot 模式（自動化）

手機 LINE 傳主題 → bot 自動生成影片 → 推回 LINE。

### 1. 設定環境變數

```bash
cp .env.example .env
# 用編輯器開啟 .env，填入每個欄位（說明在 .env.example 裡）
```

需要的 key：
| 變數 | 取得方式 |
|------|---------|
| `LINE_CHANNEL_SECRET` | LINE Developers → Basic settings |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Messaging API |
| `LINE_USER_ID` | 傳訊給 bot 後，webhook log 裡的 userId |
| `PEXELS_API_KEY` | pexels.com/api |
| `GITHUB_TOKEN` | github.com/settings/tokens（勾 repo） |
| `GITHUB_REPO` | 影片上傳目標，格式：username/repo |

### 2. 啟動 server

```bash
bun run start
```

### 3. 設定 LINE Webhook URL

LINE Developers → Messaging API → Webhook URL 填入你的 server 公開網址（可用 Cloudflare Tunnel 或 ngrok）。

### 使用方式

1. 手機 LINE 傳主題給 bot（如：「台北今天天氣」）
2. Bot 回傳腳本預覽，問是否確認
3. 回「確認」
4. 等幾分鐘，影片自動推回

---

## 製作新主題腳本

```bash
cp render_taipei_weather_0622.py render_my_topic.py
```

修改三個地方：
1. `SEGMENTS` — 每段旁白 + 對應 Pexels 搜尋關鍵字
2. `OUTPUT` — 輸出檔名
3. `CATEGORY` — 影片分類標籤（如 `☀️ 天氣快報`、`📰 新聞`）

segment 格式：
```python
("中文旁白 2 到 3 句，口語自然", "pexels english search keywords"),
```

---

## 防重複機制

`pexels_utils.py` 把每次用過的 Pexels 影片 ID 記錄在 `used_video_ids.json`，下次自動跳過，長期使用不會一直出現同樣背景。

---

## 影片超過 50MB 壓縮

```bash
ffmpeg -y -i input.mp4 -vcodec libx264 -crf 28 -preset fast -vf scale=720:-2 -acodec aac -b:a 96k output-compressed.mp4
```
