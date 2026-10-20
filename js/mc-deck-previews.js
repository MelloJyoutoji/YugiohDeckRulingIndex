/**
 * 卡组页前排预览：读取每日同步的 MyCard 快照，按主系列填入折叠卡组。
 * 无映射的系列会被跳过；解码与展开渲染仍交给 deck-viewer.js。
 */
(function () {
    "use strict";

    // 从脚本位置定位根目录数据，兼容 decks 子目录和项目路径部署。
    var siteRoot = new URL("../", document.currentScript.src).href;
    var LEADERBOARD_URL = new URL("data/mc-leaderboard.json", siteRoot).href;
    var SERIES_MAP_URL = new URL("data/mc-series-pages.json", siteRoot).href;

    function getCurrentPageName() {
        var path = decodeURIComponent(window.location.pathname || "");
        var fileName = path.split("/").pop() || "";
        return fileName;
    }

    function fetchJson(url) {
        return fetch(url, { cache: "no-store" }).then(function (response) {
            if (!response.ok) {
                throw new Error("无法读取 " + url);
            }
            return response.json();
        });
    }

    function formatUpdatedAt(snapshot) {
        var syncedAt = snapshot && snapshot.synced_at;
        if (syncedAt) {
            return String(syncedAt).replace("T", " ");
        }

        var updatedAt = Number(snapshot && snapshot.updated_at);
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
            return "";
        }

        return new Date(updatedAt * 1000).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false
        });
    }

    function hasPreviewHeading() {
        return Array.prototype.some.call(document.querySelectorAll("h2"), function (heading) {
            return heading.textContent.trim() === "卡组预览";
        });
    }

    // 已有静态容器则复用；否则插到 #deck-render 后面，避免打乱原有样本卡组。
    function ensureContainer() {
        var existing = document.querySelector("[data-mc-previews]");
        if (existing) {
            return existing;
        }

        var renderEl = document.getElementById("deck-render");
        if (!renderEl) {
            return null;
        }

        var container = document.createElement("div");
        container.className = "deck-previews";
        container.setAttribute("data-mc-previews", "");

        if (!hasPreviewHeading()) {
            var heading = document.createElement("h2");
            heading.textContent = "卡组预览";
            renderEl.insertAdjacentElement("afterend", heading);
            heading.insertAdjacentElement("afterend", container);
        } else {
            renderEl.insertAdjacentElement("afterend", container);
        }

        return container;
    }

    function setMeta(container, text, isEmpty) {
        var meta = container.querySelector(".mc-previews-meta");
        if (!meta) {
            meta = document.createElement("p");
            meta.className = "mc-previews-meta";
            container.insertBefore(meta, container.firstChild);
        }
        meta.textContent = text;
        meta.classList.toggle("mc-previews-empty", Boolean(isEmpty));
    }

    function createPreview(entry) {
        var deck = entry.deck || {};
        var details = document.createElement("details");
        details.className = "deck-preview";
        if (deck.code) {
            details.setAttribute("data-deck-code", deck.code);
        }

        var summary = document.createElement("summary");
        // 历史构筑不展示过期排名，标题明确标记 old。
        var rankLabel = entry.old || entry.rank == null ? "" : "#" + entry.rank + " ";
        var deckName = deck.name || "未识别";
        summary.textContent = (entry.old ? "old · " : "") + rankLabel + (entry.player || "未知玩家") + "【" + deckName + "】";

        var render = document.createElement("div");
        render.className = "deck-render";

        details.appendChild(summary);
        details.appendChild(render);

        if (deck.link) {
            var link = document.createElement("a");
            link.href = deck.link;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "打开卡组";
            details.appendChild(link);
        }

        return details;
    }

    function bindPreviews(container) {
        if (window.DeckViewer && typeof window.DeckViewer.bindPreviews === "function") {
            window.DeckViewer.bindPreviews(container);
        }
    }

    function renderPreviews(container, snapshot, labels, oldDeck) {
        var labelSet = {};
        labels.forEach(function (label) {
            labelSet[label] = true;
        });

        var matched = (snapshot.players || []).filter(function (entry) {
            var deck = entry && entry.deck;
            return deck && deck.code && labelSet[deck.main_category];
        });

        Array.prototype.forEach.call(container.querySelectorAll("details.deck-preview"), function (node) {
            node.parentNode.removeChild(node);
        });

        var updatedText = formatUpdatedAt(snapshot);
        // 当前系列退出前排后，仍可展开查看同步脚本保留的一份历史构筑。
        if (!matched.length && oldDeck && oldDeck.deck && oldDeck.deck.code) {
            var lastSeen = oldDeck.last_seen_at ? " · 最后出现于 " + String(oldDeck.last_seen_at).replace("T", " ") : "";
            setMeta(container, "当前前排暂无该系列卡组 · 保留 1 份 old 构筑" + lastSeen, false);
            container.appendChild(createPreview(Object.assign({}, oldDeck, { old: true })));
            bindPreviews(container);
            return;
        }
        if (!matched.length) {
            setMeta(
                container,
                updatedText ? "当前前排暂无该系列卡组 · 更新于 " + updatedText : "当前前排暂无该系列卡组",
                true
            );
            return;
        }

        setMeta(
            container,
            "前排 " + matched.length + " 份" + (updatedText ? " · 更新于 " + updatedText : ""),
            false
        );

        matched.forEach(function (entry) {
            container.appendChild(createPreview(entry));
        });
        bindPreviews(container);
    }

    var pageName = getCurrentPageName();
    if (!pageName) {
        return;
    }

    Promise.all([fetchJson(SERIES_MAP_URL), fetchJson(LEADERBOARD_URL)])
        .then(function (results) {
            var seriesMap = results[0] || {};
            var snapshot = results[1] || {};
            var labels = seriesMap.pages && seriesMap.pages[pageName];

            // 没有映射的页面保持原样，不插入前排区域。
            if (!Array.isArray(labels) || labels.length === 0) {
                return;
            }

            var existing = document.querySelector("[data-mc-previews]");
            var oldDeck = snapshot.old_decks && snapshot.old_decks[pageName];
            var labelsSet = {};
            labels.forEach(function (label) {
                labelsSet[label] = true;
            });
            var matchedCount = (snapshot.players || []).filter(function (entry) {
                return entry && entry.deck && entry.deck.code && labelsSet[entry.deck.main_category];
            }).length;

            // 原本没有前排区的页面，没有命中卡组时不新增空区域。
            if (!existing && matchedCount === 0 && !(oldDeck && oldDeck.deck && oldDeck.deck.code)) {
                return;
            }

            var container = ensureContainer();
            if (!container) {
                return;
            }

            renderPreviews(container, snapshot, labels, oldDeck);
        })
        .catch(function (error) {
            console.error("加载前排卡组失败:", error);
        });
})();
