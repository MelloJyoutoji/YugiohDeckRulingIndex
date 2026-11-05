/* ===================================================================
 * TypeRite - Main JS
 *
 *
 * ------------------------------------------------------------------- */

(function($) {

    "use strict";

    // 以公共脚本的位置确定站点根目录，兼容子目录页面和项目路径部署。
    var siteRoot = new URL("../", document.currentScript.src).href;

    // 注入公共组件后，其资源地址应相对于组件文件解析，而非当前页面。
    function resolveComponentUrls(container, componentUrl) {
        container.querySelectorAll("[href], [src], [action]").forEach(function(element) {
            ["href", "src", "action"].forEach(function(attribute) {
                var value = element.getAttribute(attribute);
                if (value && value.charAt(0) !== "#") {
                    element.setAttribute(attribute, new URL(value, componentUrl).href);
                }
            });
        });
    }
    
    var cfg = {
        scrollDuration : 800, // smoothscroll duration
        mailChimpURL   : ''   // mailchimp url
    },

    $WIN = $(window);

    // Add the User Agent to the <html>
    // will be used for IE10/IE11 detection (Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0; rv:11.0))
    var doc = document.documentElement;
    doc.setAttribute('data-useragent', navigator.userAgent);


   /* Load Components
    * ------------------------------------------------------ */
    var ssLoadComponents = function() {
        // 导航与页脚仍保留在根目录，页面层级不影响组件加载。
        var headerUrl = new URL("header.html", siteRoot).href;
        var footerUrl = new URL("footer.html", siteRoot).href;
        
        console.log("开始加载组件..."); // 添加调试信息
        
        // 加载header组件
        $("#header-placeholder").load(headerUrl, function(response, status, xhr) {
            if (status == "error") {
                console.error("Error loading header:", xhr.status, xhr.statusText);
                console.error("尝试的路径:", headerUrl);
            } else {
                console.log("Header 加载成功");

                resolveComponentUrls(this, headerUrl);

                if (window.DeckNames) {
                    window.DeckNames.applyDeckNames(
                        document.getElementById("header-placeholder")
                    );
                    // 导航与首页共用主系列排序，导航不额外置顶码丽丝。
                    if (window.DeckNames.sortDeckItems) {
                        this.querySelectorAll("[data-deck-list]").forEach(function(list) {
                            window.DeckNames.sortDeckItems(list.children, function(item) {
                                var link = item.querySelector("a[href]");
                                return link ? link.getAttribute("href") : "";
                            }).then(function(items) {
                                items.forEach(function(item) { list.appendChild(item); });
                            });
                        });
                    }
                }

                // header加载成功后初始化相关功能
                ssMenu(); // 重新初始化菜单功能
                ssSearch(); // 重新初始化搜索功能
            }
        });
        
        // 加载footer组件
        $("#footer-placeholder").load(footerUrl, function(response, status, xhr) {
            if (status == "error") {
                console.error("Error loading footer:", xhr.status, xhr.statusText);
                console.error("尝试的路径:", footerUrl);
            } else {
                console.log("Footer 加载成功");
                resolveComponentUrls(this, footerUrl);
                // footer加载成功后初始化相关功能
                ssBackToTop(); // 重新初始化回到顶部功能
                ssSmoothScroll(); // 重新初始化平滑滚动功能
            }
        });
        
    };

   /* Load ruling includes
    * ------------------------------------------------------ */
    var ssLoadRulingIncludes = function() {
        $("[data-ruling-source]").each(function() {
            var include = $(this);
            var source = include.attr("data-ruling-source");

            include.load(source, function(response, status, xhr) {
                if (status == "error") {
                    console.error("Error loading ruling:", xhr.status, xhr.statusText);
                    console.error("尝试的路径:", source);
                    return;
                }

                document.dispatchEvent(new CustomEvent("rulinginclude:loaded", {
                    detail: include.get(0)
                }));
            });
        });
    };

    /** 获取五栏中的轴分组容器，兼容整栏折叠及动态补建的板块外框。 */
    function getRulingAxisGroups(heading) {
        var entryContent = heading.closest('.entry__content[data-ruling-layout="axes"]');
        var titles = ["裁定", "注意", "持续适用的效果", "自肃", "召唤条件"];
        if (!entryContent || titles.indexOf(heading.textContent.trim()) === -1) return null;

        // 先保存标题后的内容，再将标题和内容放入同一个完整外框。
        var sibling = heading.nextElementSibling;
        var frame = heading.parentElement;
        if (!frame.classList.contains("ruling-section")) {
            frame = document.createElement("section");
            frame.className = "ruling-section";
            heading.parentNode.insertBefore(frame, heading);
            frame.appendChild(heading);
            if (sibling && (sibling.classList.contains("ruling-axes") || sibling.classList.contains("ruling-fold"))) {
                frame.appendChild(sibling);
            }
        }

        // 大折叠内部复用原有轴容器，避免另建容器导致重复或混入其他轴。
        var foldContent = sibling && sibling.classList.contains("ruling-fold") &&
            sibling.querySelector(".ruling-fold__content");
        var groups = foldContent ? foldContent.querySelector(".ruling-axes") :
            sibling && sibling.classList.contains("ruling-axes") ? sibling : null;
        if (!groups) {
            groups = document.createElement("div");
            groups.className = "ruling-axes";
            (foldContent || frame).appendChild(groups);
        }
        return groups;
    }

   /* 根据当前卡组的构筑名称引入单卡资料；内容始终以 cards 页面为准。
    * ------------------------------------------------------ */
    var ssLoadMatchedCardRulings = function() {
        var deckDirectory = new URL("decks/", siteRoot).pathname;
        if (window.location.pathname.indexOf(deckDirectory) !== 0) return;

        var contentNode = document.querySelector(".entry__content");
        if (!contentNode) return;
        // 后续异步函数只使用已确认存在的正文容器。
        const entryContent = contentNode;
        var pageName = decodeURIComponent(window.location.pathname.split("/").pop() || "");
        // 栏目顺序也用于补建原页面没有的栏目；待核实内容不并入确定裁定。
        var sectionTitles = ["裁定", "注意", "持续适用的效果", "自肃", "召唤条件", "待核实"];

        /** 读取站内资料，失败时保留页面原有内容并在控制台报告。 */
        function fetchResource(path, asJson) {
            return fetch(new URL(path, siteRoot).href, { cache: "no-store" }).then(function(response) {
                if (!response.ok) throw new Error("无法读取 " + path + "：" + response.status);
                return asJson ? response.json() : response.text();
            });
        }

        /** 只收集本页所属构筑的名称，保持与前排预览的主系列归属及历史回退一致。 */
        function collectDeckNames(snapshot, seriesMap) {
            var labels = seriesMap.pages && seriesMap.pages[pageName] || [];
            var entries = (snapshot.players || []).filter(function(entry) {
                return entry && entry.deck && entry.deck.code && labels.indexOf(entry.deck.main_category) !== -1;
            });
            var oldDeck = snapshot.old_decks && snapshot.old_decks[pageName];
            if (!entries.length && oldDeck && oldDeck.deck && oldDeck.deck.code) entries.push(oldDeck);
            return entries.map(function(entry) { return String(entry.deck.name || ""); });
        }

        /** 任一构筑名称包含单卡名或别名时即命中，不仅检查第一份构筑。 */
        function matchesCardRuling(deckNames, aliases) {
            return deckNames.some(function(deckName) {
                return aliases.some(function(alias) {
                    return typeof alias === "string" && alias.length > 0 && deckName.indexOf(alias) !== -1;
                });
            });
        }

        /** 以来源页面和栏目 ID 去重，兼容已有的“#栏目 > p”手工引用。 */
        function hasSectionInclude(sourceUrl, sectionId) {
            return Array.prototype.some.call(entryContent.querySelectorAll("[data-ruling-source]"), function(include) {
                var source = include.getAttribute("data-ruling-source").trim();
                var separator = source.search(/\s/);
                if (separator === -1) return false;
                var selector = source.slice(separator).trim();
                var existingUrl = new URL(source.slice(0, separator), document.baseURI).href;
                return existingUrl === sourceUrl && selector.split(/[\s>+~,.:[\]]/)[0] === "#" + sectionId;
            });
        }

        /** 找到目标栏目的编号容器；分轴页面按资料来源归组，其他页面沿用原结构。 */
        function getSectionContainer(title, card, sourceDocument) {
            var headings = Array.prototype.slice.call(entryContent.querySelectorAll("h2"));
            var heading = headings.find(function(node) { return node.textContent.trim() === title; });
            if (!heading) {
                heading = document.createElement("h2");
                heading.textContent = title;
                var following = headings.find(function(node) {
                    var order = sectionTitles.indexOf(node.textContent.trim());
                    return order > sectionTitles.indexOf(title) || /^卡组预览/.test(node.textContent.trim());
                });
                // 已有标题可能位于板块外框内，插入位置必须取正文的直接子节点。
                var followingNode = following && (following.closest(".ruling-section") || following);
                entryContent.insertBefore(heading, followingNode || null);
            }

            // 五栏都从自身外框或大折叠内部取得轴容器。
            var sibling = getRulingAxisGroups(heading) || heading.nextElementSibling;
            if (sibling && sibling.classList.contains("ruling-axes")) {
                // 使用完整来源地址匹配现有轴，避免把新资料混进第一个轴。
                var sourceUrl = new URL(card.page, siteRoot).href;
                var axis = Array.prototype.find.call(sibling.children, function(group) {
                    var page = group.getAttribute("data-ruling-page");
                    return page && new URL(page, document.baseURI).href === sourceUrl;
                });
                if (!axis) {
                    axis = document.createElement("details");
                    axis.className = "ruling-axis";
                    axis.setAttribute("data-ruling-page", sourceUrl);
                    // 只在创建时展开，后续异步加载保留用户已切换的状态。
                    axis.open = true;
                    var summary = document.createElement("summary");
                    var sourceTitle = sourceDocument.querySelector(".entry__title, title");
                    summary.textContent = sourceTitle && sourceTitle.textContent.trim() || card.aliases[0];
                    var axisContent = document.createElement("div");
                    axisContent.className = "auto-number";
                    axis.appendChild(summary);
                    axis.appendChild(axisContent);
                    // 动态出现的新轴放在通用及跨轴互动组之前。
                    var general = sibling.querySelector('[data-ruling-axis="general"]');
                    sibling.insertBefore(axis, general);
                }
                return axis.querySelector(".auto-number");
            }
            var foldContent = sibling && sibling.classList.contains("ruling-fold") &&
                sibling.querySelector(".ruling-fold__content");
            if (foldContent) {
                var numbered = foldContent.querySelector(".auto-number");
                if (numbered) return numbered;
                sibling = document.createElement("div");
                sibling.className = "auto-number";
                foldContent.appendChild(sibling);
            } else if (!sibling || !sibling.classList.contains("auto-number")) {
                sibling = document.createElement("div");
                sibling.className = "auto-number";
                heading.insertAdjacentElement("afterend", sibling);
            }
            return sibling;
        }

        /** 整栏复制子节点，保留完整效果、规则条目与来源链接，不只截取说明段落。 */
        function appendCardSections(card, html) {
            var sourceUrl = new URL(card.page, siteRoot).href;
            var sourceDocument = new DOMParser().parseFromString(html, "text/html");
            sourceDocument.querySelectorAll(".entry__content h2").forEach(function(heading) {
                var title = heading.textContent.trim();
                var section = heading.nextElementSibling;
                if (sectionTitles.indexOf(title) === -1 || !section || !section.id ||
                    !section.classList.contains("auto-number") || !section.textContent.trim() ||
                    /^无[。.]?$/.test(section.textContent.trim()) || hasSectionInclude(sourceUrl, section.id)) return;

                var target = getSectionContainer(title, card, sourceDocument);
                // 原栏目仅写“无”时，用实际引入内容替换占位文字。
                if (/^无[。.]?$/.test(target.textContent.trim())) target.textContent = "";
                var include = document.createElement("div");
                include.className = "ruling-include";
                include.setAttribute("data-ruling-source", sourceUrl + " #" + section.id + " > *");
                Array.prototype.forEach.call(section.childNodes, function(node) {
                    include.appendChild(document.importNode(node, true));
                });
                resolveComponentUrls(include, sourceUrl);
                target.appendChild(include);
                // 复用现有通知，使折叠条数和卡名悬停在动态引入后同步更新。
                document.dispatchEvent(new CustomEvent("rulinginclude:loaded", { detail: include }));
            });
        }

        Promise.all([
            fetchResource("data/mc-leaderboard.json", true),
            fetchResource("data/mc-series-pages.json", true),
            fetchResource("data/card-ruling-pages.json", true)
        ]).then(function(results) {
            var deckNames = collectDeckNames(results[0], results[1]);
            var cards = (results[2].cards || []).filter(function(card) {
                return card && typeof card.page === "string" && Array.isArray(card.aliases) &&
                    matchesCardRuling(deckNames, card.aliases);
            });
            // 按配置顺序写入，避免网络响应先后导致栏目内容顺序不稳定。
            return Promise.all(cards.map(function(card) {
                return fetchResource(card.page, false).then(function(html) {
                    return { card: card, html: html };
                }).catch(function(error) {
                    console.error("加载单卡资料失败:", card.page, error);
                    return null;
                });
            })).then(function(sources) {
                sources.forEach(function(source) {
                    if (source) appendCardSections(source.card, source.html);
                });
            });
        }).catch(function(error) {
            console.error("按构筑名称引入单卡资料失败:", error);
        });
    };

   /* 分轴页面五栏都有外框，裁定整栏默认收起，注意整栏默认展开。
    * ------------------------------------------------------ */
    var ssFoldRulings = function() {
        // 只处理卡组页面，避免影响独立卡片资料页的同名栏目。
        var deckDirectory = new URL("decks/", siteRoot).pathname;
        if (window.location.pathname.indexOf(deckDirectory) !== 0) return;

        document.querySelectorAll(".entry__content h2").forEach(function(heading) {
            // 先补齐五栏外框，再仅为裁定与注意处理整栏折叠。
            var axisGroups = getRulingAxisGroups(heading);
            var sectionTitle = heading.textContent.trim();
            if (sectionTitle !== "裁定" && sectionTitle !== "注意") return;

            // 重复检查时复用已有折叠容器，保留用户当前的展开状态。
            var fold = heading.nextElementSibling;
            var hasFold = fold && fold.classList.contains("ruling-fold");
            var content = hasFold ? fold.querySelector(".ruling-fold__content") : null;
            var nodes = [];
            if (content) {
                nodes = Array.prototype.slice.call(content.childNodes);
            } else {
                var sibling = heading.nextSibling;
                while (sibling) {
                    if (sibling.nodeType === 1 && /^H[12]$/.test(sibling.tagName)) break;
                    nodes.push(sibling);
                    sibling = sibling.nextSibling;
                }
            }

            // 新版每个ruling-entry算一条；旧版按段落计数，排除效果引用及条目内重复段落。
            var candidates = [];
            nodes.forEach(function(node) {
                if (node.nodeType !== 1) return;
                if (node.matches(".ruling-entry, p")) candidates.push(node);
                candidates = candidates.concat(
                    Array.prototype.slice.call(node.querySelectorAll(".ruling-entry, p"))
                );
            });
            var rulingCount = candidates.filter(function(element) {
                if (!element.textContent.trim()) return false;
                if (element.closest("blockquote, .effect-text")) return false;
                if (element.matches(".ruling-entry")) {
                    return !element.parentElement.closest(".ruling-entry");
                }
                return !element.closest(".ruling-entry");
            }).length;

            // 裁定整栏默认收起；分轴页面的注意默认展开，仅在首次创建时设置。
            if (!hasFold) {
                fold = document.createElement("details");
                fold.className = "ruling-fold";
                fold.open = !!axisGroups && sectionTitle !== "裁定";
                var summary = document.createElement("summary");
                content = document.createElement("div");
                content.className = "ruling-fold__content";
                fold.appendChild(summary);
                fold.appendChild(content);
                heading.parentNode.insertBefore(fold, heading.nextSibling);
                nodes.forEach(function(node) { content.appendChild(node); });
            }
            // 静态及动态创建的大折叠都只绑定一次，异步更新保留大小折叠状态。
            if (!fold.hasAttribute("data-ruling-toggle-bound")) {
                fold.setAttribute("data-ruling-toggle-bound", "true");
                fold.addEventListener("toggle", function(event) {
                    if (event.target !== fold) return;
                    updateRulingSummary(fold);
                });
            }
            fold.setAttribute("data-ruling-title", sectionTitle);
            fold.setAttribute("data-ruling-count", rulingCount);
            updateRulingSummary(fold);
        });
    };

    // 条数可能在公共内容引入后变化，每次使用容器保存的栏目名与最新统计值。
    function updateRulingSummary(fold) {
        fold.querySelector("summary").textContent =
            (fold.open ? "收起" : "展开") + fold.getAttribute("data-ruling-title") +
            "（共" + fold.getAttribute("data-ruling-count") + "条）";
    }

   /* preloader
    * -------------------------------------------------- */
    var ssPreloader = function() {
        
        $("html").addClass('ss-preload');

        $WIN.on('load', function() {

            //force page scroll position to top at page refresh
            // $('html, body').animate({ scrollTop: 0 }, 'normal');

            // will first fade out the loading animation 
            $("#loader").fadeOut("slow", function() {
                // will fade out the whole DIV that covers the website.
                $("#preloader").delay(300).fadeOut("slow");
            }); 
            
            // for hero content animations 
            $("html").removeClass('ss-preload');
            $("html").addClass('ss-loaded');
        
        });
    };


   /* search
    * ------------------------------------------------------ */
    var ssSearch = function() {
            
        var searchWrap = $('.search-block'),
            searchField = searchWrap.find('.search-field'),
            closeSearch = searchWrap.find('.search-close'),
            searchTrigger = $('.search-trigger'),
            siteBody = $('body');


        searchTrigger.on('click', function(e) {
            
            e.preventDefault();
            e.stopPropagation();
        
            var $this = $(this);
        
            siteBody.addClass('search-is-visible');
            setTimeout(function(){
                searchWrap.find('.search-field').focus();
            }, 100);
        
        });

        closeSearch.on('click', function(e) {

            var $this = $(this);
        
            e.stopPropagation(); 
        
            if(siteBody.hasClass('search-is-visible')){
                siteBody.removeClass('search-is-visible');
                setTimeout(function(){
                    searchWrap.find('.search-field').blur();
                }, 100);
            }
        });

        searchWrap.on('click',  function(e) {
            if( !$(e.target).is('.search-field') ) {
                closeSearch.trigger('click');
            }
        });
            
        searchField.on('click', function(e){
            e.stopPropagation();
        });
            
        searchField.attr({placeholder: 'Type Keywords', autocomplete: 'off'});

    };


   /* menu
    * ------------------------------------------------------ */
    var ssMenu = function() {

        var menuToggle = $('.header__menu-toggle'),
            siteBody = $('body');
    
        menuToggle.on('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            menuToggle.toggleClass('is-clicked');
            siteBody.toggleClass('nav-wrap-is-visible');
        });

        $('.header__nav .has-children').children('a').on('click', function (e) {
            
            e.preventDefault();

            $(this).toggleClass('sub-menu-is-open')
                .next('ul')
                .slideToggle(200)
                .end()
                .parent('.has-children')
                .siblings('.has-children')
                .children('a')
                .removeClass('sub-menu-is-open')
                .next('ul')
                .slideUp(200);

        });
    };


   /* masonry
    * ---------------------------------------------------- */ 
    var ssMasonryFolio = function () {
        
        // 首页卡组使用普通列表布局，打开时直接显示全部内容。
        var containerBricks = $('.masonry').not('.home-deck-list');

        if (!containerBricks.length) return;

        containerBricks.masonry({
            itemSelector: '.masonry__brick',
            columnWidth: '.grid-sizer',
            percentPosition: true,
            resize: true,
            horizontalOrder: true
        });

        // layout Masonry after each image loads
        containerBricks.imagesLoaded().progress( function() {
            containerBricks.masonry('layout');
        });

    };

   /* animate bricks
    * ------------------------------------------------------ */
    var ssBricksAnimate = function() {

    var didReveal = false;

    function revealOnce() {
        if (didReveal) return;
        didReveal = true;

        var animateEl = $('.animate-this');

        setTimeout(function() {
            animateEl.each(function(ctr) {
                var el = $(this);
                setTimeout(function() {
                    el.addClass('animated');
                }, ctr * 200);
            });
        }, 300);
    }

    $WIN.on('load', revealOnce);

    if (document.readyState === 'complete') {
        revealOnce();
    } else {
        $(revealOnce);
    }

    $WIN.on('resize', function() {
        $('.animate-this').addClass('animated');
    });

};


   /* slick slider
    * ------------------------------------------------------ */
    var ssSlickSlider = function() {

        var $gallery = $('.slider__slides').slick({
            arrows: false,
            dots: true,
            infinite: true,
            slidesToShow: 1,
            slidesToScroll: 1,
            adaptiveHeight: true,
            pauseOnFocus: false,
            fade: true,
            cssEase: 'linear'
        });
        
        $('.slider__slide').on('click', function() {
            $gallery.slick('slickGoTo', parseInt($gallery.slick('slickCurrentSlide'))+1);
        });

    };


   /* smooth scrolling
    * ------------------------------------------------------ */
    var ssSmoothScroll = function() {
        
        $('.smoothscroll').on('click', function (e) {
            var target = this.hash,
            $target    = $(target);
            
                e.preventDefault();
                e.stopPropagation();

            $('html, body').stop().animate({
                'scrollTop': $target.offset().top
            }, cfg.scrollDuration, 'swing').promise().done(function () {

                // check if menu is open
                if ($('body').hasClass('menu-is-open')) {
                    $('.header-menu-toggle').trigger('click');
                }

                window.location.hash = target;
            });
        });

    };


   /* alert boxes
    * ------------------------------------------------------ */
    var ssAlertBoxes = function() {

        $('.alert-box').on('click', '.alert-box__close', function() {
            $(this).parent().fadeOut(500);
        }); 

    };


   /* Back to Top
    * ------------------------------------------------------ */
    var ssBackToTop = function() {
        
        var pxShow      = 500,
            goTopButton = $(".go-top")

        // Show or hide the button
        if ($(window).scrollTop() >= pxShow) goTopButton.addClass('link-is-visible');

        $(window).on('scroll', function() {
            if ($(window).scrollTop() >= pxShow) {
                if(!goTopButton.hasClass('link-is-visible')) goTopButton.addClass('link-is-visible')
            } else {
                goTopButton.removeClass('link-is-visible')
            }
        });
    };


   /* Initialize
    * ------------------------------------------------------ */
    (function clInit() {
        
        // 等待DOM完全加载后再加载组件
        $(document).ready(function() {
            console.log("DOM 已加载，开始初始化组件...");
            
            // 先加载公共组件
            ssLoadComponents();
            // 先绑定动态内容通知，再初始化裁定与注意折叠及启动公共内容加载。
            document.addEventListener("rulinginclude:loaded", ssFoldRulings);
            ssFoldRulings();
            ssLoadRulingIncludes();
            ssLoadMatchedCardRulings();
            
            // 初始化其他功能
            ssPreloader();
            ssSearch();
            ssMenu();
            ssMasonryFolio();
            ssBricksAnimate();
            ssSlickSlider();
            ssSmoothScroll();
            ssAlertBoxes();
            ssBackToTop();
        });

    })();

})(jQuery);
