"""
render_taipei_weather_0620.py — 2026-06-20 臺北天氣報告（風趣幽默版）
Usage: python render_taipei_weather_0620.py
Env:   PEXELS_API_KEY
"""

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path

import edge_tts
import requests

REMOTION_DIR = Path(__file__).parent
TMP = Path("/tmp/video-taipei-weather-0620")
TMP.mkdir(exist_ok=True)

VOICE = "zh-TW-HsiaoChenNeural"
CATEGORY = "☀️ 天氣快報"
OUTPUT = Path.home() / "Downloads" / "taipei-weather-0620.mp4"

SEGMENTS = [
    (
        "各位台北市民，今天最高溫36度。不下雨、不涼快、就是熱。太平洋高壓把水氣全堵住，接下來五天：晴、熱、悶、曬，高溫直衝36度！",
        "taipei hot sunny summer city skyline heat wave",
    ),
    (
        "今天松山區，白天最高36度，晚上還有29度！風速1到3級，基本上你感受到的都是熱風。出門三寶：帽子、防曬、水，缺一不可。",
        "summer heat urban street sun blazing hot city",
    ),
    (
        "今天跟明天降雨機率低到幾乎可以忽略。那把傘？可以先放家裡。不過台北的天氣說變就變，帶上也不吃虧就是了。",
        "sunny day blue sky no rain summer weather",
    ),
    (
        "龍舟錦標賽好消息！本週六日天氣穩定、風浪配合，老天爺完全支持划船。但岸上觀眾要小心——36度在大太陽下，你可能比選手先陣亡。",
        "dragon boat race river festival taiwan water sport",
    ),
    (
        "颱風米克拉目前在關島西邊，距離台灣2170公里，正以時速34公里向西移動。23日前可能升級中颱，25到26號外圍雲系影響，溫度才稍微降到32度。現在先別慌，持續觀察。",
        "typhoon tropical storm satellite clouds weather system",
    ),
    (
        "總結：今天到24號，防曬補水不能停。25、26號，記得追颱風動態。台灣天氣就是這樣——熱到你懷疑人生，然後颱風突然來敲門。大家出入平安！",
        "taiwan city summer sunset skyline evening",
    ),
]


async def generate_segment_tts(text: str, path: str) -> float:
    communicate = edge_tts.Communicate(text, voice=VOICE)
    await communicate.save(path)
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def download_pexels_video(query: str, path: str) -> None:
    api_key = os.environ["PEXELS_API_KEY"]
    resp = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "per_page": 5, "orientation": "portrait"},
        headers={"Authorization": api_key},
        timeout=15,
    ).json()
    files = resp["videos"][0]["video_files"]
    best = max(files, key=lambda f: f.get("width", 0))
    r = requests.get(best["link"], stream=True, timeout=60)
    with open(path, "wb") as fh:
        for chunk in r.iter_content(chunk_size=8192):
            fh.write(chunk)


def concat_audio(audio_paths: list, output_path: str) -> None:
    list_file = str(TMP / "concat_list.txt")
    with open(list_file, "w") as fh:
        for p in audio_paths:
            fh.write(f"file '{p}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_path],
        check=True, capture_output=True,
    )


async def main() -> None:
    print(f"📝 {len(SEGMENTS)} 個段落，開始生成...\n")

    audio_paths = []
    bg_names = []
    subtitles = []
    current_time = 0.0

    public_dir = REMOTION_DIR / "public"
    public_dir.mkdir(exist_ok=True)

    for i, (text, query) in enumerate(SEGMENTS):
        print(f"[{i+1}/{len(SEGMENTS)}] TTS: {text[:28]}...")
        audio_path = str(TMP / f"seg_{i:02d}.mp3")
        duration = await generate_segment_tts(text, audio_path)
        audio_paths.append(audio_path)

        subtitles.append({
            "startSec": round(current_time, 3),
            "endSec": round(current_time + duration, 3),
            "text": text,
        })
        current_time += duration

        print(f"          Pexels [{query[:32]}]...")
        bg_tmp = str(TMP / f"bg_{i:02d}.mp4")
        download_pexels_video(query, bg_tmp)
        bg_name = f"bg{i:02d}.mp4"
        shutil.copy(bg_tmp, public_dir / bg_name)
        bg_names.append(bg_name)
        print(f"          ✓ {duration:.1f}s  累計: {current_time:.1f}s\n")

    print("🔗 合併音軌...")
    full_audio = str(TMP / "tts_full.mp3")
    concat_audio(audio_paths, full_audio)
    shutil.copy(full_audio, public_dir / "tts_weather_0620.mp3")

    props = {
        "subtitles": subtitles,
        "audioSrc": "tts_weather_0620.mp3",
        "bgVideoSrcs": bg_names,
        "durationInSeconds": round(current_time + 0.5, 2),
        "category": CATEGORY,
    }

    print(f"🎬 Remotion 渲染中... (總時長 {current_time:.1f}s)")
    subprocess.run(
        ["bunx", "remotion", "render", "VideoSkill", str(OUTPUT),
         "--props", json.dumps(props), "--concurrency", "4"],
        check=True, cwd=str(REMOTION_DIR),
    )
    print(f"\n✅ 完成：{OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
