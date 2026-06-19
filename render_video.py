"""
render_video.py — 通用渲染入口
Usage: python render_video.py --script scripts/example_fire_safety.json
Env:   PEXELS_API_KEY
"""

import argparse
import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path

import edge_tts
import requests

REMOTION_DIR = Path(__file__).parent
VOICE = "zh-TW-HsiaoChenNeural"


async def generate_tts(text: str, path: str) -> tuple[float, list[dict]]:
    communicate = edge_tts.Communicate(text, voice=VOICE)
    word_timestamps: list[dict] = []
    audio_chunks: list[bytes] = []

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            word_timestamps.append({
                "word": chunk["text"],
                "startMs": chunk["offset"] / 10_000,
                "durationMs": chunk["duration"] / 10_000,
            })

    with open(path, "wb") as f:
        for c in audio_chunks:
            f.write(c)

    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
        capture_output=True, text=True, check=True,
    )
    duration = float(json.loads(result.stdout)["format"]["duration"])
    return duration, word_timestamps


def validate_output(output_path: str) -> None:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", output_path],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(result.stdout)

    duration = float(info["format"]["duration"])
    if duration < 1.0:
        raise ValueError(f"Output too short: {duration:.1f}s")

    has_video = any(s["codec_type"] == "video" for s in info.get("streams", []))
    has_audio = any(s["codec_type"] == "audio" for s in info.get("streams", []))

    if not has_video:
        raise ValueError("Output has no video stream")
    if not has_audio:
        raise ValueError("Output has no audio stream")

    print(f"✅ 驗證通過：{duration:.1f}s，有影像+音訊")


def download_pexels(query: str, path: str) -> None:
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
    list_file = str(REMOTION_DIR / "tmp_concat_list.txt")
    with open(list_file, "w") as fh:
        for p in audio_paths:
            fh.write(f"file '{p}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", output_path],
        check=True, capture_output=True,
    )
    os.remove(list_file)


async def main(script_path: str, output: str, gl: str) -> None:
    with open(script_path) as f:
        config = json.load(f)

    title = config["title"]
    category = config["category"]
    segments = config["segments"]

    tmp = REMOTION_DIR / f"tmp_{title}"
    tmp.mkdir(exist_ok=True)
    public_dir = REMOTION_DIR / "public"
    public_dir.mkdir(exist_ok=True)
    checkpoint_path = tmp / "checkpoint.json"
    checkpoint_tmp_path = tmp / "checkpoint.json.tmp"

    print(f"📝 {len(segments)} 個段落，開始生成...\n")

    audio_paths: list[str] = []
    bg_names: list[str] = []
    subtitles: list[dict] = []
    all_word_timestamps: list[list[dict]] = []
    current_time = 0.0
    segments_done: set[int] = set()

    if checkpoint_path.exists():
        with open(checkpoint_path) as f:
            checkpoint = json.load(f)
        if checkpoint.get("title") == title:
            audio_paths = checkpoint["audio_paths"]
            bg_names = checkpoint["bg_names"]
            subtitles = checkpoint["subtitles"]
            all_word_timestamps = checkpoint["word_timestamps"]
            current_time = checkpoint["current_time"]
            segments_done = set(checkpoint["segments_done"])
            print(f"♻️ Resuming from checkpoint, {len(segments_done)} segments already done")

    for i, seg in enumerate(segments):
        if i in segments_done:
            continue

        text = seg["text"]
        query = seg["query"]

        print(f"[{i+1}/{len(segments)}] TTS: {text[:30]}...")
        audio_path = str(tmp / f"seg_{i:02d}.mp3")
        duration, words = await generate_tts(text, audio_path)
        audio_paths.append(audio_path)

        subtitles.append({
            "startSec": round(current_time, 3),
            "endSec": round(current_time + duration, 3),
            "text": text,
        })
        all_word_timestamps.append(words)
        current_time += duration

        print(f"          Pexels [{query[:28]}]...")
        bg_tmp = str(tmp / f"bg_{i:02d}.mp4")
        download_pexels(query, bg_tmp)
        bg_name = f"bg{i:02d}.mp4"
        shutil.copy(bg_tmp, public_dir / bg_name)
        bg_names.append(bg_name)
        print(f"          ✓ {duration:.1f}s  累計: {current_time:.1f}s\n")

        segments_done.add(i)
        checkpoint_data = {
            "title": title,
            "segments_done": sorted(segments_done),
            "audio_paths": audio_paths,
            "bg_names": bg_names,
            "subtitles": subtitles,
            "word_timestamps": all_word_timestamps,
            "current_time": current_time,
        }
        with open(checkpoint_tmp_path, "w") as f:
            json.dump(checkpoint_data, f, ensure_ascii=False)
        os.replace(checkpoint_tmp_path, checkpoint_path)

    print("🔗 合併音軌...")
    full_audio = str(tmp / "tts_full.mp3")
    concat_audio(audio_paths, full_audio)
    shutil.copy(full_audio, public_dir / "tts.mp3")

    props = {
        "subtitles": subtitles,
        "audioSrc": "tts.mp3",
        "bgVideoSrcs": bg_names,
        "durationInSeconds": round(current_time + 0.5, 2),
        "category": category,
        "wordTimestamps": all_word_timestamps,
    }

    print(f"🎬 Remotion 渲染中... (總時長 {current_time:.1f}s)")
    subprocess.run(
        ["bunx", "remotion", "render", "VideoSkill", output,
         "--props", json.dumps(props),
         "--concurrency", "4",
         f"--gl={gl}"],
        check=True, cwd=str(REMOTION_DIR),
    )
    print(f"\n✅ 完成：{output}")
    validate_output(output)

    # 清理暫存
    checkpoint_path.unlink(missing_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    for name in bg_names:
        (public_dir / name).unlink(missing_ok=True)
    (public_dir / "tts.mp3").unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True, help="scripts/*.json 路徑")
    parser.add_argument("--output", default="output.mp4", help="輸出路徑")
    parser.add_argument("--gl", default="angle", help="Remotion GL backend (angle/swiftshader)")
    args = parser.parse_args()
    asyncio.run(main(args.script, args.output, args.gl))
