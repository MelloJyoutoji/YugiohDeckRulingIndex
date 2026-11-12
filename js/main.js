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
        // 同一来源只请求一次；按稳定条目标识筛选，避免把未投入的卡片资料全部带入。
        var requests = new Map();
        document.querySelectorAll(".ruling-include[data-ruling-source]").forEach(function(include) {
            var source = include.getAttribute("data-ruling-source").trim();
            var separator = source.search(/\s/);
            if (separator === -1) return;
            var sourceUrl = new URL(source.slice(0, separator), document.baseURI).href;
            var selector = source.slice(separator).trim();
            var selectedEntries = (include.getAttribute("data-ruling-entries") || "").split(/\s+/).filter(Boolean);
            if (!requests.has(sourceUrl)) {
                requests.set(sourceUrl, fetch(sourceUrl, { cache: "no-store" }).then(function(response) {
                    if (!response.ok) throw new Error("无法读取裁定来源：" + response.status);
                    return response.text();
                }));
            }
            requests.get(sourceUrl).then(function(html) {
                // jQuery选择器兼容旧页面中的 :contains；来源脚本始终不执行。
                var sourceDocument = new DOMParser().parseFromString(html, "text/html");
                var nodes = $(sourceDocument).find(selector).toArray().filter(function(node) {
                    return !selectedEntries.length || selectedEntries.indexOf(node.getAttribute("data-ruling-entry")) !== -1;
                });
                if (!nodes.length) throw new Error("裁定来源未匹配条目：" + source);
                var fragment = document.createDocumentFragment();
                nodes.forEach(function(node) {
                    var copy = document.importNode(node, true);
                    copy.querySelectorAll("script, [data-ruling-source]").forEach(function(nested) { nested.remove(); });
                    // 来源页的锚点也应返回来源页，避免跳到引用页的同名位置。
                    copy.querySelectorAll('a[href^="#"]').forEach(function(link) {
                        link.setAttribute("href", sourceUrl + link.getAttribute("href"));
                    });
                    resolveComponentUrls(copy, sourceUrl);
                    fragment.appendChild(copy);
                });
                include.replaceChildren(fragment);
                document.dispatchEvent(new CustomEvent("rulinginclude:loaded", { detail: include }));
            }).catch(function(error) {
                console.error("加载裁定失败：", source, error);
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

   /* 按本页全部构筑引入其他轴；资料仅在各轴自己的页面维护。
    * ------------------------------------------------------ */
    var ssLoadMatchedCardRulings = function() {
        var deckDirectory = new URL("decks/", siteRoot).pathname;
        if (window.location.pathname.indexOf(deckDirectory) !== 0) return;

        var contentNode = document.querySelector(".entry__content");
        if (!contentNode) return;
        // 闭包仅持有已经确认存在的正文节点。
        const entryContent = contentNode;
        var pageName = decodeURIComponent(window.location.pathname.split("/").pop() || "");
        var sectionTitles = ["裁定", "注意", "持续适用的效果", "自肃", "召唤条件", "待核实"];
        // 每个来源只请求一次，五栏复用同一份页面快照。
        var resources = new Map();
        var staticDeckNames = Array.prototype.map.call(entryContent.querySelectorAll(".deck-preview > summary"), function(summary) {
            var label = summary.textContent.trim();
            // 前排标题包含玩家名；只匹配【】内的构筑名，避免昵称误触发其他轴。
            var name = label.match(/【([^【】]+)】/);
            return name ? name[1] : label;
        });

        /** 读取站内资料，失败时保留现有正文，不生成空的外轴分组。 */
        function fetchResource(path, asJson) {
            var url = new URL(path, siteRoot).href;
            var key = url + (asJson ? ":json" : ":html");
            if (!resources.has(key)) {
                resources.set(key, fetch(url, { cache: "no-store" }).then(function(response) {
                    if (!response.ok) throw new Error("无法读取 " + path + "：" + response.status);
                    return asJson ? response.json() : response.text();
                }));
            }
            return resources.get(key);
        }

        /** 合并当前、历史及静态预览构筑名称，避免只检查第一份构筑。 */
        function collectDeckNames(snapshot, seriesMap) {
            var labels = seriesMap.pages && seriesMap.pages[pageName] || [];
            var entries = (snapshot.players || []).filter(function(entry) {
                return entry && entry.deck && entry.deck.code && labels.indexOf(entry.deck.main_category) !== -1;
            });
            var oldDeck = snapshot.old_decks && snapshot.old_decks[pageName];
            if (oldDeck && oldDeck.deck && oldDeck.deck.code) entries.push(oldDeck);
            return Array.from(new Set(staticDeckNames.concat(entries.map(function(entry) {
                return String(entry.deck.name || "");
            }))));
        }

        /** 按系列名及别名匹配构筑，英文名忽略大小写。 */
        function matchesCardRuling(deckNames, aliases) {
            return deckNames.some(function(deckName) {
                var name = deckName.toLocaleLowerCase();
                return aliases.some(function(alias) {
                    if (typeof alias !== "string" || !alias.length) return false;
                    var normalizedAlias = alias.toLocaleLowerCase();
                    // 时间黑魔术师属于城之内轴，先排除完整名称中的黑魔术师子串。
                    // 其余文字继续参与匹配，保留同时投入黑魔导的混合构筑。
                    var matchingName = normalizedAlias === "黑魔术师" ?
                        name.replace(/时间(?:之)?黑魔术师/g, "") : name;
                    return matchingName.indexOf(normalizedAlias) !== -1;
                });
            });
        }

        /** 以来源页面和自身栏目 ID 去重，重复加载不会追加相同内容。 */
        function hasSectionInclude(sourceUrl, sectionId) {
            return Array.prototype.some.call(entryContent.querySelectorAll("[data-ruling-source]"), function(include) {
                var source = include.getAttribute("data-ruling-source").trim();
                var separator = source.search(/\s/);
                if (separator === -1) return false;
                var selector = source.slice(separator).trim();
                var existingUrl = new URL(source.slice(0, separator), document.baseURI).href;
                return existingUrl === sourceUrl && selector.split(",").some(function(part) {
                    return part.trim().split(/[\s>+~,.:[\]]/)[0] === "#" + sectionId;
                });
            });
        }

        /** 五栏各自建立轴分组，已存在的折叠状态不因异步更新而重置。 */
        function getSectionContainer(title, source, sourceDocument) {
            var headings = Array.prototype.slice.call(entryContent.querySelectorAll("h2"));
            var heading = headings.find(function(node) { return node.textContent.trim() === title; });
            if (!heading) {
                heading = document.createElement("h2");
                heading.textContent = title;
                var following = headings.find(function(node) {
                    var order = sectionTitles.indexOf(node.textContent.trim());
                    return order > sectionTitles.indexOf(title) || /^卡组预览/.test(node.textContent.trim());
                });
                var followingNode = following && (following.closest(".ruling-section") || following);
                entryContent.insertBefore(heading, followingNode || null);
            }

            var groups = getRulingAxisGroups(heading);
            if (!groups) {
                // 单卡页的待核实内容仍保留独立栏目，不混入五栏中的确定结论。
                var numbered = heading.nextElementSibling;
                if (!numbered || !numbered.classList.contains("auto-number")) {
                    numbered = document.createElement("div");
                    numbered.className = "auto-number";
                    heading.insertAdjacentElement("afterend", numbered);
                }
                return numbered;
            }
            var sourceUrl = new URL(source.page, siteRoot).href;
            var axis = Array.prototype.find.call(groups.children, function(group) {
                var page = group.getAttribute("data-ruling-page");
                return page && new URL(page, document.baseURI).href === sourceUrl;
            });
            if (!axis) {
                axis = document.createElement("details");
                axis.className = "ruling-axis";
                axis.setAttribute("data-ruling-page", sourceUrl);
                // 动态新增轴默认收起；已经存在的轴不重新设置状态。
                axis.open = false;
                var summary = document.createElement("summary");
                var sourceTitle = sourceDocument.querySelector(".entry__title, title");
                summary.textContent = source.name || sourceTitle && sourceTitle.textContent.trim() || source.aliases[0];
                var axisContent = document.createElement("div");
                axisContent.className = "auto-number";
                axis.appendChild(summary);
                axis.appendChild(axisContent);
                // 无对应页面的遗留轴保持原位，新增轴放在通用互动组之前。
                groups.insertBefore(axis, groups.querySelector('[data-ruling-axis="general"]'));
            }
            // 自身没有条目而外轴有内容时，不展示空的自身轴折叠。
            groups.querySelectorAll('[data-ruling-own="true"]').forEach(function(own) {
                if (/^无[。.]?$/.test(own.textContent.trim())) {
                    var ownAxis = own.closest(".ruling-axis");
                    if (ownAxis && ownAxis !== axis) ownAxis.hidden = true;
                }
            });
            return axis.querySelector(".auto-number");
        }

        /** 只复制来源自身的正文；不执行来源脚本，不追踪其引入的其他轴。 */
        function appendCardSections(source, html) {
            var sourceUrl = new URL(source.page, siteRoot).href;
            var sourceDocument = new DOMParser().parseFromString(html, "text/html");
            var isDeckPage = new URL(sourceUrl).pathname.indexOf(deckDirectory) === 0;
            sourceDocument.querySelectorAll(".entry__content h2").forEach(function(heading) {
                var title = heading.textContent.trim();
                if (sectionTitles.indexOf(title) === -1) return;
                var frame = heading.closest(".ruling-section");
                // 卡组页必须明确标记自身资料；独立单卡页兼容原有编号容器。
                var section = frame && frame.querySelector('[data-ruling-own="true"]');
                if (!section && !isDeckPage) section = heading.nextElementSibling;
                if (!section || !section.id || !section.classList.contains("auto-number") ||
                    !section.textContent.trim() || /^无[。.]?$/.test(section.textContent.trim()) ||
                    hasSectionInclude(sourceUrl, section.id)) return;

                var target = getSectionContainer(title, source, sourceDocument);
                var include = document.createElement("div");
                include.className = "ruling-include";
                include.setAttribute("data-ruling-source", sourceUrl + " #" + section.id + " > *");
                Array.prototype.forEach.call(section.childNodes, function(node) {
                    include.appendChild(document.importNode(node, true));
                });
                // 来源中的嵌入入口及脚本不能成为下一层自动加载入口。
                include.querySelectorAll("script, [data-ruling-source]").forEach(function(node) { node.remove(); });
                include.querySelectorAll('a[href^="#"]').forEach(function(link) {
                    link.setAttribute("href", sourceUrl + link.getAttribute("href"));
                });
                resolveComponentUrls(include, sourceUrl);
                target.appendChild(include);
                document.dispatchEvent(new CustomEvent("rulinginclude:loaded", { detail: include }));
            });
        }

        Promise.all([
            fetchResource("data/mc-leaderboard.json", true),
            fetchResource("data/mc-series-pages.json", true),
            fetchResource("data/card-ruling-pages.json", true),
            fetchResource("data/deck-ruling-pages.json", true)
        ]).then(function(results) {
            var deckNames = collectDeckNames(results[0], results[1]);
            var currentUrl = new URL(window.location.href);
            currentUrl.hash = "";
            currentUrl.search = "";
            var seen = new Set();
            var sources = (results[3].pages || []).concat(results[2].cards || []).filter(function(source) {
                if (!source || typeof source.page !== "string" || !Array.isArray(source.aliases)) return false;
                var url = new URL(source.page, siteRoot).href;
                if (url === currentUrl.href || seen.has(url) || !matchesCardRuling(deckNames, source.aliases)) return false;
                seen.add(url);
                return true;
            });
            // 按配置顺序写入，网络完成顺序不影响页面分组顺序。
            return Promise.all(sources.map(function(source) {
                return fetchResource(source.page, false).then(function(html) {
                    return { source: source, html: html };
                }).catch(function(error) {
                    console.error("加载外轴资料失败:", source.page, error);
                    return null;
                });
            })).then(function(loaded) {
                loaded.forEach(function(item) {
                    if (item) appendCardSections(item.source, item.html);
                });
            });
        }).catch(function(error) {
            console.error("按构筑引入资料失败:", error);
        });
    };

   /* 分轴栏目保留声明的状态；构筑预览首次收起，后续保留用户切换的状态。
    * ------------------------------------------------------ */
    var ssDefaultFolds = function() {
        // 按元素身份记录初始化状态，复制或异步新增的折叠仍会单独初始化。
        var initializedDetails = new WeakSet();

        function initializeDetail(detail) {
            if (initializedDetails.has(detail)) return;
            initializedDetails.add(detail);
            // 大折叠、轴内子模块及构筑预览均只在首次初始化时收起。
            detail.open = false;
        }

        // 同时处理新增节点自身及其后代，覆盖轴分组和构筑预览。
        function initializeTree(root) {
            if (root.nodeType !== 1 && root.nodeType !== 9) return;
            if (root.nodeType === 1 && root.matches("details")) initializeDetail(root);
            root.querySelectorAll("details").forEach(initializeDetail);
        }

        initializeTree(document);
        // 只检查新插入的节点，不监听 open 属性，避免重置用户操作。
        var observer = new MutationObserver(function(records) {
            records.forEach(function(record) {
                record.addedNodes.forEach(initializeTree);
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };

   /* 五个板块统一提供整栏折叠，首次加载全部收起。
    * ------------------------------------------------------ */
    var ssFoldRulings = function() {
        // 只处理卡组页面，避免影响独立卡片资料页的同名栏目。
        var deckDirectory = new URL("decks/", siteRoot).pathname;
        if (window.location.pathname.indexOf(deckDirectory) !== 0) return;

        document.querySelectorAll(".entry__content h2").forEach(function(heading) {
            // 先补齐五栏外框，再为五个栏目统一处理整栏折叠。
            getRulingAxisGroups(heading);
            var sectionTitle = heading.textContent.trim();
            // 五栏共用大折叠规则，兼容静态容器及异步新增的栏目。
            var foldTitles = ["裁定", "注意", "持续适用的效果", "自肃", "召唤条件"];
            if (foldTitles.indexOf(sectionTitle) === -1) return;

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
                // “无”及已隐藏的空轴不是有效条目，不计入整栏总数。
                if (!element.textContent.trim() || /^无[。.]?$/.test(element.textContent.trim())) return false;
                if (element.closest("blockquote, .effect-text, [hidden]")) return false;
                if (element.matches(".ruling-entry")) {
                    return !element.parentElement.closest(".ruling-entry");
                }
                return !element.closest(".ruling-entry");
            }).length;

            // 仅在首次创建时设置默认收起，异步更新复用原有展开状态。
            if (!hasFold) {
                fold = document.createElement("details");
                fold.className = "ruling-fold";
                // 只在首次创建时设置默认值；后续异步计数更新不改变用户状态。
                fold.open = false;
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
            
            // 先初始化默认收起规则，覆盖静态内容及随后异步插入的折叠框。
            ssDefaultFolds();
            // 先加载公共组件
            ssLoadComponents();
            // 先绑定动态内容通知，再初始化五栏折叠及启动公共内容加载。
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
