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
        hoverEl.style.left = rect.right + 12 + 'px';
        hoverEl.style.top = Math.max(12, rect.top - 20) + 'px';
    }

    function hideHover() {
        hideTimeout = setTimeout(() => {
            hoverEl.style.display = 'none';
            iframe.src = '';
        }, 150); // 150ms 延迟，方便鼠标移到浮层
    }

    // 鼠标悬浮浮层时，取消隐藏
    hoverEl.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    hoverEl.addEventListener('mouseleave', hideHover);

    lines.forEach(line => {
        if (!line) return;

        if (line.startsWith('#created')) return;

        if (line === '#main') { createSection('MAIN'); return; }
        if (line === '#extra') { createSection('EXTRA'); return; }
        if (line === '!side') { createSection('SIDE'); return; }

        if (/^\d+$/.test(line) && currentGrid) {
            const img = document.createElement('img');
            img.src = `https://cdn.233.momobako.com/ygoimg/jp/${line}.webp`;
            img.alt = line;

            img.addEventListener('mouseenter', () => showHover(img, line));
            img.addEventListener('mouseleave', hideHover);

            currentGrid.appendChild(img);
        }
    });

})();
