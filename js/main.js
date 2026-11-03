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

   /* 卡组裁定与注意默认折叠，保留原有内容与编号容器。
    * ------------------------------------------------------ */
    var ssFoldRulings = function() {
        // 只处理卡组页面，避免影响独立卡片资料页的同名栏目。
        var deckDirectory = new URL("decks/", siteRoot).pathname;
        if (window.location.pathname.indexOf(deckDirectory) !== 0) return;

        document.querySelectorAll(".entry__content h2").forEach(function(heading) {
            // 两个栏目独立折叠，条数只用于显示，不影响默认收起状态。
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

            // 即使栏目为空，也创建默认收起的容器，动态加载后继续复用。
            if (!hasFold) {
                fold = document.createElement("details");
                fold.className = "ruling-fold";
                var summary = document.createElement("summary");
                content = document.createElement("div");
                content.className = "ruling-fold__content";
                fold.appendChild(summary);
                fold.appendChild(content);
                heading.parentNode.insertBefore(fold, heading.nextSibling);
                nodes.forEach(function(node) { content.appendChild(node); });

                // 原生details支持鼠标及键盘操作，切换时同步入口文案。
                fold.addEventListener("toggle", function() {
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
