# 每日天氣影片自動生成工具

中文 TTS 語音 + Pexels 真實影片背景 + Remotion 渲染，自動生成直式 MP4，內含動態字幕。

## 快速安裝

### 事先安裝

| 工具 | 安裝方式 |
|------|---------|
| Python 3.10+ | [python.org](https://www.python.org/downloads/) |
| Bun | `curl -fsSL https://bun.sh/install \| bash`（Mac/Linux）或 [bun.sh](https://bun.sh)（Windows） |
| FFmpeg | `brew install ffmpeg`（Mac）/ `choco install ffmpeg`（Windows）/ `apt install ffmpeg`（Linux） |

### 一行裝完

**Mac / Linux**
```bash
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip install edge-tts requests && bun install
```

**Windows（PowerShell）**
```powershell
git clone https://github.com/sorryxx18/video-test.git; cd video-test; pip install edge-tts requests; bun install
```

### 設定 API Key

```bash
# Mac / Linux
export PEXELS_API_KEY=你的key

# Windows
set PEXELS_API_KEY=你的key
```

免費申請：[pexels.com/api](https://www.pexels.com/api/)

## 生成影片

```bash
# Mac / Linux
PEXELS_API_KEY=你的key python3 render_taipei_weather_0622.py

# Windows
python render_taipei_weather_0622.py
```

輸出位置：`~/Downloads/taipei-weather-0622.mp4`

## 製作新一天的天氣影片

複製最新的模板，修改 `SEGMENTS` 和 `OUTPUT`：

```bash
cp render_taipei_weather_0622.py render_taipei_weather_0623.py
```

每個 segment 格式：`("中文旁白內容", "pexels 英文搜尋關鍵字")`

## 防重複機制

`pexels_utils.py` 把每次用過的 Pexels 影片 ID 記錄在 `used_video_ids.json`，下次執行自動跳過，天天做都不會撞到同一支影片。

## 影片超過 50MB（Telegram 上限）

```bash
ffmpeg -y -i input.mp4 -vcodec libx264 -crf 28 -preset fast -vf scale=720:-2 -acodec aac -b:a 96k output-compressed.mp4
```
