(function () {
    "use strict";

    function createLink(href, className) {
        var link = document.createElement("a");
        link.href = href;
        if (className) link.className = className;
        return link;
    }

    function createDeckCard(card) {
        var page = card.getAttribute("data-page");
        var updated = card.getAttribute("data-updated");
        // 页面路径包含 decks/，封面只使用文件名，保持现有图片目录不变。
        var pageName = page.split("/").pop().replace(/\.html$/, "");
        var image = card.getAttribute("data-image") || "images/thumbs/masonry/" + pageName + "-600.jpg";

        // 使用单个原生链接承载整张卡片，空白区域也支持点击和键盘访问。
        var cardLink = createLink(page, "masonry__brick entry format-standard home-deck-card");

        var thumb = document.createElement("div");
        thumb.className = "entry__thumb";

        // 卡片内部使用普通容器，避免嵌套链接产生无效结构和重复焦点。
        var thumbContent = document.createElement("div");
        thumbContent.className = "entry__thumb-link";
        var img = document.createElement("img");
        img.src = image;
        img.srcset = image + " 1x";
        img.alt = "";
        thumbContent.appendChild(img);
        thumb.appendChild(thumbContent);

        var text = document.createElement("div");
        text.className = "entry__text";

        var header = document.createElement("div");
        header.className = "entry__header";

        var heading = document.createElement("h2");
        heading.className = "entry__title";
        var titleText = document.createElement("span");
        titleText.textContent = "读取中...";

        if (window.DeckNames) {
            window.DeckNames.getPageName(page).then(function (name) {
                titleText.textContent = name;
            });
        }

        heading.appendChild(titleText);

        var meta = document.createElement("div");
        meta.className = "entry__meta";

        var date = document.createElement("span");
        date.className = "entry__meta-date";
        date.textContent = updated;

        meta.appendChild(date);
        header.appendChild(heading);
        header.appendChild(meta);
        text.appendChild(header);
        // 封面在左，名称和更新时间在右，阅读顺序与横向布局保持一致。
        cardLink.appendChild(thumb);
        cardLink.appendChild(text);

        return cardLink;
    }

    Array.prototype.forEach.call(document.querySelectorAll("deck-card"), function (card) {
        // 同步标记列表容器，让公共脚本跳过 Masonry 的动态定位。
        card.parentNode.classList.add("home-deck-list");
        card.parentNode.replaceChild(createDeckCard(card), card);
    });

    // 先显示全部卡片，再按快照调整顺序；首页始终将码丽丝排在第一位。
    if (window.DeckNames && window.DeckNames.sortDeckItems) {
        document.querySelectorAll(".home-deck-list").forEach(function (list) {
            window.DeckNames.sortDeckItems(list.querySelectorAll(".home-deck-card"), function (card) {
                return card.getAttribute("href");
            }, "Maliss.html").then(function (cards) {
                cards.forEach(function (card) { list.appendChild(card); });
            });
        });
    }
})();
