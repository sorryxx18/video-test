# Video Skill — Remotion Weather & News Videos

TTS + Pexels video clips + Remotion renderer. Generates portrait-format MP4s with animated subtitles.

## Quick Start

### Prerequisites

| Tool | Install |
|------|---------|
| Python 3.10+ | [python.org](https://www.python.org/downloads/) |
| Bun | `curl -fsSL https://bun.sh/install \| bash` (Mac/Linux) or [bun.sh](https://bun.sh) (Windows) |
| FFmpeg | `brew install ffmpeg` (Mac) / `choco install ffmpeg` (Windows) / `apt install ffmpeg` (Linux) |

### One-line setup

**Mac / Linux**
```bash
git clone https://github.com/sorryxx18/video-test.git && cd video-test && pip install edge-tts requests && bun install
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/sorryxx18/video-test.git; cd video-test; pip install edge-tts requests; bun install
```

### Set your API key

```bash
# Mac / Linux
export PEXELS_API_KEY=your_key_here

# Windows
set PEXELS_API_KEY=your_key_here
```

Get a free key at [pexels.com/api](https://www.pexels.com/api/).

## Make a video

```bash
# Mac / Linux
PEXELS_API_KEY=your_key python3 render_taipei_weather_0622.py

# Windows
python render_taipei_weather_0622.py
```

Output: `~/Downloads/taipei-weather-0622.mp4`

## Create a new weather video

Copy the latest template and update `SEGMENTS` and `OUTPUT`:

```bash
cp render_taipei_weather_0622.py render_taipei_weather_0623.py
```

Each segment is `("中文旁白", "pexels english search query")`.

## Anti-repeat system

`pexels_utils.py` tracks used Pexels video IDs in `used_video_ids.json`. Each run automatically skips previously used clips — no duplicate backgrounds across daily videos.

## If output > 50 MB (Telegram limit)

```bash
ffmpeg -y -i input.mp4 -vcodec libx264 -crf 28 -preset fast -vf scale=720:-2 -acodec aac -b:a 96k output-compressed.mp4
```
