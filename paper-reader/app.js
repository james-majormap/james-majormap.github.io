document.addEventListener('DOMContentLoaded', () => {
    const state = {
        activePaperId: null,
        lang: 'eng',
        compareMode: false,
        mode: 'markdown'
    };

    let scrollSyncCleanup = null;

    const paperListEl = document.getElementById('paper-list');
    const contentViewerEl = document.getElementById('content-viewer');
    const langToggleBtn = document.getElementById('lang-toggle');
    const compareToggleInput = document.getElementById('compare-toggle');
    const backToTopBtn = document.getElementById('back-to-top');
    const progressBar = document.getElementById('progress-bar');

    function init() {
        if (typeof PAPER_DATA_MD !== 'undefined' && PAPER_DATA_MD.length > 0) {
            window.APP_DATA = PAPER_DATA_MD;
            state.mode = 'markdown';
        } else if (typeof PAPER_DATA !== 'undefined' && PAPER_DATA.length > 0) {
            window.APP_DATA = PAPER_DATA;
            state.mode = 'legacy';
        } else {
            contentViewerEl.innerHTML = '<div class="placeholder"><p>No data loaded.</p></div>';
            return;
        }

        if (APP_DATA.length > 0) {
            state.activePaperId = APP_DATA[0].id;
        }

        renderPaperList();
        renderContent();

        langToggleBtn.addEventListener('click', toggleLanguage);
        compareToggleInput.addEventListener('change', toggleCompareMode);
        updateLangButton();
        setupScrollUI();
        setupCiteClickHandler();
    }

    // --- Language & Compare Controls ---

    function toggleLanguage() {
        state.lang = state.lang === 'eng' ? 'kor' : 'eng';
        updateLangButton();
        renderContent();
    }

    function updateLangButton() {
        const spans = langToggleBtn.querySelectorAll('.lang-text');
        if (spans.length >= 2) {
            spans[0].classList.toggle('active-lang', state.lang === 'eng');
            spans[1].classList.toggle('active-lang', state.lang === 'kor');
        }
    }

    function toggleCompareMode() {
        state.compareMode = compareToggleInput.checked;
        contentViewerEl.classList.toggle('wide-mode', state.compareMode);
        renderContent();
    }

    // --- Paper List ---

    function renderPaperList() {
        paperListEl.innerHTML = '';
        APP_DATA.forEach(paper => {
            const tab = document.createElement('div');
            tab.className = `paper-tab${paper.id === state.activePaperId ? ' active' : ''}`;
            tab.textContent = paper.title;
            tab.addEventListener('click', () => {
                if (state.activePaperId === paper.id) return;
                state.activePaperId = paper.id;
                renderPaperList();
                renderContent();
                if (window.innerWidth < 768) {
                    contentViewerEl.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
            paperListEl.appendChild(tab);
        });
    }

    // --- Markdown Preprocessing ---

    function preprocessMarkdown(md) {
        if (!md) return md;
        const lines = md.split('\n');
        const result = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const converted = convertBoldHeading(line);
            if (converted !== null) {
                // Ensure blank line before heading for proper markdown parsing
                if (result.length > 0 && result[result.length - 1].trim() !== '') {
                    result.push('');
                }
                result.push(converted);
                result.push('');
            } else {
                result.push(line);
            }
        }
        return result.join('\n');
    }

    function convertBoldHeading(line) {
        const trimmed = line.trim();

        // Pattern 1a: **N** **Title Words** (number in separate bold)
        // e.g. "**1** **Introduction**" or "**3.1** **Problem Collection**"
        const splitMatch = trimmed.match(
            /^\*\*(\d+(?:\.\d+)*)\*\*\s+(.+)$/
        );
        if (splitMatch) {
            const num = splitMatch[1];
            const rest = stripBold(splitMatch[2]);
            if (rest.length > 100) return null;
            const depth = num.split('.').length;
            const level = Math.min(depth + 1, 4);
            return '#'.repeat(level) + ' ' + num + ' ' + rest;
        }

        // Pattern 1b: **N. Title Words** (number + title in single bold)
        // e.g. "**1. Introduction**" or "**3.2. Framework**"
        const inlineMatch = trimmed.match(
            /^\*\*(\d+(?:\.\d+)*)\.\s*(.+?)\*\*$/
        );
        if (inlineMatch) {
            const num = inlineMatch[1];
            const rest = stripBold(inlineMatch[2]);
            if (rest.length > 100) return null;
            const depth = num.split('.').length;
            const level = Math.min(depth + 1, 4);
            return '#'.repeat(level) + ' ' + num + ' ' + rest;
        }

        // Pattern 2: standalone bold keyword headings
        // e.g. "**Abstract**" or "**참고문헌**"
        const keywordMatch = trimmed.match(
            /^\*\*(Abstract|Introduction|Conclusion|References|Acknowledgements?|Appendix|초록|서론|결론|참고문헌|감사의\s*글|부록)\*\*$/i
        );
        if (keywordMatch) {
            return '## ' + keywordMatch[1];
        }

        return null;
    }

    function stripBold(text) {
        // Remove **...** and _..._  wrappers, flatten to plain text
        return text
            .replace(/\*\*/g, '')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // --- Post-processing: Citations, References, Captions ---

    function postProcessHtml(html) {
        // 1. Mark reference entries: <p>[N] Author... → styled with data-ref
        html = html.replace(/<p>\[(\d+)\]/g,
            '<p class="ref-entry" data-ref="$1"><span class="ref-num">[$1]</span>');

        // 2. Style figure captions: <em>Figure N.</em> → styled label
        html = html.replace(/<em>(Figure\s+\d+)\.<\/em>/gi,
            '<span class="fig-label">$1.</span>');

        // 3. Style table captions: <em>Table N.</em> → styled label
        html = html.replace(/<em>(Table\s+\d+)\.<\/em>/gi,
            '<span class="table-label">$1.</span>');

        return html;
    }

    function postProcessDOM(container) {
        // Convert inline [N] and [N, M] citations to clickable superscript links
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        const citationRe = /\[(\d+(?:,\s*\d+)*)\]/g;

        for (const node of textNodes) {
            const parent = node.parentElement;
            if (!parent) continue;
            // Skip reference numbers, headings, code, existing links, bold (affiliations)
            if (parent.closest('.ref-num, h1, h2, h3, h4, h5, h6, code, pre, a, .citation')) continue;
            if (parent.tagName === 'STRONG') continue;

            const text = node.textContent;
            citationRe.lastIndex = 0;
            if (!citationRe.test(text)) continue;
            citationRe.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let lastIdx = 0;
            let match;

            while ((match = citationRe.exec(text)) !== null) {
                if (match.index > lastIdx) {
                    frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
                }

                const sup = document.createElement('sup');
                sup.className = 'citation';
                const nums = match[1].split(/,\s*/);
                sup.appendChild(document.createTextNode('['));
                nums.forEach((n, i) => {
                    if (i > 0) sup.appendChild(document.createTextNode(', '));
                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'cite-link';
                    a.dataset.ref = n.trim();
                    a.textContent = n.trim();
                    sup.appendChild(a);
                });
                sup.appendChild(document.createTextNode(']'));
                frag.appendChild(sup);

                lastIdx = match.index + match[0].length;
            }

            if (lastIdx < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx)));
            }
            if (lastIdx > 0) {
                node.parentNode.replaceChild(frag, node);
            }
        }

        // Add language labels to code blocks
        container.querySelectorAll('pre code[class*="language-"]').forEach(el => {
            const lang = el.className.replace('language-', '');
            if (lang) el.parentElement.dataset.lang = lang;
        });
    }

    function setupCiteClickHandler() {
        contentViewerEl.addEventListener('click', (e) => {
            const cite = e.target.closest('.cite-link');
            if (!cite) return;
            e.preventDefault();

            const refNum = cite.dataset.ref;
            if (!refNum) return;

            // Find reference within same markdown-body (handles compare mode)
            const scope = cite.closest('.markdown-body') || contentViewerEl;
            const target = scope.querySelector(`.ref-entry[data-ref="${refNum}"]`);
            if (!target) return;

            const column = target.closest('.column');
            if (column) {
                const rect = target.getBoundingClientRect();
                const colRect = column.getBoundingClientRect();
                column.scrollBy({ top: rect.top - colRect.top - 50, behavior: 'smooth' });
            } else {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            target.classList.add('ref-highlight');
            setTimeout(() => target.classList.remove('ref-highlight'), 2000);
        });
    }

    // --- Content Rendering ---

    function renderContent() {
        // Clean up previous scroll sync
        if (scrollSyncCleanup) {
            scrollSyncCleanup();
            scrollSyncCleanup = null;
        }

        const paper = APP_DATA.find(p => p.id === state.activePaperId);
        if (!paper) return;

        if (state.mode === 'markdown') {
            renderMarkdownContent(paper);
        } else {
            renderLegacyContent(paper);
        }

        window.scrollTo(0, 0);
    }

    function buildPdfLinks(paper) {
        let html = '';
        if (paper.eng_pdf) {
            html += `<a href="${escapeHtml(paper.eng_pdf)}" target="_blank" class="pdf-link">PDF (EN)</a>`;
        }
        if (paper.kor_pdf) {
            html += `<a href="${escapeHtml(paper.kor_pdf)}" target="_blank" class="pdf-link">PDF (KO)</a>`;
        }
        return html ? `<div class="pdf-links">${html}</div>` : '';
    }

    function renderMarkdownContent(paper) {
        const engContent = preprocessMarkdown(paper.eng_md || '');
        const korContent = preprocessMarkdown(paper.kor_md || '');
        const pdfLinks = buildPdfLinks(paper);

        if (state.compareMode) {
            let html = `<div class="paper-header"><h1 class="paper-title">${escapeHtml(paper.title)}</h1>${pdfLinks}</div>`;
            html += `<div class="dual-column-container">`;
            html += `<div class="column col-eng">`;
            html += `<div class="col-label">English</div>`;
            html += `<div class="markdown-body">${postProcessHtml(marked.parse(engContent || '*No English content available.*'))}</div>`;
            html += `</div>`;
            html += `<div class="column col-kor">`;
            html += `<div class="col-label">Korean</div>`;
            html += `<div class="markdown-body">${postProcessHtml(marked.parse(korContent || '*No Korean content available.*'))}</div>`;
            html += `</div>`;
            html += `</div>`;
            contentViewerEl.innerHTML = html;

            // Post-process DOM for citations and code labels
            contentViewerEl.querySelectorAll('.markdown-body').forEach(el => postProcessDOM(el));

            // Setup scroll sync after DOM is ready
            requestAnimationFrame(() => {
                scrollSyncCleanup = setupScrollSync();
            });
        } else {
            let content = state.lang === 'eng' ? engContent : korContent;
            let fallback = false;

            if (!content && state.lang === 'kor') {
                content = engContent;
                fallback = true;
            }

            let html = `<div class="paper-header"><h1 class="paper-title">${escapeHtml(paper.title)}</h1>${pdfLinks}`;
            if (fallback) {
                html += `<div class="fallback-notice">Korean translation not available. Showing English.</div>`;
            }
            html += `</div>`;
            html += `<article class="markdown-body">${postProcessHtml(marked.parse(content || '*No content available.*'))}</article>`;
            contentViewerEl.innerHTML = html;

            // Post-process DOM for citations and code labels
            contentViewerEl.querySelectorAll('.markdown-body').forEach(el => postProcessDOM(el));
        }
    }

    // --- Section-based Scroll Sync ---

    function setupScrollSync() {
        const engCol = contentViewerEl.querySelector('.col-eng');
        const korCol = contentViewerEl.querySelector('.col-kor');
        if (!engCol || !korCol) return null;

        // Only sync when columns scroll independently (desktop layout)
        if (engCol.scrollHeight <= engCol.clientHeight) return null;

        // Tag headings with sequential section indices
        const engHeadings = engCol.querySelectorAll('h2, h3, h4');
        const korHeadings = korCol.querySelectorAll('h2, h3, h4');

        engHeadings.forEach((h, i) => { h.dataset.sIdx = i; });
        korHeadings.forEach((h, i) => { h.dataset.sIdx = i; });

        const maxIdx = Math.min(engHeadings.length, korHeadings.length) - 1;
        if (maxIdx < 0) return null;

        let scrollSource = null;
        let cooldownTimer = null;

        function getActiveSectionInfo(column) {
            const headings = column.querySelectorAll('[data-s-idx]');
            const scrollTop = column.scrollTop;
            let activeIdx = 0;

            for (const h of headings) {
                if (h.offsetTop <= scrollTop + 20) {
                    activeIdx = parseInt(h.dataset.sIdx);
                } else {
                    break;
                }
            }

            // Calculate progress within current section
            const currentHeading = column.querySelector(`[data-s-idx="${activeIdx}"]`);
            const nextHeading = column.querySelector(`[data-s-idx="${activeIdx + 1}"]`);
            let progress = 0;

            if (currentHeading && nextHeading) {
                const sectionHeight = nextHeading.offsetTop - currentHeading.offsetTop;
                if (sectionHeight > 0) {
                    progress = (scrollTop - currentHeading.offsetTop) / sectionHeight;
                    progress = Math.max(0, Math.min(1, progress));
                }
            } else if (currentHeading) {
                // Last section: calculate progress to bottom
                const remaining = column.scrollHeight - currentHeading.offsetTop;
                if (remaining > 0) {
                    progress = (scrollTop - currentHeading.offsetTop) / remaining;
                    progress = Math.max(0, Math.min(1, progress));
                }
            }

            return { idx: Math.min(activeIdx, maxIdx), progress };
        }

        function syncTo(targetCol, idx, progress) {
            const targetHeading = targetCol.querySelector(`[data-s-idx="${idx}"]`);
            if (!targetHeading) return;

            const nextTargetHeading = targetCol.querySelector(`[data-s-idx="${idx + 1}"]`);
            let targetTop = targetHeading.offsetTop;

            if (nextTargetHeading) {
                const targetSectionHeight = nextTargetHeading.offsetTop - targetHeading.offsetTop;
                targetTop += targetSectionHeight * progress;
            } else {
                // Last section
                const remaining = targetCol.scrollHeight - targetHeading.offsetTop;
                targetTop += remaining * progress;
            }

            targetCol.scrollTop = targetTop;
        }

        function onScroll(sourceCol, targetCol) {
            if (scrollSource === targetCol) return;

            scrollSource = sourceCol;
            clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(() => { scrollSource = null; }, 150);

            const { idx, progress } = getActiveSectionInfo(sourceCol);
            syncTo(targetCol, idx, progress);
        }

        function engHandler() { onScroll(engCol, korCol); }
        function korHandler() { onScroll(korCol, engCol); }

        engCol.addEventListener('scroll', engHandler, { passive: true });
        korCol.addEventListener('scroll', korHandler, { passive: true });

        // Return cleanup function
        return () => {
            engCol.removeEventListener('scroll', engHandler);
            korCol.removeEventListener('scroll', korHandler);
            clearTimeout(cooldownTimer);
        };
    }

    // --- Legacy Content Rendering ---

    function renderLegacyContent(paper) {
        const engData = paper['eng'] || [];
        const korData = paper['kor'] || [];

        if (state.compareMode) {
            let html = `<div class="paper-header"><h1 class="paper-title">${escapeHtml(paper.title)}</h1></div>`;
            html += `<div class="dual-column-container">`;

            html += `<div class="column col-eng">`;
            html += `<div class="col-label">English</div>`;
            engData.forEach((page, i) => {
                html += `<div class="page-container">`;
                html += `<div class="page-number">Page ${page.page}</div>`;
                html += `<div class="page-text">${formatLegacyText(page.text, i === 0)}</div>`;
                if (page.images) {
                    page.images.forEach(img => {
                        html += `<img src="${escapeHtml(img)}" class="page-image" loading="lazy" alt="">`;
                    });
                }
                html += `</div>`;
            });
            html += `</div>`;

            html += `<div class="column col-kor">`;
            html += `<div class="col-label">Korean</div>`;
            if (korData.length > 0) {
                korData.forEach((page, i) => {
                    html += `<div class="page-container">`;
                    html += `<div class="page-number">Page ${page.page}</div>`;
                    html += `<div class="page-text">${formatLegacyText(page.text, i === 0)}</div>`;
                    html += `</div>`;
                });
            } else {
                html += `<div class="placeholder"><p>Korean not available</p></div>`;
            }
            html += `</div>`;
            html += `</div>`;

            contentViewerEl.innerHTML = html;
        } else {
            let contentData = paper[state.lang];
            let fallback = false;

            if (!contentData || contentData.length === 0) {
                contentData = paper['eng'];
                fallback = true;
            }

            if (!contentData || contentData.length === 0) {
                contentViewerEl.innerHTML = '<div class="placeholder"><p>No content available.</p></div>';
                return;
            }

            let html = `<div class="paper-header"><h1 class="paper-title">${escapeHtml(paper.title)}</h1>`;
            if (fallback && state.lang === 'kor') {
                html += `<div class="fallback-notice">Korean translation not available. Showing English.</div>`;
            }
            html += `</div>`;

            contentData.forEach((page, index) => {
                html += `<div class="page-container">`;
                html += `<div class="page-number">Page ${page.page}</div>`;
                html += `<div class="page-text">${formatLegacyText(page.text, index === 0)}</div>`;
                if (page.images && page.images.length > 0) {
                    page.images.forEach(imgSrc => {
                        html += `<img src="${escapeHtml(imgSrc)}" class="page-image" loading="lazy" alt="">`;
                    });
                }
                html += `</div>`;
            });

            contentViewerEl.innerHTML = html;
        }
    }

    // --- Legacy Text Formatting ---

    function formatLegacyText(text, isFirstPage) {
        if (!text) return '';
        const blocks = parseLegacyBlocks(text, isFirstPage);
        let html = '';
        blocks.forEach(block => {
            if (block.type === 'title') {
                html += `<div class="paper-meta">${escapeHtml(block.text)}</div>`;
            } else if (block.type === 'author') {
                html += `<div class="author-list">${escapeHtml(block.text)}</div>`;
            } else if (block.type === 'header') {
                html += `<div class="section-header">${escapeHtml(block.text)}</div>`;
            } else {
                html += `<p>${escapeHtml(block.text)}</p>`;
            }
        });
        return html;
    }

    function parseLegacyBlocks(text, isFirstPage) {
        const rawLines = text.split(/\n/);
        const blocks = [];
        let currentBlock = [];

        rawLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentBlock.length > 0) {
                    blocks.push({ type: 'p', text: currentBlock.join(' ') });
                    currentBlock = [];
                }
                return;
            }
            const isHeader = /^(?:\d+\.?\s|Abstract|Introduction|Conclusion|References|Related Work|참고문헌|서론|결론|초록)/i.test(trimmed) && trimmed.length < 80;
            if (isHeader) {
                if (currentBlock.length > 0) {
                    blocks.push({ type: 'p', text: currentBlock.join(' ') });
                    currentBlock = [];
                }
                blocks.push({ type: 'header', text: trimmed });
                return;
            }
            currentBlock.push(trimmed);
        });

        if (currentBlock.length > 0) {
            blocks.push({ type: 'p', text: currentBlock.join(' ') });
        }

        if (isFirstPage && blocks.length > 0) {
            blocks[0].type = 'title';
            if (blocks.length > 1 && blocks[1].text.length < 200) {
                blocks[1].type = 'author';
            }
        }
        return blocks;
    }

    // --- Scroll UI: Back-to-top + Progress Bar ---

    function setupScrollUI() {
        window.addEventListener('scroll', () => {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;

            // Back to top visibility
            if (backToTopBtn) {
                backToTopBtn.classList.toggle('visible', scrollTop > 400);
            }

            // Progress bar
            if (progressBar && docHeight > 0) {
                const pct = Math.min(100, (scrollTop / docHeight) * 100);
                progressBar.style.width = pct + '%';
            }
        }, { passive: true });

        if (backToTopBtn) {
            backToTopBtn.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    }

    // --- Utilities ---

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Start
    init();
});
