"""从 MyCard 前排接口拉取前 100 名卡组，写成站点快照 JSON。

定时任务每天 06:00（Asia/Shanghai）运行本脚本，只更新 data/mc-leaderboard.json。
无对应裁定页的系列不在这里丢弃，过滤由前端按 data/mc-series-pages.json 完成。
"""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 源站分页排行接口。page=1..10 对应前 100 名。
LEADERBOARD_URL = "https://ygo.xyk.one/mc/api/leaderboard?page={page}"
PAGE_COUNT = 10
# Cloudflare 会拦无 UA 的请求，这里模拟普通浏览器。
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
TIMEOUT_SECONDS = 30
SHANGHAI = timezone(timedelta(hours=8))

# 仓库根目录，以及快照输出路径。
REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "data" / "mc-leaderboard.json"


def fetch_page(page: int) -> dict:
    """拉取一页排行数据。失败时带页码抛出，方便 Actions 日志定位。"""
    url = LEADERBOARD_URL.format(page=page)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context()) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"leaderboard page {page} HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"leaderboard page {page} network error: {error.reason}") from error

    if not isinstance(payload, dict) or not isinstance(payload.get("players"), list):
        raise RuntimeError(f"leaderboard page {page} 返回格式无效")
    return payload


def extract_deck_code(link: str) -> str:
    """从 ourygo 链接里取出 d= 卡组码，供本站折叠预览解码。"""
    if not link:
        return ""
    query = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
    values = query.get("d") or []
    return values[0] if values else ""


def slim_player(player: dict) -> dict | None:
    """去掉 trend 等大字段，只保留卡组页渲染需要的信息。"""
    if not isinstance(player, dict):
        return None

    deck = player.get("deck") or {}
    if not isinstance(deck, dict):
        deck = {}

    categories = []
    for category in deck.get("categories") or []:
        if isinstance(category, dict) and category.get("label"):
            categories.append(str(category["label"]))

    links = [str(link) for link in (deck.get("links") or []) if link]
    primary_link = links[0] if links else ""
    # 主系列取源站分类数组的最后一项，与前排页主标签一致。
    main_category = categories[-1] if categories else ""

    return {
        "rank": player.get("rank"),
        "player": player.get("player") or "",
        "score": player.get("score"),
        "month_games": player.get("month_games"),
        "month_win_rate": player.get("month_win_rate"),
        "deck": {
            "name": deck.get("name") or "",
            "main_category": main_category,
            "categories": categories,
            "code": extract_deck_code(primary_link),
            "link": primary_link,
        },
    }


def build_snapshot() -> dict:
    """顺序拉取 10 页并合并成一份快照。"""
    players = []
    updated_at = None

    for page in range(1, PAGE_COUNT + 1):
        payload = fetch_page(page)
        updated_at = payload.get("updated_at", updated_at)
        for player in payload["players"]:
            slim = slim_player(player)
            if slim:
                players.append(slim)

    return {
        "source": "https://ygo.xyk.one/mc",
        "updated_at": updated_at,
        "synced_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
        "total": len(players),
        "players": players,
    }


def main() -> int:
    snapshot = build_snapshot()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT_PATH} ({snapshot['total']} players, synced_at={snapshot['synced_at']})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"sync failed: {error}", file=sys.stderr)
        raise SystemExit(1)
