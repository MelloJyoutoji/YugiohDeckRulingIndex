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
        var title = card.getAttribute("data-title");
        var updated = card.getAttribute("data-updated");
        var image = card.getAttribute("data-image") || "images/thumbs/masonry/" + page.replace(/\.html$/, "") + "-600.jpg";

        var article = document.createElement("article");
        article.className = "masonry__brick entry format-standard animate-this";

        var thumb = document.createElement("div");
        thumb.className = "entry__thumb";

        var thumbLink = createLink(page, "entry__thumb-link");
        var img = document.createElement("img");
        img.src = image;
        img.srcset = image + " 1x";
        img.alt = "";
        thumbLink.appendChild(img);
        thumb.appendChild(thumbLink);

        var text = document.createElement("div");
        text.className = "entry__text";

        var header = document.createElement("div");
        header.className = "entry__header";

        var heading = document.createElement("h2");
        heading.className = "entry__title";
        var titleLink = createLink(page);
        titleLink.textContent = title;
        heading.appendChild(titleLink);

        var meta = document.createElement("div");
        meta.className = "entry__meta";

        var date = document.createElement("span");
        date.className = "entry__meta-date";
        var dateLink = createLink(page);
        dateLink.textContent = updated;
        date.appendChild(dateLink);

        meta.appendChild(date);
        header.appendChild(heading);
        header.appendChild(meta);
        text.appendChild(header);
        article.appendChild(thumb);
        article.appendChild(text);

        return article;
    }

    Array.prototype.forEach.call(document.querySelectorAll("deck-card"), function (card) {
        card.parentNode.replaceChild(createDeckCard(card), card);
    });
})();
