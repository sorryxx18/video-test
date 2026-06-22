"""
render_taipei_weather_0622.py — 2026-06-22 臺北天氣報告
Usage: python render_taipei_weather_0622.py
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
TMP = Path("/tmp/video-taipei-weather-0622")
TMP.mkdir(exist_ok=True)

VOICE = "zh-TW-HsiaoChenNeural"
CATEGORY = "⛈️ 天氣快報"
OUTPUT = Path.home() / "Downloads" / "taipei-weather-0622.mp4"

SEGMENTS = [
    (
        "台北今天繼續熱！22號到24號，太平洋高壓穩穩壓住，天氣晴朗炎熱，最高36度，最低26度。出門防曬補水，這幾天是重點。",
        "taipei city summer skyline heat haze urban",
    ),
    (
        "松山今天白天最高36度，傍晚還有29到31度。風速1到3級——就是熱風。帽子、防曬、水壺，三樣都要帶。",
        "hot summer street sun people walking city sidewalk",
    ),
    (
        "25號到27號變天！颱風外圍環流加上弱鋒面共伴，台北轉多雲有雨，氣溫稍降至32到34度。颱風是中度颱風米克拉，現在距台北東南方約1170公里。",
        "typhoon clouds storm weather tropical dark sky rain",
    ),
    (
        "米克拉最新動態：以每小時32公里速度向西北西移動，逐漸靠近台灣。目前海上颱風警報機率20到30%，陸上低於10%。氣象局持續監測，大家先做好準備。",
        "typhoon satellite view ocean storm clouds spiral weather",
    ),
    (
        "總結：今天到24號，防曬防暑是重點。25號起注意颱風動態，雨具備著。台北的夏天熱颱連番上陣，大家出入平安，照顧好自己！",
        "taiwan evening city skyline sunset summer warm sky",
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

        print(f"          Pexels [{query[:36]}]...")
        bg_tmp = str(TMP / f"bg_{i:02d}.mp4")
        download_pexels_video(query, bg_tmp)
        bg_name = f"bg0622_{i:02d}.mp4"
        shutil.copy(bg_tmp, public_dir / bg_name)
        bg_names.append(bg_name)
        print(f"          ✓ {duration:.1f}s  累計: {current_time:.1f}s\n")

    print("🔗 合併音軌...")
    full_audio = str(TMP / "tts_full.mp3")
    concat_audio(audio_paths, full_audio)
    shutil.copy(full_audio, public_dir / "tts_weather_0622.mp3")

    props = {
        "subtitles": subtitles,
        "audioSrc": "tts_weather_0622.mp3",
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
