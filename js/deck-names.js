(function () {
    "use strict";

    var pageTitleCache = new Map();
    // 首页与公共导航共用同一次快照请求，避免分别统计出不同顺序。
    var deckPageOrderRequest;

    // 封面仍位于根目录 images 下，以脚本 URL 定位，避免依赖页面层级。
    var siteRoot = new URL("../", document.currentScript.src).href;

    /* MyCard 卡组排序：只统计当前玩家的主系列，不计副系列与历史构筑。 */
    function buildDeckPageOrder(snapshot, mapping) {
        if (!snapshot || !Array.isArray(snapshot.players) ||
            !mapping || !mapping.pages || typeof mapping.pages !== "object" ||
            Array.isArray(mapping.pages)) {
            throw new Error("MyCard 排序数据格式无效");
        }

        // 人数相同时使用源站饼图相同的中文名称排序规则。
        var counts = new Map();
        snapshot.players.slice(0, 100).forEach(function (player) {
            var label = player && player.deck && player.deck.main_category;
            if (typeof label === "string" && label) {
                counts.set(label, (counts.get(label) || 0) + 1);
            }
        });
        var labels = Array.from(counts.keys()).sort(function (a, b) {
            return counts.get(b) - counts.get(a) || a.localeCompare(b, "zh-CN");
        });
        var seriesOrder = new Map();
        labels.forEach(function (label, index) {
            seriesOrder.set(label, index);
        });

        // 多系列共用一个页面时取最靠前的系列位置，不累加人数。
        var pageOrder = new Map();
        Object.keys(mapping.pages).forEach(function (page) {
            var pageLabels = mapping.pages[page];
            if (!Array.isArray(pageLabels)) return;
            pageLabels.forEach(function (label) {
                if (seriesOrder.has(label)) {
                    var rank = seriesOrder.get(label);
                    if (!pageOrder.has(page) || rank < pageOrder.get(page)) {
                        pageOrder.set(page, rank);
                    }
                }
            });
        });
        return pageOrder;
    }

    function getDeckPageOrder() {
        if (!deckPageOrderRequest) {
            deckPageOrderRequest = Promise.all([
                "data/mc-leaderboard.json", "data/mc-series-pages.json"
            ].map(function (path) {
                // 重新验证 HTTP 缓存，保证重新打开页面时能读取每日同步结果。
                return fetch(new URL(path, siteRoot).href, { cache: "no-cache" })
                    .then(function (response) {
                        if (!response.ok) throw new Error("无法读取排序数据: " + path);
                        return response.json();
                    });
            })).then(function (data) {
                return buildDeckPageOrder(data[0], data[1]);
            }).catch(function () {
                // 数据不可用时所有卡组均按原顺序显示，仍允许首页单独置顶。
                return new Map();
            });
        }
        return deckPageOrderRequest;
    }

    function getDeckPageFile(page) {
        if (!page) return "";
        try {
            // 同时兼容首页相对路径、子目录页面和导航解析后的绝对 URL。
            return decodeURIComponent(new URL(page, document.baseURI).pathname.split("/").pop());
        } catch (error) {
            return "";
        }
    }

    function sortDeckItems(items, getPage, pinnedPage) {
        // 记录初始位置，确保未上榜卡组和空链接占位项保持相对顺序。
        var entries = Array.prototype.map.call(items, function (item, index) {
            return { item: item, index: index, page: getDeckPageFile(getPage(item)) };
        });
        return getDeckPageOrder().then(function (pageOrder) {
            entries.sort(function (a, b) {
                var aPinned = Boolean(pinnedPage && a.page === pinnedPage);
                var bPinned = Boolean(pinnedPage && b.page === pinnedPage);
                if (aPinned !== bPinned) return aPinned ? -1 : 1;
                var aRank = pageOrder.has(a.page) ? pageOrder.get(a.page) : Number.MAX_SAFE_INTEGER;
                var bRank = pageOrder.has(b.page) ? pageOrder.get(b.page) : Number.MAX_SAFE_INTEGER;
                return aRank - bRank || a.index - b.index;
            });
            return entries.map(function (entry) { return entry.item; });
        });
    }

    function getFallbackName(page) {
        var fileName = String(page || "").split("/").pop();

        return fileName
            .replace(/\.html$/i, "")
            .replace(/_/g, " ");
    }

    function getPageName(page) {
        var pageUrl = new URL(page, document.baseURI).href;

        if (pageTitleCache.has(pageUrl)) {
            return pageTitleCache.get(pageUrl);
        }

        var request = fetch(pageUrl)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("无法读取页面: " + pageUrl);
                }

                return response.text();
            })
            .then(function (html) {
                var parser = new DOMParser();
                var pageDocument = parser.parseFromString(html, "text/html");
                var title = pageDocument.querySelector("title");

                return title && title.textContent.trim()
                    ? title.textContent.trim()
                    : getFallbackName(page);
            })
            .catch(function () {
                return getFallbackName(page);
            });

        pageTitleCache.set(pageUrl, request);

        return request;
    }

    function applyCurrentPageName(root) {
        var currentTitle = document.title.trim();

        if (!currentTitle) {
            return;
        }

        root.querySelectorAll("[data-deck-name]").forEach(function (element) {
            element.textContent = currentTitle;
        });
    }

    function getCurrentPageImageName() {
        var fileName = decodeURIComponent(
            window.location.pathname.split("/").pop()
        );

        return fileName.replace(/\.html$/i, "");
    }

    function applyCurrentPageImage(root) {
        var pageName = getCurrentPageImageName();

        if (!pageName) {
            return;
        }

        var imagePath = new URL(
            "images/thumbs/single/standard/" +
            pageName +
            "-2000.jpg", siteRoot
        ).href;

        root.querySelectorAll("[data-deck-image]").forEach(function (image) {
            image.src = imagePath;
            image.srcset = imagePath + " 2000w";
        });
    }

    function applyHeaderNames(root) {
        root.querySelectorAll("[data-deck-list] a[href]").forEach(function (link) {
            var page = link.getAttribute("href");

            if (!page) {
                return;
            }

            getPageName(page).then(function (name) {
                link.textContent = name;
            });
        });
    }

    function applyDeckNames(root) {
        root = root || document;

        applyCurrentPageName(root);
        applyCurrentPageImage(root);
        applyHeaderNames(root);
    }

    window.DeckNames = {
        getPageName: getPageName,
        applyDeckNames: applyDeckNames,
        sortDeckItems: sortDeckItems
    };

    document.addEventListener("DOMContentLoaded", function () {
        applyDeckNames(document);
    });
})();
