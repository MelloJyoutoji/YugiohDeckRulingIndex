"""从 MyCard 前排接口拉取前 100 名卡组，写成站点快照 JSON。

定时任务每天 06:00（Asia/Shanghai）运行本脚本，更新快照及构筑变化系列的首页日期。
无对应裁定页的系列不在这里丢弃，过滤由前端按 data/mc-series-pages.json 完成。
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
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

# 仓库根目录，以及快照、系列映射和首页路径。
REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = REPO_ROOT / "data" / "mc-leaderboard.json"
MAPPING_PATH = REPO_ROOT / "data" / "mc-series-pages.json"
INDEX_PATH = REPO_ROOT / "index.html"


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


def get_deck_codes_by_page(snapshot: dict, page_mapping: dict) -> dict[str, set[str]]:
    """按前端的主系列匹配规则归集构筑码，忽略排名、积分、顺序及重复构筑。"""
    codes_by_label: dict[str, set[str]] = {}
    for entry in snapshot.get("players", []):
        deck = entry.get("deck") or {}
        label = deck.get("main_category")
        # 优先比较构筑码；没有码时以原始链接兜底，空构筑不参与比较。
        code = deck.get("code") or extract_deck_code(deck.get("link") or "") or deck.get("link")
        if label and code:
            codes_by_label.setdefault(label, set()).add(code)

    return {
        page: set().union(*(codes_by_label.get(label, set()) for label in labels))
        for page, labels in page_mapping.items()
    }


def find_changed_deck_pages(previous: dict, current: dict, page_mapping: dict) -> set[str]:
    """找出构筑新增、删除或卡组码变化的页面，包括构筑全部移出前排的情况。"""
    previous_codes = get_deck_codes_by_page(previous, page_mapping)
    current_codes = get_deck_codes_by_page(current, page_mapping)
    return {page for page in page_mapping if previous_codes[page] != current_codes[page]}


def get_page_decks(snapshot: dict, labels: list[str]) -> list[dict]:
    """只返回有可解码构筑码的记录，避免空记录覆盖页面现有构筑。"""
    decks = []
    for entry in snapshot.get("players", []):
        deck = entry.get("deck") or {}
        code = deck.get("code") or extract_deck_code(deck.get("link") or "")
        if deck.get("main_category") in labels and code:
            decks.append({**entry, "deck": {**deck, "code": code}})
    return decks


class DeckRawParser(HTMLParser):
    """定位 deck-raw 的原始字符范围，保留外围 HTML 和 DIV 属性。"""

    def __init__(self, source: str):
        super().__init__(convert_charrefs=False)
        # 行首偏移用于将 HTMLParser 的行列坐标转换成原文位置。
        self.line_offsets = [0]
        for line in source.splitlines(keepends=True):
            self.line_offsets.append(self.line_offsets[-1] + len(line))
        self.depth = 0
        self.start = self.content_start = self.content_end = None
        self.feed(source)

    def source_offset(self) -> int:
        """返回当前标签在源文中的字符位置。"""
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """按 DIV 嵌套层数定位结束标签，避免误删相邻区域。"""
        if tag != "div":
            return
        if self.depth:
            self.depth += 1
        elif self.start is None and dict(attrs).get("id") == "deck-raw":
            self.start = self.source_offset()
            self.content_start = self.start + len(self.get_starttag_text())
            self.depth = 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """自闭合元素不增加 DIV 嵌套层数。"""
        pass

    def handle_endtag(self, tag: str) -> None:
        """记录 deck-raw 自身结束标签的位置。"""
        if tag == "div" and self.depth:
            self.depth -= 1
            if self.depth == 0:
                self.content_end = self.source_offset()


def update_deck_raw(page_html: str, has_json_deck: bool) -> str:
    """有 JSON 构筑时清空 DIV；否则只保留第一份静态构筑并标记 old。"""
    parser = DeckRawParser(page_html)
    if parser.content_end is None:
        return page_html
    opening = page_html[parser.start:parser.content_start]
    raw = page_html[parser.content_start:parser.content_end]
    if has_json_deck:
        # 清空后沿用已有空容器的换行缩进，并移除不再适用的 old 属性。
        opening = re.sub(r"""\s+data-old\s*=\s*(["']).*?\1""", "", opening)
        whitespace = re.search(r"\n[ \t]*$", raw)
        content = whitespace.group(0) if whitespace else ""
    else:
        # 无 JSON 历史时，将第一份 YDK 静态构筑作为最后的回退来源。
        lines = [line.strip() for line in raw.splitlines()]
        main_positions = [i for i, line in enumerate(lines) if line == "#main"]
        if not main_positions:
            return page_html
        end = main_positions[1] if len(main_positions) > 1 else len(lines)
        first_deck = lines[main_positions[0]:end]
        if not any(line.isdigit() for line in first_deck):
            return page_html
        # 单份构筑保持原文；多份时只截去后续构筑，保留第一份的原有格式。
        content = raw
        main_matches = list(re.finditer(r"^[ \t]*#main[ \t]*$", raw, re.MULTILINE))
        if len(main_matches) > 1:
            first_raw = raw[:main_matches[1].start()].rstrip()
            first_raw = re.sub(r"\n[ \t]*#created[^\n]*$", "", first_raw).rstrip()
            line_start = page_html.rfind("\n", 0, parser.start) + 1
            indent = page_html[line_start:parser.start]
            content = first_raw + "\n" + indent
        if not re.search(r"\bdata-old\s*=", opening):
            opening = opening[:-1] + ' data-old="true">'
    return page_html[:parser.start] + opening + content + page_html[parser.content_end:]


def prepare_deck_updates(previous: dict, snapshot: dict, page_mapping: dict, pages: dict[str, str]) -> dict[str, str]:
    """保存消失系列的一份历史构筑，并在写文件前准备所有页面更新。"""
    old_decks = {}
    updated_pages = {}
    for page, labels in page_mapping.items():
        current = get_page_decks(snapshot, labels)
        previous_decks = get_page_decks(previous, labels)
        saved = (previous.get("old_decks") or {}).get(page)
        if not current:
            if previous_decks:
                # 前排顺序中的第一份作为历史样本，保留其最后一次出现的时间。
                old_decks[page] = {**previous_decks[0], "old": True, "last_seen_at": previous.get("synced_at")}
            elif saved and get_page_decks({"players": [saved]}, labels):
                old_decks[page] = {**saved, "old": True}
        if page in pages:
            updated = update_deck_raw(pages[page], bool(current or page in old_decks))
            if updated != pages[page]:
                updated_pages[page] = updated
    # 历史记录不进入 players 和 total，避免被误认为当前前排构筑。
    snapshot["old_decks"] = old_decks
    return updated_pages


def update_index_dates(index_html: str, changed_pages: set[str], updated_date: str) -> str:
    """仅替换命中卡片的日期属性，保留首页其他内容及原有 HTML 格式。"""
    def replace_card(match: re.Match) -> str:
        """读取当前卡片的页面属性，避免修改其他系列的更新标记。"""
        tag = match.group(0)
        page_match = re.search(r"""\bdata-page\s*=\s*(["'])(.*?)\1""", tag, re.IGNORECASE)
        if not page_match or page_match.group(2) not in changed_pages:
            return tag

        # 保留属性名、空白和引号；新卡片缺少日期属性时自动补齐。
        date_pattern = r"""(\bdata-updated\s*=\s*)(["'])(.*?)\2"""
        if re.search(date_pattern, tag, re.IGNORECASE):
            return re.sub(
                date_pattern,
                lambda date: date.group(1) + date.group(2) + updated_date + date.group(2),
                tag,
                count=1,
                flags=re.IGNORECASE,
            )
        return tag[:-1] + f' data-updated="{updated_date}">'

    return re.sub(r"<deck-card\b[^>]*>", replace_card, index_html, flags=re.IGNORECASE)


def main() -> int:
    # 在覆盖旧快照前读取比较基准；首次同步按空构筑集合处理。
    previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8")) if OUTPUT_PATH.exists() else {}
    page_mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))["pages"]
    index_html = INDEX_PATH.read_text(encoding="utf-8")
    snapshot = build_snapshot()
    # 映射仅允许仓库根目录的 HTML 文件，禁止将数据中的路径用于任意文件写入。
    pages = {}
    for page in page_mapping:
        if Path(page).name != page or not page.endswith(".html"):
            raise ValueError(f"invalid mapped page: {page}")
        pages[page] = (REPO_ROOT / page).read_text(encoding="utf-8")
    updated_pages = prepare_deck_updates(previous, snapshot, page_mapping, pages)
    changed_pages = find_changed_deck_pages(previous, snapshot, page_mapping)
    changed_pages.update(updated_pages)
    updated_date = datetime.fromisoformat(snapshot["synced_at"]).astimezone(SHANGHAI).date().isoformat()
    updated_index = update_index_dates(index_html, changed_pages, updated_date)

    # 先写首页，避免首页写入失败后旧快照已被覆盖，导致下次无法检测构筑变化。
    if updated_index != index_html:
        INDEX_PATH.write_text(updated_index, encoding="utf-8")
    for page, page_html in updated_pages.items():
        (REPO_ROOT / page).write_text(page_html, encoding="utf-8")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT_PATH} ({snapshot['total']} players, synced_at={snapshot['synced_at']})")
    print(f"deck changes: {', '.join(sorted(changed_pages)) or 'none'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"sync failed: {error}", file=sys.stderr)
        raise SystemExit(1)
