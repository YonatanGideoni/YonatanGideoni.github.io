// /assets/processor.js
// Reusable module: renderPost({ mdPath, bibPath, containerId, options })
export async function renderPost({mdPath, bibPath = 'bib.html', containerId = 'content', options = {}} = {}) {
    // --- deps check -----------------------------------------------------
    if (typeof marked === 'undefined') {
        throw new Error('marked is not available. Include marked.js before this module or load it as a module.');
    }
    if (typeof markedKatex === 'undefined') {
        console.warn('marked-katex extension not loaded; KaTeX math may not render as expected.');
    }

    // --- small helpers ---------------------------------------------------
    const escapeHtml = s => {
        s = s == null ? '' : String(s);
        return s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    };
    const escapeAttr = s => escapeHtml(s).replace(/"/g, '&quot;');
    const stripQuotes = s => {
        if (typeof s !== 'string') return s;
        s = s.trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
        return s;
    };
    const normalizeId = s => (s || '').toString().replace(/[^A-Za-z0-9_\-:]/g, '').toLowerCase();

    // --- bib loader ------------------------------------------------------
    const BIB = {};

    async function loadBibHtml(url) {
        try {
            const res = await fetch(url, {cache: 'no-store'});
            if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
            const txt = await res.text();
            const tmp = document.createElement('div');
            tmp.innerHTML = txt;
            const ol = tmp.querySelector('#refs-list') || tmp.querySelector('ol') || tmp;
            if (!ol) return;
            const lis = ol.querySelectorAll('li[id^="ref-"]');
            lis.forEach(li => {
                const id = li.id.replace(/^ref-/, '').toLowerCase();
                BIB[id] = {
                    title: (li.dataset.title || '').trim(),
                    shortAuthors: (li.dataset.shortAuthors || '').trim(),
                    venue: (li.dataset.venue || '').trim(),
                    year: (li.dataset.year || '').trim(),
                    pretty: (li.textContent || '').trim()
                };
            });
        } catch (err) {
            console.warn('loadBibHtml error:', err);
        }
    }

    // --- improved YAML-like frontmatter parser ---------------------------
    // (kept from your original, slightly refactored for clarity)
    function parseYamlFrontmatter(md) {
        const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
        if (!m) return {meta: null, body: md};
        const yaml = m[1];
        const body = md.slice(m[0].length);
        const rawLines = yaml.split(/\r?\n/);

        const indentOf = ln => {
            const r = ln.match(/^(\s*)/);
            return r ? r[1].length : 0;
        };

        const kvInline = (text) => {
            const kv = text.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
            if (!kv) return null;
            return [kv[1], kv[2]];
        };

        const meta = {};
        let i = 0;
        while (i < rawLines.length) {
            let line = rawLines[i];
            if (/^\s*$/.test(line)) {
                i++;
                continue;
            }
            const indent = indentOf(line);
            if (indent > 0) {
                i++;
                continue;
            }
            const kv = kvInline(line.trim());
            if (!kv) {
                i++;
                continue;
            }
            const key = kv[0];
            let val = kv[1].trim();
            if (val === '') {
                i++;
                const items = [];
                while (i < rawLines.length) {
                    const ln = rawLines[i];
                    if (/^\s*$/.test(ln)) {
                        i++;
                        continue;
                    }
                    const ind = indentOf(ln);
                    if (ind <= indent) break;
                    const listMatch = ln.match(/^\s*-\s*(.*)$/);
                    if (!listMatch) {
                        i++;
                        continue;
                    }
                    const afterDash = listMatch[1].trim();
                    if (afterDash === '') {
                        i++;
                        const obj = {};
                        while (i < rawLines.length) {
                            const subln = rawLines[i];
                            if (/^\s*$/.test(subln)) {
                                i++;
                                continue;
                            }
                            const subIndent = indentOf(subln);
                            if (subIndent <= indent) break;
                            const subTrim = subln.trim();
                            const subKv = kvInline(subTrim);
                            if (subKv) {
                                const sk = subKv[0];
                                let sv = subKv[1].trim();
                                if (sv === '') {
                                    i++;
                                    const arr = [];
                                    while (i < rawLines.length) {
                                        const al = rawLines[i];
                                        if (/^\s*$/.test(al)) {
                                            i++;
                                            continue;
                                        }
                                        const alIndent = indentOf(al);
                                        if (alIndent <= subIndent) break;
                                        const alMatch = al.match(/^\s*-\s*(.*)$/);
                                        if (alMatch) {
                                            arr.push(stripQuotes(alMatch[1].trim()));
                                            i++;
                                        } else break;
                                    }
                                    obj[sk] = arr;
                                } else {
                                    obj[sk] = stripQuotes(sv);
                                    i++;
                                }
                            } else i++;
                        }
                        items.push(obj);
                        continue;
                    }
                    // inline mapping or scalar
                    const pairs = [...afterDash.matchAll(/([A-Za-z0-9_\-]+)\s*:\s*("[^"]*"|'[^']*'|[^"\s][^:]*?(?=(?:\s+[A-Za-z0-9_\-]+\s*:)|$))/g)];
                    if (pairs.length) {
                        const obj = {};
                        pairs.forEach(p => {
                            obj[p[1]] = stripQuotes(String(p[2]).trim());
                        });
                        // parse any extra indented sublines for this list item
                        i++;
                        while (i < rawLines.length) {
                            const peek = rawLines[i];
                            if (/^\s*$/.test(peek)) {
                                i++;
                                continue;
                            }
                            const peekIndent = indentOf(peek);
                            if (peekIndent <= ind) break;
                            const subTrim = peek.trim();
                            const subKv = kvInline(subTrim);
                            if (subKv) {
                                const sk = subKv[0];
                                let sv = subKv[1].trim();
                                if (sv === '') {
                                    i++;
                                    const arr = [];
                                    while (i < rawLines.length) {
                                        const al = rawLines[i];
                                        if (/^\s*$/.test(al)) {
                                            i++;
                                            continue;
                                        }
                                        const alIndent = indentOf(al);
                                        if (alIndent <= peekIndent) break;
                                        const alMatch = al.match(/^\s*-\s*(.*)$/);
                                        if (alMatch) {
                                            arr.push(stripQuotes(alMatch[1].trim()));
                                            i++;
                                        } else break;
                                    }
                                    obj[sk] = arr;
                                } else {
                                    obj[sk] = stripQuotes(sv);
                                    i++;
                                }
                            } else break;
                        }
                        items.push(obj);
                    } else {
                        items.push(stripQuotes(afterDash));
                        i++;
                    }
                }
                meta[key] = items;
            } else {
                meta[key] = stripQuotes(val);
                i++;
            }
        }

        return {meta, body};
    }

    // --- normalize author entries ---------------------------------------
    function normalizeAuthorEntry(raw) {
        if (!raw) return {name: '', url: '', affiliations: []};
        if (typeof raw === 'string') {
            const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
            return {name: stripQuotes(parts[0] || ''), url: parts[1] || '', affiliations: []};
        }
        if (typeof raw === 'object') {
            let name = '';
            if (raw.name) name = stripQuotes(raw.name);
            else if (raw.id) name = stripQuotes(raw.id);
            else {
                for (const k of Object.keys(raw)) {
                    if (/name/i.test(k) && typeof raw[k] === 'string') {
                        name = stripQuotes(raw[k]);
                        break;
                    }
                }
            }
            const url = raw.url ? stripQuotes(raw.url) : (raw.homepage ? stripQuotes(raw.homepage) : '');
            let affs = [];
            if (Array.isArray(raw.affiliations)) affs = raw.affiliations.map(stripQuotes);
            else if (Array.isArray(raw.affiliation)) affs = raw.affiliation.map(stripQuotes);
            else if (typeof raw.affiliations === 'string') affs = [stripQuotes(raw.affiliations)];
            return {name: name || '', url: url || '', affiliations: affs};
        }
        return {name: String(raw), url: '', affiliations: []};
    }

    // --- build header from frontmatter ---------------------------------
    function buildHeaderFromMeta(meta = {}) {
        const title = meta.title || '';
        let authors = meta.authors || meta.author || [];
        if (typeof authors === 'string') {
            authors = authors.split(/\s*[;,]\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
        }
        const paper = meta.paper || meta.paper_url || meta.pdf || '';
        const code = meta.code || meta.code_url || '';
        const website = meta.website || '';
        const tags = meta.tags || [];
        const image = meta.image || '';

        const authorsBlocks = (Array.isArray(authors) ? authors : [authors]).map(rawAuthor => {
            const a = normalizeAuthorEntry(rawAuthor);
            if (!a.name) return '';
            const nameHtml = a.url
                ? `<a class="author-link" href="${escapeAttr(a.url)}" target="_blank" rel="noopener"><strong>${escapeHtml(a.name)}</strong></a>`
                : `<strong class="author-name">${escapeHtml(a.name)}</strong>`;
            const affHtml = (Array.isArray(a.affiliations) && a.affiliations.length)
                ? `<div class="author-affiliations">${a.affiliations.map(x => `<span class="author-aff">${escapeHtml(x)}</span>`).join('')}</div>`
                : '';
            return `<div class="pf-author">${nameHtml}${affHtml}</div>`;
        }).filter(Boolean).join('');

        const linkBits = [];
        if (paper) linkBits.push(`<a class="meta-link meta-link--orange" href="${escapeAttr(paper)}" target="_blank" rel="noopener">Paper</a>`);
        if (code) linkBits.push(`<a class="meta-link meta-link--orange" href="${escapeAttr(code)}" target="_blank" rel="noopener">Code</a>`);
        if (website) linkBits.push(`<a class="meta-link" href="${escapeAttr(website)}" target="_blank" rel="noopener">Site</a>`);
        const linksHtml = linkBits.join(' · ');
        const tagsHtml = (Array.isArray(tags) && tags.length) ? `<div class="pf-tags">${tags.map(t => `<span class="pf-tag">${escapeHtml(t)}</span>`).join(' ')}</div>` : '';
        const imageHtml = image ? `<div class="pf-image"><img src="${escapeAttr(image)}" alt="${escapeAttr(title)} image"></div>` : '';

        return `
      <div class="post-front">
        <div class="post-front-content">
          <div class="pf-main">
            <h1 class="pf-title">${escapeHtml(title)}</h1>
            ${authorsBlocks ? `<div class="pf-authors">${authorsBlocks}</div>` : ''}
            ${linksHtml ? `<div class="pf-links">${linksHtml}</div>` : ''}
            ${tagsHtml}
          </div>
          ${imageHtml}
        </div>
      </div>
    `;
    }

    // --- citation token + replacements ----------------------------------
    const CITATION_TOKEN = /\[([@][^;\]\)]+(?:\s*[;,]\s*[@][^;\]\)]+)*)\]/g;

    function makeSupHtml(keys, orderMap, seen) {
        const nums = keys.map(k => {
            const nk = normalizeId(k);
            if (!(nk in orderMap)) {
                orderMap[nk] = seen.length + 1;
                seen.push(nk);
            }
            return orderMap[nk];
        });
        return `<sup><span class="cite" tabindex="0" data-keys="${keys.map(k => normalizeId(k)).join(',')}">[${nums.join(',')}]</span></sup>`;
    }

    function replaceCitationsInMarkdown(md, orderMap, seen) {
        const codePieces = md.split(/(```[\s\S]*?```)/g);
        for (let i = 0; i < codePieces.length; i++) {
            if (i % 2 === 0) {
                const footPieces = codePieces[i].split(/(\^\[\{[\s\S]*?\}\])/g);
                for (let j = 0; j < footPieces.length; j++) {
                    if (j % 2 === 0) {
                        footPieces[j] = footPieces[j].replace(CITATION_TOKEN, (m, inner) => {
                            const keys = inner.split(/[;,]/).map(s => s.replace(/@/g, '').trim()).filter(Boolean);
                            return makeSupHtml(keys, orderMap, seen);
                        });
                    } else {
                        footPieces[j] = footPieces[j].replace(/^\^\[\{([\s\S]*?)\}\]$/, (m, inner) => {
                            const replacedInner = inner.replace(CITATION_TOKEN, (m2, inner2) => {
                                const keys = inner2.split(/[;,]/).map(s => s.replace(/@/g, '').trim()).filter(Boolean);
                                return makeSupHtml(keys, orderMap, seen);
                            });
                            return `^[{${replacedInner}}]`;
                        });
                    }
                }
                codePieces[i] = footPieces.join('');
            }
        }
        return codePieces.join('');
    }

    // --- citation popup UI ----------------------------------------------
    const popup = document.getElementById('citation-popup') || (() => {
        const el = document.createElement('div');
        el.id = 'citation-popup';
        el.className = 'citation-popup';
        // minimal inline styles so it doesn't look broken without CSS
        el.style.position = 'absolute';
        el.style.zIndex = 1200;
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        return el;
    })();

    let hideTimer = null;

    function clearHide() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function scheduleHide() {
        clearHide();
        hideTimer = setTimeout(hidePopup, 220);
    }

    function hidePopup() {
        popup.style.display = 'none';
        popup.setAttribute('aria-hidden', 'true');
    }

    popup.addEventListener('mouseenter', clearHide);
    popup.addEventListener('mouseleave', scheduleHide);

    function renderPopupForKey(entry) {
        const title = entry.title || '';
        const shortA = entry.shortAuthors || '';
        const venue = entry.venue || '';
        const year = entry.year || '';
        const titleDiv = document.createElement('div');
        titleDiv.className = 'title';
        titleDiv.textContent = title;
        const metaDiv = document.createElement('div');
        metaDiv.className = 'meta';
        let metaText = '';
        if (shortA) metaText += shortA.endsWith('.') ? shortA : (shortA + '.');
        if (venue) metaText += (metaText ? ' ' : '') + venue;
        if (year) metaText += (metaText ? ' ' : '') + year + '.';
        metaDiv.textContent = metaText;
        return {titleDiv, metaDiv};
    }

    function showPopupForSpan(e) {
        clearHide();
        const keys = (e.currentTarget.dataset.keys || '').split(',').map(s => s.trim()).filter(Boolean);
        popup.innerHTML = '';
        keys.forEach((k, idx) => {
            const entry = BIB[k];
            if (!entry) {
                const miss = document.createElement('div');
                miss.textContent = k + ' (missing)';
                popup.appendChild(miss);
            } else {
                const parts = renderPopupForKey(entry);
                popup.appendChild(parts.titleDiv);
                popup.appendChild(parts.metaDiv);
            }
            if (idx < keys.length - 1) {
                const hr = document.createElement('hr');
                hr.className = 'sep';
                popup.appendChild(hr);
            }
        });
        popup.style.display = 'block';
        popup.setAttribute('aria-hidden', 'false');
        const rect = e.currentTarget.getBoundingClientRect();
        popup.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
        popup.style.top = rect.bottom + window.scrollY + 8 + 'px';
        const pRect = popup.getBoundingClientRect();
        if (pRect.right > window.innerWidth - 8) popup.style.left = Math.max(8, window.innerWidth - pRect.width - 8) + 'px';
        if (pRect.bottom > window.scrollY + window.innerHeight - 8) popup.style.top = rect.top + window.scrollY - pRect.height - 8 + 'px';
    }

    function attachCitationEvents() {
        const spans = document.querySelectorAll('.cite');
        spans.forEach(sp => {
            if (sp.dataset._citeBound === '1') return;
            sp.dataset._citeBound = '1';
            sp.addEventListener('mouseenter', showPopupForSpan);
            sp.addEventListener('mouseleave', scheduleHide);
            sp.addEventListener('focus', showPopupForSpan);
            sp.addEventListener('blur', scheduleHide);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.cite') && !e.target.closest('#citation-popup') && !e.target.closest('.fn') && !e.target.closest('.fn-tooltip')) hidePopup();
        });
        document.addEventListener('scroll', hidePopup, true);
    }

    // --- footnote tooltip helpers ---------------------------------------
    const sharedFnTooltip = document.createElement('div');
    sharedFnTooltip.className = 'fn-tooltip';
    sharedFnTooltip.style.display = 'none';
    sharedFnTooltip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sharedFnTooltip);

    function renderNoteHtml(rawHtml) {
        if (typeof DOMPurify !== 'undefined') {
            try {
                return DOMPurify.sanitize(rawHtml);
            } catch (e) {
                return rawHtml;
            }
        }
        return rawHtml;
    }

    function positionTooltipForElement(el, tooltip) {
        const rect = el.getBoundingClientRect();
        tooltip.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
        tooltip.style.top = rect.top + window.scrollY - tooltip.offsetHeight - 8 + 'px';
        const tRect = tooltip.getBoundingClientRect();
        if (tRect.top < 8) tooltip.style.top = rect.bottom + window.scrollY + 8 + 'px';
        if (tRect.right > window.innerWidth - 8) tooltip.style.left = Math.max(8, window.innerWidth - tRect.width - 8) + 'px';
    }

    // --- figure/pdf/image handling -------------------------------------
    // parse alt text format: "Caption | 800px | right"
    function parseAlt(alt) {
        if (!alt) return {caption: '', width: '', align: ''};
        const parts = alt.split('|').map(s => s.trim());
        return {caption: parts[0] || '', width: parts[1] || '', align: parts[2] || ''};
    }

    function makePdfFigure(src, caption, width, align) {
        const figure = document.createElement('figure');
        figure.className = 'post-figure post-figure--pdf';
        if (align) figure.classList.add(`figure--${align}`);
        if (width) figure.style.maxWidth = width;

        const wrapper = document.createElement('div');
        wrapper.className = 'post-figure__embed';
        // minimal inline sizing so it is usable without CSS
        wrapper.style.width = '100%';
        wrapper.style.height = '480px';
        wrapper.style.overflow = 'hidden';
        wrapper.style.borderRadius = '8px';
        wrapper.style.border = '1px solid #e9e9e9';
        wrapper.style.background = '#fafafa';

        const iframe = document.createElement('iframe');
        iframe.setAttribute('src', src);
        iframe.setAttribute('title', caption || 'Embedded PDF');
        iframe.setAttribute('loading', 'lazy');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = '0';
        wrapper.appendChild(iframe);

        const fallback = document.createElement('p');
        fallback.className = 'post-figure__fallback';
        fallback.style.fontSize = '0.9rem';
        fallback.style.marginTop = '0.6rem';
        fallback.innerHTML = `This PDF may not be displayed in your browser — <a href="${escapeAttr(src)}" target="_blank" rel="noopener">open/download it</a>.`;

        figure.appendChild(wrapper);
        if (caption) {
            const figcap = document.createElement('figcaption');
            figcap.textContent = caption;
            figure.appendChild(figcap);
        }
        figure.appendChild(fallback);

        // clicking the wrapper opens the lightbox for a full-sized view
        wrapper.style.cursor = 'zoom-in';
        wrapper.addEventListener('click', (e) => {
            e.preventDefault();
            openLightbox({type: 'pdf', src, caption});
        });

        return figure;
    }

    function makeImgFigure(img, caption, width, align) {
        const figure = document.createElement('figure');
        figure.className = 'post-figure post-figure--img';
        if (align) figure.classList.add(`figure--${align}`);
        if (width) figure.style.maxWidth = width;

        const newImg = img.cloneNode(true);
        newImg.style.width = '100%';
        newImg.style.height = 'auto';
        newImg.style.display = 'block';
        newImg.style.borderRadius = '8px';
        newImg.style.cursor = 'zoom-in';

        const figcap = document.createElement('figcaption');
        if (caption) figcap.textContent = caption;

        figure.appendChild(newImg);
        if (caption) figure.appendChild(figcap);

        // click to open lightbox (full-size)
        newImg.addEventListener('click', (e) => {
            e.preventDefault();
            openLightbox({type: 'image', src: newImg.getAttribute('src'), caption});
        });

        return figure;
    }

    // Finds images and pdf links in container and replaces with figures
    function wrapMediaInFigures(container) {
        // 1) standard images: <p><img ...></p>
        const imgs = Array.from(container.querySelectorAll('p > img'));
        imgs.forEach(img => {
            const {caption, width, align} = parseAlt(img.alt);
            const src = img.getAttribute('src') || '';
            if (src.toLowerCase().endsWith('.pdf')) {
                // treat as pdf
                const fig = makePdfFigure(src, caption, width, align);
                img.parentElement.replaceWith(fig);
            } else {
                const fig = makeImgFigure(img, caption, width, align);
                img.parentElement.replaceWith(fig);
            }
        });

        // 2) Some markdown authors link to pdfs as links: <p><a href="foo.pdf">Caption</a></p>
        const pdfLinks = Array.from(container.querySelectorAll('p > a[href$=".pdf"]'));
        pdfLinks.forEach(a => {
            const raw = a.getAttribute('title') || a.textContent || '';
            const {caption, width, align} = parseAlt(raw);
            const src = a.getAttribute('href');
            const fig = makePdfFigure(src, caption || a.textContent || 'Supplementary PDF', width, align);
            a.parentElement.replaceWith(fig);
        });

        // 3) optionally convert bare images not wrapped in <p> (e.g., inline) - choose safe selection
        const imgs2 = Array.from(container.querySelectorAll('img'));
        imgs2.forEach(img => {
            if (img.closest('figure')) return; // already done
            if (img.closest('p')) return; // handled earlier
            const {caption, width, align} = parseAlt(img.alt);
            const src = img.getAttribute('src') || '';
            if (src.toLowerCase().endsWith('.pdf')) {
                const fig = makePdfFigure(src, caption, width, align);
                img.replaceWith(fig);
            } else {
                const fig = makeImgFigure(img, caption, width, align);
                img.replaceWith(fig);
            }
        });
    }

    // --- lightbox (simple) ----------------------------------------------
    // creates a modal element and manages open/close. Supports type image/pdf.
    const LIGHTBOX_ID = 'post-lightbox';
    const existingLb = document.getElementById(LIGHTBOX_ID);
    const lightbox = existingLb || (() => {
        const lb = document.createElement('div');
        lb.id = LIGHTBOX_ID;
        lb.className = 'post-lightbox';
        lb.style.position = 'fixed';
        lb.style.left = 0;
        lb.style.top = 0;
        lb.style.width = '100vw';
        lb.style.height = '100vh';
        lb.style.zIndex = 1400;
        lb.style.display = 'none';
        lb.style.alignItems = 'center';
        lb.style.justifyContent = 'center';
        lb.style.background = 'rgba(0,0,0,0.75)';
        lb.innerHTML = `
      <div class="post-lightbox__inner" role="dialog" aria-modal="true" style="max-width:95vw; max-height:95vh; width:80vw; height:80vh; position:relative;">
        <button class="post-lightbox__close" aria-label="Close" style="position:absolute; right:8px; top:8px; z-index:2; background:#fff; border:0; padding:6px 10px; border-radius:4px; cursor:pointer;">✕</button>
        <div class="post-lightbox__content" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:auto; background:transparent;"></div>
        <div class="post-lightbox__caption" style="color:#fff; font-size:0.95rem; margin-top:8px; text-align:center;"></div>
      </div>
    `;
        document.body.appendChild(lb);
        return lb;
    })();

    const lbInner = lightbox.querySelector('.post-lightbox__inner');
    const lbContent = lightbox.querySelector('.post-lightbox__content');
    const lbCaption = lightbox.querySelector('.post-lightbox__caption');
    const lbClose = lightbox.querySelector('.post-lightbox__close');

    function closeLightbox() {
        lightbox.style.display = 'none';
        lbContent.innerHTML = '';
        lbCaption.textContent = '';
    }

    function openLightbox({type, src, caption}) {
        lbContent.innerHTML = '';
        lbCaption.textContent = caption || '';
        if (type === 'image') {
            const img = document.createElement('img');
            img.src = src;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.display = 'block';
            lbContent.appendChild(img);
        } else if (type === 'pdf') {
            const iframe = document.createElement('iframe');
            iframe.src = src;
            iframe.style.width = '95vw';
            iframe.style.height = '80vh';
            iframe.style.border = 0;
            lbContent.appendChild(iframe);
        } else {
            lbContent.textContent = 'Unsupported preview';
        }
        lightbox.style.display = 'flex';
    }

    lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });

    // --- main flow -----------------------------------------------------
    await loadBibHtml(bibPath);

    const mdRes = await fetch(mdPath, {cache: 'no-store'});
    if (!mdRes.ok) throw new Error(`Failed to load markdown ${mdPath}: ${mdRes.status}`);
    let markdownContent = await mdRes.text();

    const {meta: fmMeta, body: fmBody} = parseYamlFrontmatter(markdownContent);
    let headerHTML = null;
    if (fmMeta) {
        markdownContent = fmBody;
        headerHTML = buildHeaderFromMeta(fmMeta);
    }

    if (!headerHTML) {
        try {
            const base = mdPath.replace(/\/[^\/]*$/, '/');
            const fmUrl = base + 'frontmatter.html';
            const fmResp = await fetch(fmUrl, {cache: 'no-store'});
            if (fmResp.ok) headerHTML = await fmResp.text();
        } catch (e) { /* ignore */
        }
    }

    if (!headerHTML) {
        const fallbackTitle = mdPath.split('/').pop().replace(/[-_]/g, ' ').replace(/\.md$/, '');
        headerHTML = buildHeaderFromMeta({title: fallbackTitle});
    }

    // citations
    const orderMap = {}, seen = [];
    markdownContent = replaceCitationsInMarkdown(markdownContent, orderMap, seen);

    // marked options & katex
    marked.setOptions(Object.assign({breaks: true, gfm: true}, options.marked || {}));
    if (typeof markedKatex !== 'undefined') {
        marked.use(markedKatex(Object.assign({
            throwOnError: false, delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false}
            ]
        }, options.katex || {})));
    }

    let htmlContent = marked.parse(markdownContent);

    // footnotes mapping
    const footnoteMap = new Map();
    let fnCounter = 0;
    htmlContent = htmlContent.replace(/\^\[\{([\s\S]*?)\}\]/g, (m, inner) => {
        const id = `fn-${fnCounter++}`;
        footnoteMap.set(id, inner);
        return `<span class="fn" data-fn-id="${id}" tabindex="0" role="button" aria-haspopup="true" aria-expanded="false"></span>`;
    });

    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container #${containerId} not found`);
    container.innerHTML = `
    ${headerHTML || ''}
    <div class="post-body">${htmlContent}</div>
  `;

    // build bibliography list
    let refsContainer = document.getElementById('references');
    if (!refsContainer) {
        refsContainer = document.createElement('section');
        refsContainer.id = 'references';
        refsContainer.innerHTML = '<h2>References</h2>';
        container.parentElement.appendChild(refsContainer);
    }
    let ol = refsContainer.querySelector('#refs-list') || refsContainer.querySelector('ol');
    if (!ol) {
        ol = document.createElement('ol');
        ol.id = 'refs-list';
        refsContainer.appendChild(ol);
    }
    if (seen.length) {
        ol.innerHTML = '';
        for (const id of seen) {
            const it = BIB[id];
            const li = document.createElement('li');
            li.className = 'bib-item';
            if (it && it.pretty) li.textContent = it.pretty;
            else {
                li.style.color = '#b00';
                li.textContent = id + ' (missing from bib.html)';
            }
            ol.appendChild(li);
        }
    } else {
        ol.innerHTML = '<li style="color:#666">No citations found in this document.</li>';
    }

    // attach citation popup events
    attachCitationEvents();

    // footnotes tooltip behaviour
    const fnEls = Array.from(container.querySelectorAll('.fn'));
    fnEls.forEach(fnEl => {
        const id = fnEl.dataset.fnId;
        if (!id || !footnoteMap.has(id)) return;
        const plainText = (footnoteMap.get(id) || '').replace(/<[^>]+>/g, '');
        fnEl.setAttribute('aria-label', plainText);
        let hideTimerFn = null;
        const show = () => {
            clearTimeout(hideTimerFn);
            const rawHtml = footnoteMap.get(id) || '';
            sharedFnTooltip.innerHTML = renderNoteHtml(rawHtml);
            attachCitationEvents();
            sharedFnTooltip.style.display = 'block';
            sharedFnTooltip.setAttribute('aria-hidden', 'false');
            positionTooltipForElement(fnEl, sharedFnTooltip);
        };
        const hide = () => {
            clearTimeout(hideTimerFn);
            hideTimerFn = setTimeout(() => {
                sharedFnTooltip.style.display = 'none';
                sharedFnTooltip.setAttribute('aria-hidden', 'true');
            }, 120);
        };
        fnEl.addEventListener('mouseenter', show);
        fnEl.addEventListener('focus', show);
        fnEl.addEventListener('mouseleave', hide);
        fnEl.addEventListener('blur', hide);
        sharedFnTooltip.addEventListener('mouseenter', () => clearTimeout(hideTimerFn));
        sharedFnTooltip.addEventListener('mouseleave', hide);
        fnEl.addEventListener('click', (e) => {
            if (sharedFnTooltip.style.display === 'block') {
                sharedFnTooltip.style.display = 'none';
                sharedFnTooltip.setAttribute('aria-hidden', 'true');
            } else show();
            e.stopPropagation();
        });
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.fn') && !e.target.closest('.fn-tooltip')) {
            sharedFnTooltip.style.display = 'none';
            sharedFnTooltip.setAttribute('aria-hidden', 'true');
        }
    });

    // finally: media wrapping (images + pdfs)
    const postBody = container.querySelector('.post-body');
    if (postBody) wrapMediaInFigures(postBody);

    // return useful metadata
    return {seen, orderMap, bib: BIB, container};
}
