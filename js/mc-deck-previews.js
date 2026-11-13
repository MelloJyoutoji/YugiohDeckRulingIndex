/**
 * 卡组页前排预览：读取定时同步的 MyCard 快照，按主系列填入折叠卡组。
 * 无可用构筑时展示相关卡片；卡图及详情交互交给 deck-viewer.js。
 */
(function () {
    "use strict";

    // 从脚本位置定位根目录数据，兼容 decks 子目录和项目路径部署。
    var siteRoot = new URL("../", document.currentScript.src).href;
    var LEADERBOARD_URL = new URL("data/mc-leaderboard.json", siteRoot).href;
    var SERIES_MAP_URL = new URL("data/mc-series-pages.json", siteRoot).href;
    var CARD_SEARCH_URL = "https://ygocdb.com/api/v0/";
    // 只轮询本站快照，复用现有后台同步；后台标签页恢复可见时立即补查。
    var REFRESH_INTERVAL_MS = 60 * 1000;
    var refreshing = false;
    var renderedState = "";

    function getCurrentPageName() {
        var path = decodeURIComponent(window.location.pathname || "");
        var fileName = path.split("/").pop() || "";
        return fileName;
    }

    function fetchJson(url) {
        // 请求超时后释放刷新锁，使下一轮能够重试，避免网络挂起后永久停止更新。
        var controller = new AbortController();
        var timeout = window.setTimeout(function () { controller.abort(); }, 15000);
        return fetch(url, { cache: "no-store", signal: controller.signal }).then(function (response) {
            if (!response.ok) {
                throw new Error("无法读取 " + url);
            }
            return response.json();
        }).finally(function () {
            window.clearTimeout(timeout);
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

    // 静态 YDK、分享码和构筑链接均视为已有构筑，不用搜索结果覆盖。
    function hasStaticDeck() {
        var raw = document.getElementById("deck-raw");
        return Boolean(raw && /(^|\n)\s*\d+\s*(\n|$)/.test(raw.textContent))
            || Array.prototype.some.call(document.querySelectorAll(".deck-preview[data-deck-code], .card-grid img, .deck-previews a[href], #deck-render a[href]"), function (node) {
                // 动态卡片和动态构筑都不是静态来源，不能阻止下一次快照检查。
                return !node.closest("[data-mc-previews]");
            });
    }

    // 只读取初始结果，不跟随 next 加载更多相关性较低的结果。
    async function searchInitialCards(queries) {
        var cards = new Map();
        for (var query of queries) {
            var url = new URL(CARD_SEARCH_URL);
            url.searchParams.set("search", query);
            var data = await fetchJson(url.href);
            if (!Array.isArray(data.result)) {
                throw new Error("相关卡片搜索结果格式无效");
            }
            data.result.forEach(function (card) {
                // cid 标识卡片身份，合并异画和多个搜索词的重复结果。
                var key = card.cid ? "cid:" + card.cid : "id:" + card.id;
                if ((card.cid || Number(card.id) > 0) && !cards.has(key)) {
                    cards.set(key, card);
                }
            });
        }
        return Array.from(cards.values());
    }

    // 仅在确实没有构筑时调用，构筑出现后由 renderPreviews 清空这里的内容。
    async function renderRelatedCards(container, queries) {
        var requestId = String(Date.now()) + Math.random();
        container.dataset.previewRequest = requestId;
        setMeta(container, "正在加载相关卡片…", false);
        var render = document.createElement("div");
        render.className = "deck-render";
        container.appendChild(render);
        try {
            var cards = await searchInitialCards(queries);
            // 新构筑已经渲染时，丢弃较早的异步搜索结果，避免兜底内容回流。
            if (container.dataset.previewRequest !== requestId) {
                return;
            }
            if (!window.DeckViewer || typeof window.DeckViewer.renderSearchCards !== "function") {
                throw new Error("卡片展示功能尚未初始化");
            }
            window.DeckViewer.renderSearchCards(render, cards);
            setMeta(container, cards.length ? "相关卡片 · " + cards.length + " 种" : "未搜索到相关卡片", !cards.length);
        } catch (error) {
            if (container.dataset.previewRequest === requestId) {
                setMeta(container, "相关卡片加载失败。", true);
                renderedState = "";
                console.error("加载相关卡片失败:", error);
            }
        }
    }

    // 清除搜索兜底及旧构筑，保留顶部状态文字，避免新构筑与旧内容同时出现。
    function clearPreviewContent(container) {
        Array.from(container.children).forEach(function (node) {
            if (!node.classList.contains("mc-previews-meta")) {
                node.remove();
            }
        });
        delete container.dataset.previewRequest;
    }

    function renderPreviews(container, snapshot, labels, oldDeck) {
        // 构筑内容更新时仍保留同一构筑已切换的展开状态。
        var openedCodes = new Set(Array.from(container.querySelectorAll("details.deck-preview[open]"), function (node) {
            return node.getAttribute("data-deck-code");
        }));
        clearPreviewContent(container);
        var labelSet = {};
        labels.forEach(function (label) {
            labelSet[label] = true;
        });

        var matched = (snapshot.players || []).filter(function (entry) {
            var deck = entry && entry.deck;
            return deck && deck.code && labelSet[deck.main_category];
        });

        var updatedText = formatUpdatedAt(snapshot);
        // 当前系列退出前排后，仍可展开查看同步脚本保留的一份历史构筑。
        if (!matched.length && oldDeck && oldDeck.deck && oldDeck.deck.code) {
            var lastSeen = oldDeck.last_seen_at ? " · 最后出现于 " + String(oldDeck.last_seen_at).replace("T", " ") : "";
            setMeta(container, "当前前排暂无该系列卡组 · 保留 1 份 old 构筑" + lastSeen, false);
            var oldPreview = createPreview(Object.assign({}, oldDeck, { old: true }));
            oldPreview.open = openedCodes.has(oldDeck.deck.code);
            container.appendChild(oldPreview);
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
            var preview = createPreview(entry);
            preview.open = openedCodes.has(entry.deck.code);
            container.appendChild(preview);
        });
        bindPreviews(container);
    }

    var pageName = getCurrentPageName();
    if (!pageName || !window.location.pathname.startsWith(new URL("decks/", siteRoot).pathname)
        || !document.querySelector("[data-deck-name]")) {
        return;
    }

    // 读取和渲染分离于搜索请求，新的快照不必等待旧搜索返回才能替换兜底。
    function refreshPreviews() {
        if (refreshing) {
            return;
        }
        refreshing = true;
        return Promise.all([fetchJson(SERIES_MAP_URL), fetchJson(LEADERBOARD_URL)])
        .then(function (results) {
            var seriesMap = results[0] || {};
            var snapshot = results[1] || {};
            var labels = seriesMap.pages && seriesMap.pages[pageName];

            labels = Array.isArray(labels) ? labels : [];

            var existing = document.querySelector("[data-mc-previews]");
            var oldDeck = snapshot.old_decks && snapshot.old_decks[pageName];
            var labelsSet = {};
            labels.forEach(function (label) {
                labelsSet[label] = true;
            });
            var matchedCount = (snapshot.players || []).filter(function (entry) {
                return entry && entry.deck && entry.deck.code && labelsSet[entry.deck.main_category];
            }).length;

            var hasSnapshotDeck = matchedCount > 0 || Boolean(oldDeck && oldDeck.deck && oldDeck.deck.code);
            var hasStatic = hasStaticDeck();
            // 有静态构筑而没有快照构筑时，继续保留原本的静态展示。
            if (!existing && !hasSnapshotDeck && hasStatic) {
                return;
            }

            var container = ensureContainer();
            if (!container) {
                return;
            }

            // 相同构筑保留原节点及展开状态；仅更新时间变化也不重建卡组。
            var state = JSON.stringify({ labels: labels, decks: (snapshot.players || []).filter(function (entry) {
                return entry && entry.deck && entry.deck.code && labelsSet[entry.deck.main_category];
            }).map(function (entry) {
                return { rank: entry.rank, player: entry.player, deck: entry.deck };
            }), oldDeck: oldDeck || null, hasStatic: hasStatic });
            if (state === renderedState) {
                return;
            }
            renderedState = state;
            if (!hasSnapshotDeck && !hasStatic) {
                clearPreviewContent(container);
                var queries = labels.length ? labels : [document.title.trim()];
                queries = Array.from(new Set(queries.map(function (query) { return query.trim(); }).filter(Boolean)));
                if (queries.length) {
                    renderRelatedCards(container, queries);
                    return;
                }
                return;
            }
            renderPreviews(container, snapshot, labels, oldDeck);
        })
        .catch(function (error) {
            console.error("加载前排卡组失败:", error);
        })
        .finally(function () {
            refreshing = false;
        });
    }

    refreshPreviews();
    window.setInterval(function () {
        if (!document.hidden) {
            refreshPreviews();
        }
    }, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            refreshPreviews();
        }
    });
})();
