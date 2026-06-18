"""
line_sender.py — 推送影片到 LINE
Usage: python line_sender.py --video output.mp4 --url https://... --preview https://...
Env:   LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID
"""

import argparse
import json
import os
import subprocess
import sys
import requests


def extract_thumbnail(video_path: str, thumb_path: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vframes", "1", "-q:v", "2", thumb_path],
        check=True, capture_output=True,
    )


def push_line_video(video_url: str, preview_url: str) -> None:
    token = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
    user_id = os.environ["LINE_USER_ID"]

    resp = requests.post(
        "https://api.line.me/v2/bot/message/push",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "to": user_id,
            "messages": [{
                "type": "video",
                "originalContentUrl": video_url,
                "previewImageUrl": preview_url,
            }],
        },
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"LINE error: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)
    print("✅ LINE 發送成功")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-url", required=True, help="影片公開 URL")
    parser.add_argument("--preview-url", required=True, help="縮圖公開 URL")
    args = parser.parse_args()

    push_line_video(args.video_url, args.preview_url)
