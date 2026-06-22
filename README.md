# 每日天氣影片自動生成工具

中文 TTS 語音 + Pexels 真實影片背景 + Remotion 渲染，自動生成直式 MP4，內含動態字幕。

## 安裝

**Mac**
```bash
# 1. 安裝前置工具（一行）
brew install python3 bun ffmpeg

# 2. Clone 並安裝套件（一行）
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip3 install edge-tts requests && bun install
```

**Windows（PowerShell 系統管理員）**
```powershell
# 1. 安裝前置工具（一行）
winget install Python.Python.3 Bun.Bun Gyan.FFmpeg

# 2. Clone 並安裝套件（一行，開新終端機再執行）
git clone https://github.com/sorryxx18/video-test.git; cd video-test; pip install edge-tts requests; bun install
```

**Linux**
```bash
# 1. 安裝前置工具
sudo apt install python3 python3-pip ffmpeg -y && curl -fsSL https://bun.sh/install | bash

# 2. Clone 並安裝套件
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip3 install edge-tts requests && bun install
```

## 設定 API Key

免費申請：[pexels.com/api](https://www.pexels.com/api/)

```bash
# Mac / Linux（加到 ~/.zshrc 或 ~/.bashrc 永久生效）
export PEXELS_API_KEY=你的key

# Windows
set PEXELS_API_KEY=你的key
```

## 生成影片

```bash
# Mac / Linux
PEXELS_API_KEY=你的key python3 render_taipei_weather_0622.py

# Windows
python render_taipei_weather_0622.py
```

輸出位置：`~/Downloads/taipei-weather-0622.mp4`

## 製作新一天的天氣影片

```bash
cp render_taipei_weather_0622.py render_taipei_weather_0623.py
```

用編輯器開啟，修改 `SEGMENTS`（旁白 + 搜尋關鍵字）和 `OUTPUT`（輸出檔名）即可。

每個 segment 格式：`("中文旁白內容", "pexels 英文搜尋關鍵字")`

## 防重複機制

`pexels_utils.py` 把每次用過的 Pexels 影片 ID 記錄在 `used_video_ids.json`，下次執行自動跳過，天天做都不會撞到同一支影片。

## 影片超過 50MB（Telegram 上限）壓縮

```bash
ffmpeg -y -i input.mp4 -vcodec libx264 -crf 28 -preset fast -vf scale=720:-2 -acodec aac -b:a 96k output-compressed.mp4
```
