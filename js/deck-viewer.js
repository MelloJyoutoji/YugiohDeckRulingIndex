(function () {
    const CARD_API_BASE = 'https://ygocdb.com/api/v0';
    const CARD_PAGE_BASE = 'https://ygocdb.com/card';
    const CARD_IMAGE_FALLBACK_BASE = 'https://cdntx.moecube.com/ygopro-super-pre/data/pics';
    const QUOTED_CARD_PATTERN = /\u300c([^\u300c\u300d]+?)\u300d/g;
    const searchCache = new Map();
    const cardCache = new Map();

    function initDeckViewer() {
        const rawEl = document.getElementById('deck-raw');
        const renderEl = document.getElementById('deck-render');
        const hoverEl = document.getElementById('card-hover');

        if (!rawEl || !renderEl || !hoverEl) {
            return;
        }

        const iframe = hoverEl.querySelector('iframe');
        let loadingEl = hoverEl.querySelector('.card-hover__loading');

        if (!iframe) {
            return;
        }

        if (!loadingEl) {
            loadingEl = document.createElement('div');
            loadingEl.className = 'card-hover__loading';
            loadingEl.innerHTML = '<div class="card-hover__spinner" aria-hidden="true"></div>';
            hoverEl.appendChild(loadingEl);
        }

        const lines = rawEl.innerText
            .split(/\r?\n/)
            .map((line) => line.trim());

        // 无 JSON 历史时保留的静态构筑，使用可见文字标明 old。
        if (rawEl.dataset.old === 'true' && lines.some((line) => /^\d+$/.test(line))) {
            const oldLabel = document.createElement('p');
            oldLabel.className = 'mc-previews-meta';
            oldLabel.textContent = 'old · 历史构筑';
            renderEl.appendChild(oldLabel);
        }

        let currentGrid = null;
        let hideTimeout = null;
        let activeHoverCardId = '';
        let pinnedImg = null;

        const gap = 12;
        const viewPadding = 8;

        // 旧卡组和折叠卡组共用分组容器。
        function createSection(title, container = renderEl) {
            const target = container || renderEl;
            if (!target) {
                return null;
            }

            const section = document.createElement('div');
            section.className = 'deck-section';

            const header = document.createElement('div');
            header.className = 'deck-title';

            // 分离两端标题，手机端展示中文名称，桌面端保留原有文字。
            const desktopTitle = document.createElement('span');
            desktopTitle.className = 'deck-title__desktop';
            desktopTitle.textContent = title;
            const mobileTitle = document.createElement('span');
            mobileTitle.className = 'deck-title__mobile';
            // 分享码标题带有张数后缀，先提取分组标识以兼容旧格式卡组。
            const sectionType = title.split(' · ')[0];
            const sectionNames = { MAIN: '主卡组', EXTRA: '额外卡组', SIDE: '副卡组', SpareCards: '副卡组' };
            const sectionName = document.createElement('span');
            sectionName.textContent = sectionNames[sectionType] || sectionType;
            const sectionCount = document.createElement('span');
            sectionCount.className = 'deck-title__count';
            mobileTitle.append(sectionName, sectionCount);
            header.append(desktopTitle, mobileTitle);

            const grid = document.createElement('div');
            grid.className = 'card-grid';
            // 保留主卡组标识，所有分组的手机端列数由统一样式控制。
            if (sectionType === 'MAIN') {
                grid.classList.add('card-grid--main');
            }

            section.appendChild(header);
            section.appendChild(grid);
            target.appendChild(section);

            currentGrid = grid;
            return grid;
        }

        // 按实际渲染的卡图统计张数，同时兼容静态卡组与首次展开的分享码卡组。
        function updateSectionCounts(container) {
            container.querySelectorAll('.deck-section').forEach((section) => {
                const grid = section.querySelector('.card-grid');
                const count = section.querySelector('.deck-title__count');
                if (grid && count) {
                    count.textContent = `${grid.children.length} 张`;
                }
            });
        }

        function positionHover(trigger) {
            const rect = trigger.getBoundingClientRect();
            const hoverWidth = hoverEl.offsetWidth;
            const hoverHeight = hoverEl.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let left = rect.right + gap;

            if (left + hoverWidth + viewPadding > viewportWidth) {
                left = rect.left - hoverWidth - gap;
            }

            if (left < viewPadding) {
                left = viewPadding;
            }

            let top = rect.top;

            if (top + hoverHeight + viewPadding > viewportHeight) {
                top = viewportHeight - hoverHeight - viewPadding;
            }

            if (top < viewPadding) {
                top = viewPadding;
            }

            hoverEl.style.left = `${left}px`;
            hoverEl.style.top = `${top}px`;
        }

        function showHover(img, id, options) {
            const shouldPin = Boolean(options?.pin);

            clearTimeout(hideTimeout);

            hoverEl.style.display = 'block';
            hoverEl.classList.toggle('is-pinned', shouldPin);

            if (shouldPin) {
                pinnedImg = img;
            }

            if (activeHoverCardId !== String(id)) {
                activeHoverCardId = String(id);
                hoverEl.classList.add('is-loading');
                iframe.src = `${CARD_PAGE_BASE}/${id}`;
            }

            positionHover(img);
        }

        function hideHover(force) {
            if (!force && pinnedImg) {
                return;
            }

            clearTimeout(hideTimeout);

            if (force) {
                hoverEl.style.display = 'none';
                hoverEl.classList.remove('is-loading', 'is-pinned');
                pinnedImg = null;
                return;
            }

            hideTimeout = setTimeout(() => {
                if (!force && pinnedImg) {
                    return;
                }

                hoverEl.style.display = 'none';
                hoverEl.classList.remove('is-loading', 'is-pinned');
                pinnedImg = null;
            }, 150);
        }

        // 所有卡组统一创建卡图，包含先行卡图片回退、悬浮和点击固定详情。
        function createCardImage(cardId, lazy = false) {
            const img = document.createElement('img');
            img.src = `https://cdn.233.momobako.com/ygoimg/jp/${cardId}.webp!half`;
            img.alt = String(cardId);
            if (lazy) {
                img.loading = 'lazy';
            }

            img.addEventListener('error', () => {
                img.src = `${CARD_IMAGE_FALLBACK_BASE}/${cardId}.jpg`;
            }, { once: true });

            img.addEventListener('mouseenter', () => {
                if (pinnedImg && pinnedImg !== img) {
                    return;
                }

                showHover(img, cardId, {});
            });

            img.addEventListener('mouseleave', () => hideHover(false));

            img.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                showHover(img, cardId, { pin: true });
            });

            return img;
        }

        // 分享码以位流保存主卡组、额外卡组和副卡组的卡号及张数。
        function decodeDeckCode(code) {
            const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
            const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
            const bits = Array.from(bytes, (byte) => byte.charCodeAt(0).toString(2).padStart(8, '0')).join('');
            const sections = [
                { title: 'MAIN', count: parseInt(bits.slice(0, 8), 2) },
                { title: 'EXTRA', count: parseInt(bits.slice(8, 12), 2) },
                { title: 'SIDE', count: parseInt(bits.slice(12, 16), 2) },
            ];
            let bitOffset = 16;

            return sections.map(({ title, count }) => {
                // 当前分组按张数展开后的卡号。
                const cardIds = Array.from({ length: 0 }, () => 0);
                for (let index = 0; index < count; index++) {
                    const record = bits.slice(bitOffset, bitOffset + 29);
                    if (record.length !== 29) {
                        throw new Error('Incomplete deck code');
                    }

                    const copies = parseInt(record.slice(0, 2), 2);
                    const cardId = parseInt(record.slice(2), 2);
                    if (!copies || !cardId) {
                        throw new Error('Invalid deck code');
                    }

                    for (let copy = 0; copy < copies; copy++) {
                        cardIds.push(cardId);
                    }
                    bitOffset += 29;
                }

                return { title, cardIds };
            });
        }

        iframe.addEventListener('load', () => {
            hoverEl.classList.remove('is-loading');
        });

        hoverEl.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
        hoverEl.addEventListener('mouseleave', () => hideHover(false));

        document.addEventListener('click', (event) => {
            if (!(event.target instanceof Element)) {
                hideHover(true);
                return;
            }

            if (event.target.closest('.card-grid img') || event.target.closest('#card-hover')) {
                return;
            }

            hideHover(true);
        });

        window.addEventListener('scroll', () => hideHover(true), true);
        window.addEventListener('resize', () => {
            if (pinnedImg) {
                positionHover(pinnedImg);
                return;
            }

            hideHover(true);
        });

        lines.forEach((line) => {
            if (!line) {
                return;
            }

            if (line.startsWith('#created')) {
                return;
            }

            if (line === '#main') {
                createSection('MAIN');
                return;
            }

            if (line === '#extra') {
                createSection('EXTRA');
                return;
            }

            if (line === '!spareCards') {
                createSection('SpareCards');
                return;
            }

            if (/^\d+$/.test(line) && currentGrid) {
                currentGrid.appendChild(createCardImage(line));
            }
        });

        updateSectionCounts(renderEl);

        // 给单条折叠预览绑定首次展开解码。动态插入的前排卡组也会复用这里。
        function bindDeckPreview(preview) {
            if (!(preview instanceof HTMLDetailsElement) || preview.dataset.previewBound === 'true') {
                return;
            }

            // previewBound 防止同一节点被重复绑定 toggle。
            preview.dataset.previewBound = 'true';
            preview.addEventListener('toggle', () => {
                if (!preview.open || preview.dataset.rendered === 'true') {
                    return;
                }

                const container = preview.querySelector('.deck-render');
                if (!(container instanceof HTMLElement)) {
                    return;
                }

                try {
                    const sections = decodeDeckCode(preview.dataset.deckCode);
                    sections.forEach(({ title, cardIds }) => {
                        if (!cardIds.length) {
                            return;
                        }

                        const grid = createSection(`${title} · ${cardIds.length}`, container);
                        if (grid) {
                            cardIds.forEach((cardId) => grid.appendChild(createCardImage(cardId, true)));
                        }
                    });
                    updateSectionCounts(container);
                    preview.dataset.rendered = 'true';
                } catch (error) {
                    container.textContent = '卡组数据解析失败，请使用原链接查看。';
                }
            });
        }

        // 扫描根节点下尚未绑定的折叠卡组。
        function bindDeckPreviews(root) {
            const scope = root instanceof Element ? root : document;
            scope.querySelectorAll('.deck-preview[data-deck-code]').forEach(bindDeckPreview);
        }

        bindDeckPreviews(document);
        window.DeckViewer = window.DeckViewer || {};
        window.DeckViewer.bindPreviews = bindDeckPreviews;
    }

    function normalizeCardName(value) {
        return String(value || '')
            .normalize('NFKC')
            .replace(/\s+/g, '')
            .trim()
            .toLowerCase();
    }

    function isLikelyCardName(value) {
        const name = String(value || '').trim();

        if (!name || name.length > 40) {
            return false;
        }

        return !/[\uFF0C\u3002\uFF1B\uFF1A:\u3001\uFF01\uFF1F!?]/.test(name);
    }

    function getSearchNames(result) {
        return [
            result?.cn_name,
            result?.sc_name,
            result?.md_name,
            result?.nwbbs_n,
            result?.cnocg_n,
            result?.jp_name,
            result?.en_name,
            result?.text?.name
        ].filter(Boolean);
    }

    function pickExactSearchResult(query, results) {
        if (!Array.isArray(results) || results.length === 0) {
            return null;
        }

        const normalizedQuery = normalizeCardName(query);
        const exactMatches = results.filter((item) =>
            getSearchNames(item).some((name) => normalizeCardName(name) === normalizedQuery)
        );

        if (exactMatches.length === 0) {
            return null;
        }

        return exactMatches.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        return response.json();
    }

    function resolveCardByName(name) {
        const cacheKey = String(name || '').trim();

        if (!cacheKey) {
            return Promise.resolve(null);
        }

        if (!searchCache.has(cacheKey)) {
            const request = (async () => {
                const searchData = await fetchJson(`${CARD_API_BASE}/?search=${encodeURIComponent(cacheKey)}`);
                const match = pickExactSearchResult(cacheKey, searchData?.result || []);

                if (!match?.id) {
                    return null;
                }

                const cardId = String(match.id);

                if (!cardCache.has(cardId)) {
                    cardCache.set(
                        cardId,
                        fetchJson(`${CARD_API_BASE}/card/${encodeURIComponent(cardId)}`).catch(() => null)
                    );
                }

                return cardCache.get(cardId);
            })().catch(() => null);

            searchCache.set(cacheKey, request);
        }

        return searchCache.get(cacheKey);
    }

    function ensureEffectTooltip() {
        let tooltip = document.getElementById('card-effect-hover');

        if (tooltip) {
            return tooltip;
        }

        tooltip = document.createElement('div');
        tooltip.id = 'card-effect-hover';
        tooltip.innerHTML = [
            '<div class="card-effect-hover__name"></div>',
            '<div class="card-effect-hover__meta"></div>',
            '<div class="card-effect-hover__desc"></div>'
        ].join('');

        document.body.appendChild(tooltip);
        return tooltip;
    }

    function setTooltipPosition(tooltip, trigger, clientX, clientY) {
        const gap = 14;
        const padding = 8;
        const triggerRect = trigger.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let left = typeof clientX === 'number' ? clientX + gap : triggerRect.right + gap;
        let top = typeof clientY === 'number' ? clientY + gap : triggerRect.bottom + gap;

        if (left + tooltipRect.width + padding > window.innerWidth) {
            left = triggerRect.left - tooltipRect.width - gap;
        }

        if (left < padding) {
            left = padding;
        }

        if (top + tooltipRect.height + padding > window.innerHeight) {
            top = window.innerHeight - tooltipRect.height - padding;
        }

        if (top < padding) {
            top = padding;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function updateTooltipContent(tooltip, options) {
        const nameEl = tooltip.querySelector('.card-effect-hover__name');
        const metaEl = tooltip.querySelector('.card-effect-hover__meta');
        const descEl = tooltip.querySelector('.card-effect-hover__desc');

        if (!nameEl || !metaEl || !descEl) {
            return;
        }

        nameEl.textContent = options.name || '';
        metaEl.textContent = options.meta || '';
        descEl.textContent = options.desc || '';
        tooltip.classList.toggle('is-empty', !options.desc);
    }

    function collectQuotedTextNodes(root) {
        const textNodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;

            if (!parent || !node.nodeValue || !node.nodeValue.includes('\u300c')) {
                continue;
            }

            if (parent.closest('script, style, textarea, code, pre, a, #deck-raw, #deck-render, #card-hover, #card-effect-hover')) {
                continue;
            }

            textNodes.push(node);
        }

        return textNodes;
    }

    function collectQuotedCardNames(roots) {
        const names = new Set();

        roots.forEach((root) => {
            collectQuotedTextNodes(root).forEach((node) => {
                const text = node.nodeValue || '';

                QUOTED_CARD_PATTERN.lastIndex = 0;

                let match = QUOTED_CARD_PATTERN.exec(text);

                while (match) {
                    const rawName = match[1].trim();

                    if (isLikelyCardName(rawName)) {
                        names.add(rawName);
                    }

                    match = QUOTED_CARD_PATTERN.exec(text);
                }
            });
        });

        return Array.from(names);
    }

    async function buildResolvedCardMap(cardNames) {
        const resolvedMap = new Map();

        await Promise.all(
            cardNames.map(async (cardName) => {
                const card = await resolveCardByName(cardName);

                if (card?.id && card?.text) {
                    resolvedMap.set(normalizeCardName(cardName), card);
                }
            })
        );

        return resolvedMap;
    }

    function wrapQuotedCardNames(root, resolvedCardMap) {
        const textNodes = collectQuotedTextNodes(root);

        textNodes.forEach((node) => {
            const text = node.nodeValue;

            if (!text) {
                return;
            }

            QUOTED_CARD_PATTERN.lastIndex = 0;

            let cursor = 0;
            let hasReplacement = false;
            let match = QUOTED_CARD_PATTERN.exec(text);
            const fragment = document.createDocumentFragment();

            while (match) {
                const fullMatch = match[0];
                const rawName = match[1].trim();
                const matchIndex = match.index;

                if (matchIndex > cursor) {
                    fragment.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
                }

                const resolvedCard = resolvedCardMap.get(normalizeCardName(rawName));

                if (isLikelyCardName(rawName) && resolvedCard) {
                    const trigger = document.createElement('span');
                    trigger.className = 'card-effect-trigger';
                    trigger.dataset.cardKey = normalizeCardName(rawName);
                    trigger.dataset.cardName = resolvedCard.text.name || rawName;
                    trigger.dataset.cardId = String(resolvedCard.id);
                    trigger.textContent = fullMatch;
                    fragment.appendChild(trigger);
                    hasReplacement = true;
                } else {
                    fragment.appendChild(document.createTextNode(fullMatch));
                }

                cursor = matchIndex + fullMatch.length;
                match = QUOTED_CARD_PATTERN.exec(text);
            }

            if (!hasReplacement) {
                return;
            }

            if (cursor < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(cursor)));
            }

            node.parentNode.replaceChild(fragment, node);
        });
    }

    function showEffectTooltip(tooltip, trigger, card, clientX, clientY, options) {
        updateTooltipContent(tooltip, {
            name: card.text.name || trigger.dataset.cardName || '',
            meta: [card.text.types, card.id ? `\u5bc6\u7801\uff1a${card.id}` : ''].filter(Boolean).join('\n'),
            desc: card.text.desc || ''
        });
        tooltip.classList.add('is-visible');
        tooltip.classList.remove('is-loading');
        tooltip.classList.toggle('is-pinned', Boolean(options?.pin));
        setTooltipPosition(tooltip, trigger, clientX, clientY);
    }

    async function initQuotedCardEffectHover(contentRoots = Array.from(document.querySelectorAll('.entry__content'))) {

        if (contentRoots.length === 0) {
            return;
        }

        const candidateNames = collectQuotedCardNames(Array.from(contentRoots));
        const resolvedCardMap = await buildResolvedCardMap(candidateNames);

        if (resolvedCardMap.size === 0) {
            return;
        }

        contentRoots.forEach((root) => wrapQuotedCardNames(root, resolvedCardMap));

        const tooltip = ensureEffectTooltip();
        const triggers = contentRoots.flatMap((root) =>
            Array.from(root.querySelectorAll('.card-effect-trigger'))
        );
        let activeTrigger = null;
        let pinnedTrigger = null;
        let hideTimeout = null;

        function queueHideTooltip(force) {
            if (!force && pinnedTrigger) {
                return;
            }

            clearTimeout(hideTimeout);

            if (force) {
                activeTrigger = null;
                pinnedTrigger = null;
                tooltip.classList.remove('is-visible', 'is-loading', 'is-pinned');
                return;
            }

            hideTimeout = setTimeout(() => {
                if (!force && pinnedTrigger) {
                    return;
                }

                activeTrigger = null;
                pinnedTrigger = null;
                tooltip.classList.remove('is-visible', 'is-loading', 'is-pinned');
            }, 120);
        }

        function getResolvedCard(trigger) {
            const cardId = trigger.dataset.cardId;
            const cardKey = trigger.dataset.cardKey;

            if (!cardId || !cardKey) {
                return null;
            }

            return resolvedCardMap.get(cardKey) || null;
        }

        triggers.forEach((trigger) => {
            trigger.addEventListener('mouseenter', (event) => {
                if (pinnedTrigger && pinnedTrigger !== trigger) {
                    return;
                }

                const card = getResolvedCard(trigger);

                if (!card?.text) {
                    return;
                }

                clearTimeout(hideTimeout);
                activeTrigger = trigger;
                showEffectTooltip(tooltip, trigger, card, event.clientX, event.clientY);
            });

            trigger.addEventListener('mousemove', (event) => {
                if (activeTrigger !== trigger || !tooltip.classList.contains('is-visible')) {
                    return;
                }

                setTooltipPosition(tooltip, trigger, event.clientX, event.clientY);
            });

            trigger.addEventListener('mouseleave', () => queueHideTooltip(false));

            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                const card = getResolvedCard(trigger);

                if (!card?.text) {
                    return;
                }

                clearTimeout(hideTimeout);
                activeTrigger = trigger;
                pinnedTrigger = trigger;
                showEffectTooltip(tooltip, trigger, card, undefined, undefined, { pin: true });
            });
        });

        document.addEventListener('click', (event) => {
            if (event.target instanceof Element && event.target.closest('.card-effect-trigger')) {
                return;
            }

            queueHideTooltip(true);
        });
        window.addEventListener('scroll', () => queueHideTooltip(true), true);
        window.addEventListener('resize', () => {
            if (pinnedTrigger && tooltip.classList.contains('is-visible')) {
                const card = getResolvedCard(pinnedTrigger);

                if (card?.text) {
                    showEffectTooltip(tooltip, pinnedTrigger, card, undefined, undefined, { pin: true });
                }

                return;
            }

            queueHideTooltip(true);
        });
    }

    initDeckViewer();
    initQuotedCardEffectHover();
    document.addEventListener('rulinginclude:loaded', (event) => {
        if (event instanceof CustomEvent && event.detail instanceof Element) {
            initQuotedCardEffectHover([event.detail]);
        }
    });
})();
