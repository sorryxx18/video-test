"""
render.py — Python caller for Remotion video render pipeline
Usage: python render.py "腳本文字" [output.mp4]
Env:   PEXELS_API_KEY, PEXELS_QUERY (optional, default: nature landscape)
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

REMOTION_DIR = Path(__file__).parent
TMP = Path("/tmp/video-skill")
TMP.mkdir(exist_ok=True)


async def generate_tts(script: str) -> tuple[str, float]:
    """Generate TTS audio with edge-tts, return (path, duration_seconds)."""
    import edge_tts

    audio_path = str(TMP / "tts_audio.mp3")
    communicate = edge_tts.Communicate(script, voice="zh-TW-HsiaoChenNeural")
    await communicate.save(audio_path)

    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", audio_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    duration = float(json.loads(result.stdout)["format"]["duration"])
    return audio_path, duration


def download_pexels_video(query: str) -> str:
    """Download a portrait video from Pexels, return local path."""
    import requests

    api_key = os.environ["PEXELS_API_KEY"]
    bg_path = str(TMP / "bg_video.mp4")

    resp = requests.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "per_page": 5, "orientation": "portrait"},
        headers={"Authorization": api_key},
        timeout=15,
    ).json()

    # Pick highest-resolution file
    files = resp["videos"][0]["video_files"]
    best = max(files, key=lambda f: f.get("width", 0))
    video_url = best["link"]

    r = requests.get(video_url, stream=True, timeout=60)
    with open(bg_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

    return bg_path


def render_video(
    script: str,
    audio_src: str,
    bg_video_src: str,
    duration: float,
    output: str,
) -> None:
    props = {
        "script": script,
        "audioSrc": audio_src,
        "bgVideoSrc": bg_video_src,
        "durationInSeconds": round(duration + 0.5, 2),  # 留 0.5s 結尾緩衝
    }
    subprocess.run(
        [
            "npx", "remotion", "render",
            "src/index.ts",
            "VideoSkill",
            output,
            "--props", json.dumps(props),
        ],
        check=True,
        cwd=REMOTION_DIR,
    )


async def main(script: str, output: str) -> str:
    query = os.environ.get("PEXELS_QUERY", "nature landscape")

    print("① 生成 TTS 音檔...")
    audio_path, duration = await generate_tts(script)
    print(f"   音檔: {audio_path}，時長: {duration:.1f}s")

    print("② 下載 Pexels 背景影片...")
    bg_path = download_pexels_video(query)
    print(f"   影片: {bg_path}")

    print("③ Remotion 渲染中...")
    render_video(script, audio_path, bg_path, duration, output)
    print(f"✓ 完成：{output}")
    return output


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：python render.py '腳本文字' [output.mp4]")
        sys.exit(1)

    script_text = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else str(TMP / "output.mp4")
    asyncio.run(main(script_text, out_path))
