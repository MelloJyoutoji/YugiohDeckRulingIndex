(function () {
    const CARD_API_BASE = 'https://ygocdb.com/api/v0';
    const CARD_IMAGE_FALLBACK_BASE = 'https://cdntx.moecube.com/ygopro-super-pre/data/pics';
    // 统一回退链的补充图源，按卡片密码覆盖旧图床缺失的新卡。
    const CARD_IMAGE_SECONDARY_FALLBACK_BASE = 'https://images.ygoprodeck.com/images/cards';
    const QUOTED_CARD_PATTERN = /\u300c([^\u300c\u300d]+?)\u300d/g;
    const searchCache = new Map();
    const cardCache = new Map();
    // 简版与完整资料分开保存；持久缓存最多一天，刷新后仍可直接阅读。
    const cardDetailCache = new Map();
    const CARD_CACHE_KEY = 'deck-viewer:cards:v1';
    const CARD_CACHE_TTL = 24 * 60 * 60 * 1000;
    const CARD_CACHE_LIMIT = 150;
    const CARD_CACHE_MAX_CHARS = 1500000;
    const storedCards = new Map();
    let storedCardsLoaded = false;
    // 最多三条 API 请求，其中后台卡名查询最多一条，为交互预留连接。
    const apiQueue = [];
    let activeApiRequests = 0;
    let activeBackgroundRequests = 0;

    /** 缓存不可用、损坏或过期时回退到网络，不影响页面交互。 */
    function readStoredCard(key) {
        if (!storedCardsLoaded) {
            storedCardsLoaded = true;
            try {
                const saved = JSON.parse(window.localStorage.getItem(CARD_CACHE_KEY) || '[]');
                if (Array.isArray(saved)) {
                    saved.slice(-CARD_CACHE_LIMIT).forEach((entry) => {
                        if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]?.expires > Date.now()) {
                            storedCards.set(entry[0], entry[1]);
                        }
                    });
                }
            } catch (error) {
                // 隐私模式和存储异常只禁用本地命中，不阻断 API 请求。
            }
        }
        const entry = storedCards.get(key);
        if (!entry || entry.expires <= Date.now() || !entry.card?.id || !entry.card?.text) {
            storedCards.delete(key);
            return null;
        }
        return entry.card;
    }

    /** 有界保存成功资料；淘汰最早写入项，避免 FAQ 占满浏览器存储。 */
    function storeCard(key, card) {
        readStoredCard(key);
        storedCards.delete(key);
        storedCards.set(key, { expires: Date.now() + CARD_CACHE_TTL, card });
        for (const [entryKey, entry] of storedCards) {
            if (entry.expires <= Date.now()) {
                storedCards.delete(entryKey);
            }
        }
        while (storedCards.size > CARD_CACHE_LIMIT) {
            storedCards.delete(storedCards.keys().next().value);
        }
        let serialized = JSON.stringify(Array.from(storedCards));
        while (serialized.length > CARD_CACHE_MAX_CHARS && storedCards.size) {
            storedCards.delete(storedCards.keys().next().value);
            serialized = JSON.stringify(Array.from(storedCards));
        }
        try {
            window.localStorage.setItem(CARD_CACHE_KEY, serialized);
        } catch (error) {
            // 存储配额不足时仍保留本次页面内存中的资料。
        }
    }

    /** 交互请求排在后台查询前；超时从真正开始 fetch 时计算。 */
    function drainApiQueue() {
        while (activeApiRequests < 3) {
            let index = apiQueue.findIndex((job) => job.foreground);
            if (index < 0 && activeBackgroundRequests === 0) {
                index = apiQueue.findIndex((job) => !job.foreground);
            }
            if (index < 0) {
                return;
            }
            const job = apiQueue.splice(index, 1)[0];
            activeApiRequests += 1;
            if (!job.foreground) {
                activeBackgroundRequests += 1;
            }
            job.run().finally(() => {
                activeApiRequests -= 1;
                if (!job.foreground) {
                    activeBackgroundRequests -= 1;
                }
                drainApiQueue();
            });
        }
    }

    /** 请求支持排队取消、在途取消及超时；前台临时故障自动重试一次。 */
    function fetchJson(url, { foreground = false, signal } = {}) {
        return new Promise((resolve, reject) => {
            const cancelError = () => new DOMException('Request cancelled', 'AbortError');
            if (signal?.aborted) {
                reject(cancelError());
                return;
            }
            let running = false;
            let controller = null;
            const cancel = () => {
                if (running) {
                    controller?.abort();
                } else {
                    const index = apiQueue.indexOf(job);
                    if (index >= 0) {
                        apiQueue.splice(index, 1);
                    }
                    reject(cancelError());
                }
            };
            const job = { foreground, run: async () => {
                running = true;
                try {
                    for (let attempt = 0; attempt < (foreground ? 2 : 1); attempt++) {
                        if (signal?.aborted) {
                            throw cancelError();
                        }
                        controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 12000);
                        try {
                            const response = await fetch(url, {
                                headers: { Accept: 'application/json' },
                                signal: controller.signal
                            });
                            if (!response.ok) {
                                const error = new Error(`Request failed: ${response.status}`);
                                error.status = response.status;
                                throw error;
                            }
                            resolve(await response.json());
                            return;
                        } catch (error) {
                            if (signal?.aborted || !foreground || attempt > 0 || (error.status && error.status < 500 && error.status !== 429)) {
                                throw error;
                            }
                        } finally {
                            clearTimeout(timeout);
                        }
                    }
                } catch (error) {
                    reject(error);
                } finally {
                    signal?.removeEventListener('abort', cancel);
                }
            } };
            signal?.addEventListener('abort', cancel, { once: true });
            apiQueue.push(job);
            drainApiQueue();
        });
    }

    /** 读取卡片简版或完整版；两种结构都保留为各自的缓存，不混用。 */
    function getCachedCard(cardId, complete = false) {
        const key = String(cardId);
        const cache = complete ? cardDetailCache : cardCache;
        const card = cache.get(key) || readStoredCard(`${complete ? 'full' : 'basic'}:${key}`);
        if (card) {
            cache.set(key, card);
        }
        return card || null;
    }

    /** 交互请求由当前浮窗持有，切卡即可取消，失败结果不会进入缓存。 */
    async function fetchCardDetail(cardId, complete, signal) {
        const key = String(cardId);
        const cached = getCachedCard(key, complete);
        if (cached) {
            return cached;
        }
        const card = await fetchJson(`${CARD_API_BASE}/card/${encodeURIComponent(key)}${complete ? '?show=all' : ''}`, { foreground: true, signal });
        if (!card?.id || !card.text) {
            throw new Error('Invalid card detail');
        }
        (complete ? cardDetailCache : cardCache).set(key, card);
        storeCard(`${complete ? 'full' : 'basic'}:${key}`, card);
        return card;
    }

    /** 仅保留资料正文所需的标记，并将百鸽相对链接转换为绝对链接。 */
    function appendCardDetailHtml(container, html) {
        const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const allowedTags = new Set(['A', 'BR', 'P', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'B', 'STRONG', 'I', 'EM', 'SUP', 'SUB', 'S', 'DEL']);
        function appendNode(parent, node) {
            if (node.nodeType === Node.TEXT_NODE) {
                parent.appendChild(document.createTextNode(node.textContent));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(node.tagName)) {
                return;
            }
            const element = allowedTags.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
            if (node.tagName === 'A') {
                try {
                    const url = new URL(node.getAttribute('href'), 'https://ygocdb.com/');
                    if (url.protocol === 'https:' || url.protocol === 'http:') {
                        element.href = url.href;
                        element.target = '_blank';
                        element.rel = 'noopener noreferrer';
                    }
                } catch (error) {
                    // 无效链接只保留可读文字。
                }
            }
            node.childNodes.forEach((child) => appendNode(element, child));
            parent.appendChild(element);
        }
        parsed.body.childNodes.forEach((node) => appendNode(container, node));
    }

    function initDeckViewer() {
        let rawEl = document.getElementById('deck-raw');
        let renderEl = document.getElementById('deck-render');
        let hoverEl = document.getElementById('card-hover');

        // 无静态构筑的卡组页也需要渲染入口；单卡页和共享片段不自动补建。
        const deckPath = new URL('../decks/', document.currentScript.src).pathname;
        const content = document.querySelector('.entry__content');
        if (window.location.pathname.startsWith(deckPath) && content && document.querySelector('[data-deck-name]')) {
            if (!renderEl) {
                renderEl = document.createElement('div');
                renderEl.id = 'deck-render';
                // 卡组预览置于裁定、注意、持续适用的效果、自肃和召唤条件之后。
                content.appendChild(renderEl);
            }
            if (!rawEl) {
                rawEl = document.createElement('div');
                rawEl.id = 'deck-raw';
                rawEl.hidden = true;
                renderEl.before(rawEl);
            }
            if (!hoverEl) {
                hoverEl = document.createElement('div');
                hoverEl.id = 'card-hover';
                document.body.appendChild(hoverEl);
            }
        }

        if (!rawEl || !renderEl || !hoverEl) {
            return;
        }

        // 同时兼容页面现存的 iframe 容器和动态创建的详情容器。
        hoverEl.replaceChildren();
        hoverEl.setAttribute('role', 'region');
        hoverEl.setAttribute('aria-label', '卡片详情');

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
        // 每次切卡递增，防止较慢的旧请求覆盖当前卡片。
        let hoverRequestVersion = 0;
        // 当前交互请求与滑过延时分别管理，离开或切卡后及时释放。
        let hoverController = null;
        let hoverStartTimeout = null;
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

        /** 创建详情区块，资料中的日期与对应正文一起显示。 */
        function createDetailSection(title, date = '', parent = hoverEl) {
            const section = document.createElement('section');
            section.className = 'card-hover__section';
            const heading = document.createElement('div');
            heading.className = 'card-hover__heading';
            heading.textContent = title;
            section.appendChild(heading);
            if (date) {
                const time = document.createElement('time');
                time.className = 'card-hover__date';
                time.textContent = date;
                section.appendChild(time);
            }
            parent.appendChild(section);
            return section;
        }

        /** 先插入全部文字，再独立请求卡图；图片失败不影响资料阅读。 */
        function renderCardDetail(card, cardId, complete = false) {
            hoverEl.replaceChildren();
            const name = card.nwbbs_n || card.cn_name || card.text.name || String(cardId);
            const header = document.createElement('div');
            header.className = 'card-hover__name';
            header.textContent = `「${name}」`;
            const meta = document.createElement('div');
            meta.className = 'card-hover__meta';
            meta.textContent = [card.text.types, `密码：${cardId}`].filter(Boolean).join('\n');
            hoverEl.append(header, meta);

            const effect = createDetailSection('效果');
            const effectText = document.createElement('div');
            effectText.className = 'card-hover__effect';
            effectText.textContent = [card.text.pdesc ? `【灵摆效果】\n${card.text.pdesc}` : '', card.text.desc].filter(Boolean).join('\n');
            effect.appendChild(effectText);

            const extra = document.createElement('div');
            extra.className = 'card-hover__extra';
            extra.setAttribute('role', 'status');
            extra.textContent = '数据库补充说明与 FAQ 加载中…';
            hoverEl.appendChild(extra);
            if (complete) {
                renderCardExtras(card);
            }

            // 卡图放在效果之前，预留尺寸，避免加载完成后推动文字位置。
            const figure = document.createElement('div');
            figure.className = 'card-hover__picture';
            const image = document.createElement('img');
            image.alt = name;
            image.decoding = 'async';
            const status = document.createElement('span');
            status.className = 'card-hover__image-status';
            status.textContent = '卡图加载中…';
            figure.append(image, status);
            effect.before(figure);
            // 各图源依次尝试；错误与成功状态都只作用于这一张卡图。
            const sources = [
                `https://cdn.233.momobako.com/ygoimg/jp/${cardId}.webp!half`,
                `${CARD_IMAGE_FALLBACK_BASE}/${cardId}.jpg`,
                `${CARD_IMAGE_SECONDARY_FALLBACK_BASE}/${cardId}.jpg`
            ];
            let sourceIndex = 0;
            image.onload = () => {
                figure.classList.add('is-loaded');
                status.hidden = true;
            };
            image.onerror = () => {
                sourceIndex += 1;
                if (sourceIndex < sources.length) {
                    image.src = sources[sourceIndex];
                } else {
                    status.textContent = '卡图暂时无法加载';
                }
            };
            requestAnimationFrame(() => {
                if (image.isConnected) {
                    image.src = sources[0];
                }
            });
        }

        /** 完整资料返回时只填充附加区，保留已显示的效果、图片和滚动位置。 */
        function renderCardExtras(card) {
            const extra = hoverEl.querySelector('.card-hover__extra');
            if (!extra) {
                return;
            }
            extra.replaceChildren();
            extra.removeAttribute('role');
            const supplement = createDetailSection('数据库补充说明', card.supplement?.date, extra);
            if (card.supplement?.text) {
                appendCardDetailHtml(supplement, card.supplement.text);
            } else {
                supplement.appendChild(document.createTextNode('暂无数据库补充说明。'));
            }

            const faqs = Array.isArray(card.faqs) ? card.faqs : [];
            const faqSection = createDetailSection(`FAQ（${faqs.length}）`, '', extra);
            faqs.forEach((faq) => {
                const item = document.createElement('details');
                item.className = 'card-hover__faq';
                const summary = document.createElement('summary');
                appendCardDetailHtml(summary, faq.title || '查看问答');
                item.appendChild(summary);
                const question = createDetailSection('问题', faq.date, item);
                appendCardDetailHtml(question, faq.question);
                const answer = createDetailSection('回答', '', item);
                appendCardDetailHtml(answer, faq.answer);
                faqSection.appendChild(item);
            });
            if (!faqs.length) {
                faqSection.appendChild(document.createTextNode('暂无 FAQ。'));
            }

        }

        /** 仅在失败区域放置重试入口，已有的基础效果继续可读。 */
        function showDetailError(container, message, img, id) {
            container.textContent = message;
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'card-hover__retry';
            retry.textContent = '重试';
            retry.addEventListener('click', (event) => {
                event.stopPropagation();
                activeHoverCardId = '';
                showHover(img, id, { pin: Boolean(pinnedImg) });
            });
            container.appendChild(retry);
        }

        /** 滑过与点击共用详情请求，点击后保持浮窗固定。 */
        function showHover(img, id, options) {
            const shouldPin = Boolean(options?.pin);

            clearTimeout(hideTimeout);
            clearTimeout(hoverStartTimeout);

            hoverEl.style.display = 'block';
            hoverEl.classList.toggle('is-pinned', shouldPin || Boolean(pinnedImg));

            if (shouldPin) {
                pinnedImg = img;
            }

            if (activeHoverCardId !== String(id)) {
                hoverController?.abort();
                hoverController = new AbortController();
                const signal = hoverController.signal;
                activeHoverCardId = String(id);
                const requestVersion = ++hoverRequestVersion;
                hoverEl.classList.add('is-loading');
                hoverEl.setAttribute('aria-busy', 'true');
                const status = document.createElement('div');
                status.className = 'card-hover__status';
                status.setAttribute('role', 'status');
                status.textContent = '正在加载卡片资料…';
                hoverEl.replaceChildren(status);
                hoverEl.scrollTop = 0;
                const isCurrent = () => requestVersion === hoverRequestVersion && !signal.aborted;
                let basicShown = false;
                let fullShown = false;
                const finishLoading = () => {
                    if (isCurrent()) {
                        hoverEl.classList.remove('is-loading');
                        hoverEl.setAttribute('aria-busy', 'false');
                    }
                };
                const cachedFull = getCachedCard(id, true);
                const cachedBasic = cachedFull || getCachedCard(id);
                if (cachedBasic) {
                    renderCardDetail(cachedBasic, id, Boolean(cachedFull));
                    basicShown = true;
                    fullShown = Boolean(cachedFull);
                    finishLoading();
                }
                if (!cachedFull) {
                    // 两个阶段互不阻塞；完整版若先到，慢简版不会覆盖完整内容。
                    const basicRequest = cachedBasic ? Promise.resolve(cachedBasic) : fetchCardDetail(id, false, signal);
                    const fullRequest = fetchCardDetail(id, true, signal);
                    basicRequest.then((card) => {
                        if (isCurrent() && !fullShown && !basicShown) {
                            renderCardDetail(card, id);
                            basicShown = true;
                            finishLoading();
                        }
                    }).catch(() => {
                        // 简版失败时继续等待完整资料，避免提前把整张卡判为失败。
                    });
                    fullRequest.then((card) => {
                        if (!isCurrent()) {
                            return;
                        }
                        if (basicShown) {
                            renderCardExtras(card);
                        } else {
                            renderCardDetail(card, id, true);
                        }
                        fullShown = true;
                        finishLoading();
                    }).catch(async () => {
                        await basicRequest.catch(() => null);
                        if (isCurrent() && !fullShown) {
                            const target = hoverEl.querySelector('.card-hover__extra') || status;
                            showDetailError(target, basicShown ? '数据库补充说明与 FAQ 加载失败，请重试。' : '卡片资料加载失败，请重试。', img, id);
                            finishLoading();
                        }
                    });
                }
            }

            positionHover(img);
        }

        function hideHover(force) {
            if (!force && pinnedImg) {
                return;
            }

            clearTimeout(hideTimeout);
            clearTimeout(hoverStartTimeout);

            if (force) {
                hoverController?.abort();
                hoverEl.style.display = 'none';
                hoverEl.classList.remove('is-loading', 'is-pinned');
                pinnedImg = null;
                activeHoverCardId = '';
                hoverRequestVersion += 1;
                hoverEl.setAttribute('aria-busy', 'false');
                return;
            }

            hideTimeout = setTimeout(() => {
                if (!force && pinnedImg) {
                    return;
                }

                hoverController?.abort();
                hoverEl.style.display = 'none';
                hoverEl.classList.remove('is-loading', 'is-pinned');
                pinnedImg = null;
                activeHoverCardId = '';
                hoverRequestVersion += 1;
                hoverEl.setAttribute('aria-busy', 'false');
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

            // 复用统一错误回退；仅在两个原有图源都缺图时尝试补充图源。
            img.addEventListener('error', () => {
                img.src = `${CARD_IMAGE_FALLBACK_BASE}/${cardId}.jpg`;
                img.addEventListener('error', () => {
                    img.src = `${CARD_IMAGE_SECONDARY_FALLBACK_BASE}/${cardId}.jpg`;
                }, { once: true });
            }, { once: true });

            img.addEventListener('mouseenter', () => {
                if (pinnedImg && pinnedImg !== img) {
                    return;
                }

                // 指针经过卡图不立刻发请求，停留后才加载；点击仍立即响应。
                clearTimeout(hoverStartTimeout);
                hoverStartTimeout = setTimeout(() => showHover(img, cardId, {}), 160);
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

        // 浮窗内滚动用于阅读资料；仅页面或外部容器滚动时关闭。
        window.addEventListener('scroll', (event) => {
            if (!(event.target instanceof Node) || !hoverEl.contains(event.target)) {
                hideHover(true);
            }
        }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                hideHover(true);
            }
        });
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

        // 搜索结果每种卡片只展示一次，沿用构筑卡图的详情交互及手机端张数显示。
        function renderSearchCards(container, cards) {
            const groups = [
                { title: '主卡组卡片', cards: [] },
                { title: '额外卡组卡片', cards: [] }
            ];
            cards.forEach((card) => {
                const types = card.text?.types || card.additionalTexts?.sc?.types || '';
                const isExtra = Boolean(Number(card.data?.type) & (0x40 | 0x2000 | 0x800000 | 0x4000000))
                    || /融合|同调|超量|连接/.test(types);
                groups[isExtra ? 1 : 0].cards.push(card);
            });
            container.replaceChildren();
            groups.forEach((group) => {
                if (!group.cards.length) {
                    return;
                }
                const grid = createSection(`${group.title} · ${group.cards.length}`, container);
                group.cards.forEach((card) => {
                    const name = card.cn_name || card.sc_name || card.nwbbs_n || card.jp_name || String(card.cid);
                    if (Number(card.id) > 0) {
                        const img = createCardImage(card.id, true);
                        img.alt = name;
                        grid.appendChild(img);
                    } else {
                        // 没有卡片密码时保留名称，避免生成外部搜索链接或破图。
                        const label = document.createElement('span');
                        label.textContent = name;
                        grid.appendChild(label);
                    }
                });
            });
            updateSectionCounts(container);
        }

        bindDeckPreviews(document);
        window.DeckViewer = window.DeckViewer || {};
        window.DeckViewer.bindPreviews = bindDeckPreviews;
        window.DeckViewer.renderSearchCards = renderSearchCards;
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

    /** 后台名称查询共用有界队列，搜索结果已有文本时不再重复查询简版。 */
    function resolveCardByName(name) {
        const cacheKey = String(name || '').trim();

        if (!cacheKey) {
            return Promise.resolve(null);
        }

        if (!searchCache.has(cacheKey)) {
            const request = (async () => {
                const saved = readStoredCard(`name:${normalizeCardName(cacheKey)}`);
                if (saved) {
                    cardCache.set(String(saved.id), saved);
                    return saved;
                }
                const searchData = await fetchJson(`${CARD_API_BASE}/?search=${encodeURIComponent(cacheKey)}`);
                const match = pickExactSearchResult(cacheKey, searchData?.result || []);

                if (!match?.id || !match.text) {
                    searchCache.delete(cacheKey);
                    return null;
                }

                const cardId = String(match.id);
                // 搜索结果文本与简版格式对齐，供原有卡名提示和构筑浮窗共同复用。
                const card = { ...match, text: { ...match.text, name: match.nwbbs_n || match.cn_name || match.jp_name } };
                cardCache.set(cardId, card);
                storeCard(`basic:${cardId}`, card);
                storeCard(`name:${normalizeCardName(cacheKey)}`, card);
                return card;
            })().catch(() => {
                searchCache.delete(cacheKey);
                return null;
            });

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
            '<img class="card-effect-hover__image" alt="">',
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
        // 每批只维持两名查询任务，避免整页卡名一次性占满等待队列。
        let nextIndex = 0;
        const resolveNext = async () => {
            while (nextIndex < cardNames.length) {
                const cardName = cardNames[nextIndex++];
                const card = await resolveCardByName(cardName);
                if (card?.id && card?.text) {
                    resolvedMap.set(normalizeCardName(cardName), card);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(2, cardNames.length) }, resolveNext));

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
        // 普通悬浮及其他栏目继续显示卡片效果文本。
        tooltip.classList.remove('is-card-image');
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

    /**
     * 设置卡图预览的统一回退链，避免指定栏目因图源缺失而出现空白。
     * @param {HTMLImageElement} image 卡图元素
     * @param {string|number} cardId 卡片密码
     */
    function setEffectCardImage(image, cardId) {
        if (!image || !cardId) {
            return;
        }

        image.onerror = () => {
            image.onerror = () => {
                image.onerror = null;
                image.src = `${CARD_IMAGE_SECONDARY_FALLBACK_BASE}/${cardId}.jpg`;
            };
            image.src = `${CARD_IMAGE_FALLBACK_BASE}/${cardId}.jpg`;
        };
        image.src = `https://cdn.233.momobako.com/ygoimg/jp/${cardId}.webp!half`;
    }

    /** 指定三栏悬浮或点击卡名时显示紧凑卡图，而不是效果正文。 */
    function showCardImageTooltip(tooltip, trigger, card, options) {
        const image = tooltip.querySelector('.card-effect-hover__image');

        if (!image || !card?.id) {
            return;
        }

        tooltip.classList.add('is-card-image', 'is-visible');
        tooltip.classList.remove('is-loading');
        tooltip.classList.toggle('is-pinned', Boolean(options?.pin));
        image.alt = card.text?.name || trigger.dataset.cardName || '';
        setEffectCardImage(image, card.id);
        setTooltipPosition(tooltip, trigger);
    }

    /** 判断卡名是否位于需要点击显示卡图的三个栏目。 */
    function shouldShowCardImage(trigger) {
        const section = trigger.closest('.ruling-section');
        const title = section?.querySelector(':scope > h2')?.textContent.trim();
        return ['持续适用的效果', '召唤条件', '自肃'].includes(title);
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
                // 三个指定栏目在桌面端悬浮时直接显示卡图，其他栏目仍显示效果文本。
                if (shouldShowCardImage(trigger)) {
                    showCardImageTooltip(tooltip, trigger, card, { pin: false });
                } else {
                    showEffectTooltip(tooltip, trigger, card, event.clientX, event.clientY);
                }
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
                // 只切换指定栏目，裁定、注意等位置沿用原来的效果弹窗。
                if (shouldShowCardImage(trigger)) {
                    showCardImageTooltip(tooltip, trigger, card, { pin: true });
                } else {
                    showEffectTooltip(tooltip, trigger, card, undefined, undefined, { pin: true });
                }
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
                // 缩放时只重新定位，保留已经选择的卡图或效果显示模式。
                setTooltipPosition(tooltip, pinnedTrigger);
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
