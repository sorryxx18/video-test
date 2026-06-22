"""
render_taipei_weather_0621.py — 2026-06-21 臺北天氣報告
Usage: python render_taipei_weather_0621.py
Env:   PEXELS_API_KEY
"""

import asyncio
import json
import os
import random
import shutil
import subprocess
from pathlib import Path

import edge_tts
import requests
from pexels_utils import download_pexels_video

REMOTION_DIR = Path(__file__).parent
TMP = Path("/tmp/video-taipei-weather-0621")
TMP.mkdir(exist_ok=True)

VOICE = "zh-TW-HsiaoChenNeural"
CATEGORY = "☀️ 天氣快報"
OUTPUT = Path.home() / "Downloads" / "taipei-weather-0621.mp4"

SEGMENTS = [
    (
        "今天台北繼續熱！太平洋高壓壓著不走，水氣全被堵在外面。今天到24號：晴、熱、悶，高溫直衝35到36度，做好心理準備。",
        "taipei city summer skyline heat haze urban",
    ),
    (
        "松山區今天白天最高36度，晚上還有29到31度。風速1到3級，陣風5級——基本上都是熱風。出門必備：帽子、防曬、水，缺一不可。",
        "hot summer street sun shade people walking city",
    ),
    (
        "今天跟明天降雨機率極低，傘可以先放家裡。但台北說變就變，備著也不吃虧。龍舟錦標賽好消息：今天天氣穩定，選手划得爽，觀眾曬得慘。",
        "dragon boat race taiwan river festival water sport",
    ),
    (
        "颱風米克拉目前在菲律賓東方海域，距離台灣大約1750公里。預計23日升級中颱，25到26號外圍雲系帶來短暫雨，氣溫降一點到33、34度。現在先觀察，別急著搶貨。",
        "typhoon satellite clouds weather storm tropical",
    ),
    (
        "總結：今天到24號，防曬補水是重點。25號開始注意颱風動態。台北的夏天就是這樣——熱到想移民，颱風又說來就來。大家出入平安，照顧好自己！",
        "taiwan sunset evening city skyline summer glow",
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
    shutil.copy(full_audio, public_dir / "tts_weather_0621.mp3")

    props = {
        "subtitles": subtitles,
        "audioSrc": "tts_weather_0621.mp3",
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
