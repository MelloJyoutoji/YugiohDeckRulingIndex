(function () {
    "use strict";

    var pageTitleCache = new Map();

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

        var imagePath =
            "images/thumbs/single/standard/" +
            pageName +
            "-2000.jpg";

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
        applyDeckNames: applyDeckNames
    };

    document.addEventListener("DOMContentLoaded", function () {
        applyDeckNames(document);
    });
})();
