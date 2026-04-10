(function () {
    const CARD_API_BASE = 'https://ygocdb.com/api/v0';
    const CARD_PAGE_BASE = 'https://ygocdb.com/card';
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

        if (!iframe) {
            return;
        }

        const lines = rawEl.innerText
            .split(/\r?\n/)
            .map((line) => line.trim());

        let currentGrid = null;
        let hideTimeout = null;

        const gap = 12;
        const viewPadding = 8;

        function createSection(title) {
            const section = document.createElement('div');
            section.className = 'deck-section';

            const header = document.createElement('div');
            header.className = 'deck-title';
            header.innerText = title;

            const grid = document.createElement('div');
            grid.className = 'card-grid';

            section.appendChild(header);
            section.appendChild(grid);
            renderEl.appendChild(section);

            currentGrid = grid;
        }

        function showHover(img, id) {
            clearTimeout(hideTimeout);

            iframe.src = `${CARD_PAGE_BASE}/${id}`;
            hoverEl.style.display = 'block';

            const rect = img.getBoundingClientRect();
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

        function hideHover() {
            hideTimeout = setTimeout(() => {
                hoverEl.style.display = 'none';
                iframe.src = '';
            }, 150);
        }

        hoverEl.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
        hoverEl.addEventListener('mouseleave', hideHover);

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
                const img = document.createElement('img');
                img.src = `https://cdn.233.momobako.com/ygoimg/jp/${line}.webp!half`;
                img.alt = line;

                img.addEventListener('mouseenter', () => showHover(img, line));
                img.addEventListener('mouseleave', hideHover);

                currentGrid.appendChild(img);
            }
        });
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

    function pickBestSearchResult(query, results) {
        if (!Array.isArray(results) || results.length === 0) {
            return null;
        }

        const normalizedQuery = normalizeCardName(query);
        const exactMatches = results.filter((item) =>
            getSearchNames(item).some((name) => normalizeCardName(name) === normalizedQuery)
        );

        if (exactMatches.length > 0) {
            return exactMatches.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
        }

        const highWeightMatch = results.find((item) => Number(item?.weight) >= 100);

        return highWeightMatch || results[0];
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
                const match = pickBestSearchResult(cacheKey, searchData?.result || []);

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

    function wrapQuotedCardNames(root) {
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

                if (isLikelyCardName(rawName)) {
                    const trigger = document.createElement('span');
                    trigger.className = 'card-effect-trigger';
                    trigger.dataset.cardName = rawName;
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

    function initQuotedCardEffectHover() {
        const contentRoots = document.querySelectorAll('.entry__content');

        if (contentRoots.length === 0) {
            return;
        }

        contentRoots.forEach((root) => wrapQuotedCardNames(root));

        const tooltip = ensureEffectTooltip();
        const triggers = document.querySelectorAll('.card-effect-trigger');
        let activeTrigger = null;

        function hideTooltip(trigger) {
            if (trigger && activeTrigger && activeTrigger !== trigger) {
                return;
            }

            activeTrigger = null;
            tooltip.classList.remove('is-visible', 'is-loading');
        }

        triggers.forEach((trigger) => {
            trigger.addEventListener('mouseenter', async (event) => {
                const cardName = trigger.dataset.cardName;

                if (!cardName) {
                    return;
                }

                activeTrigger = trigger;
                tooltip.classList.add('is-visible', 'is-loading');
                updateTooltipContent(tooltip, {
                    name: cardName,
                    meta: '\u6b63\u5728\u52a0\u8f7d\u6548\u679c...',
                    desc: ''
                });
                setTooltipPosition(tooltip, trigger, event.clientX, event.clientY);

                const card = await resolveCardByName(cardName);

                if (activeTrigger !== trigger) {
                    return;
                }

                tooltip.classList.remove('is-loading');

                if (!card?.text) {
                    updateTooltipContent(tooltip, {
                        name: cardName,
                        meta: '\u672a\u627e\u5230\u5bf9\u5e94\u5361\u7247',
                        desc: ''
                    });
                    setTooltipPosition(tooltip, trigger, event.clientX, event.clientY);
                    return;
                }

                updateTooltipContent(tooltip, {
                    name: card.text.name || cardName,
                    meta: [card.text.types, card.id ? `\u5bc6\u7801\uff1a${card.id}` : ''].filter(Boolean).join('\n'),
                    desc: card.text.desc || ''
                });
                trigger.dataset.cardId = String(card.id || '');
                setTooltipPosition(tooltip, trigger, event.clientX, event.clientY);
            });

            trigger.addEventListener('mousemove', (event) => {
                if (activeTrigger !== trigger || !tooltip.classList.contains('is-visible')) {
                    return;
                }

                setTooltipPosition(tooltip, trigger, event.clientX, event.clientY);
            });

            trigger.addEventListener('mouseleave', () => hideTooltip(trigger));

            trigger.addEventListener('click', () => {
                const cardId = trigger.dataset.cardId;

                if (cardId) {
                    window.open(`${CARD_PAGE_BASE}/${cardId}`, '_blank', 'noopener');
                }
            });
        });

        window.addEventListener('scroll', () => hideTooltip(), true);
        window.addEventListener('resize', () => hideTooltip());
    }

    initDeckViewer();
    initQuotedCardEffectHover();
})();
