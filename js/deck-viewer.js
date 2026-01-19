(function () {

    const rawEl = document.getElementById('deck-raw');
    const renderEl = document.getElementById('deck-render');
    const hoverEl = document.getElementById('card-hover');
    const iframe = hoverEl.querySelector('iframe');

    if (!rawEl || !renderEl || !hoverEl) return;

    const lines = rawEl.innerText
        .split(/\r?\n/)
        .map(l => l.trim());

    let currentGrid = null;
    let hideTimeout = null;

    const GAP = 12;          // 卡片与浮层间距
    const VIEW_PADDING = 8;  // 视口安全边距

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

        iframe.src = `https://ygocdb.com/card/${id}`;
        hoverEl.style.display = 'block';

        const rect = img.getBoundingClientRect();

        const hoverWidth = hoverEl.offsetWidth;
        const hoverHeight = hoverEl.offsetHeight;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 默认放右侧
        let left = rect.right + GAP;

        // 如果右侧放不下，改为左侧
        if (left + hoverWidth + VIEW_PADDING > viewportWidth) {
            left = rect.left - hoverWidth - GAP;
        }

        // 防止左侧也越界（极小屏）
        if (left < VIEW_PADDING) {
            left = VIEW_PADDING;
        }

        // 垂直位置：尽量对齐卡片顶部
        let top = rect.top;

        // 防止底部溢出
        if (top + hoverHeight + VIEW_PADDING > viewportHeight) {
            top = viewportHeight - hoverHeight - VIEW_PADDING;
        }

        // 防止顶部溢出
        if (top < VIEW_PADDING) {
            top = VIEW_PADDING;
        }

        hoverEl.style.left = left + 'px';
        hoverEl.style.top = top + 'px';
    }

    function hideHover() {
        hideTimeout = setTimeout(() => {
            hoverEl.style.display = 'none';
            iframe.src = '';
        }, 150);
    }

    // 浮层自身 hover 时不隐藏
    hoverEl.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    hoverEl.addEventListener('mouseleave', hideHover);

    lines.forEach(line => {
        if (!line) return;

        if (line.startsWith('#created')) return;

        if (line === '#main') { createSection('MAIN'); return; }
        if (line === '#extra') { createSection('EXTRA'); return; }
        if (line === '!spareCards') { createSection('SpareCards'); return; }

        if (/^\d+$/.test(line) && currentGrid) {
            const img = document.createElement('img');
            img.src = `https://cdn.233.momobako.com/ygoimg/jp/${line}.webp!half`;
            img.alt = line;

            img.addEventListener('mouseenter', () => showHover(img, line));
            img.addEventListener('mouseleave', hideHover);

            currentGrid.appendChild(img);
        }
    });

})();
