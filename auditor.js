let isRunning = false;
let globalResults = [];
window.globalUrls = [];
window.globalKeywords = [];
window.globalCategories = [];
window.globalStartSTT = 1;

document.getElementById('auditor_btnStop').addEventListener('click', () => {
    isRunning = false;
    document.getElementById('auditor_btnStop').disabled = true;
    document.getElementById('auditor_btnStart').innerHTML = "🚀 Chạy Lại";
    document.getElementById('auditor_btnStart').disabled = false;
    generateTextReport();
});

async function startAnalysis() {
    if (isRunning) return;

    // Giữ nguyên dòng trống (blank line) để đếm STT đúng vị trí
    const rawUrls = document.getElementById('auditor_urlInput').value.split('\n').map(u => u.trim());
    const rawKeywords = document.getElementById('keywordInput').value.split('\n').map(k => k.trim());
    const rawCategories = document.getElementById('categoryInput').value.split('\n').map(c => c.trim());
    const totalNonEmpty = rawUrls.filter(u => u).length;

    if (totalNonEmpty === 0) {
        alert("Vui lòng nhập ít nhất 1 URL!");
        return;
    }

    // --- Hỏi STT bắt đầu ---
    let userSTT = prompt("Nhập số STT bắt đầu:", document.getElementById('startSTT').value);
    if (userSTT === null) return; 
    let sttNum = parseInt(userSTT);
    if (isNaN(sttNum) || sttNum < 1) {
        alert("Vui lòng nhập một số hợp l�� (>= 1)!");
        return;
    }
    document.getElementById('startSTT').value = sttNum;
    // ----------------------

    isRunning = true;
    window.globalStartSTT = parseInt(document.getElementById('startSTT').value) || 1;
    window.globalUrls = rawUrls;
    window.globalKeywords = rawKeywords;
    window.globalCategories = rawCategories;

    document.getElementById('auditor_btnStart').disabled = true;
    document.getElementById('auditor_btnStart').innerHTML = "⏳ Đang quét...";
    document.getElementById('progressContainer').style.display = 'block';
    document.getElementById('auditor_btnStop').disabled = false;
    document.getElementById('progressBar').style.width = '0%';
    
    // Reset giao diện và ẩn toàn bộ các cột kiểm tra mặc định
    document.querySelector('table').className = '';
    const tbody = document.getElementById('resultBody');
    tbody.innerHTML = '';
    globalResults = [];

    let checkedCount = 0;
    for (let i = 0; i < rawUrls.length; i++) {
        if (!isRunning) {
            document.getElementById('progressText').innerText = `⛔ Đã dừng ở dòng ${i}/${rawUrls.length}`;
            break;
        }

        let rawUrl = rawUrls[i];

        // Dòng trống: lưu null, bỏ qua kiểm tra
        if (!rawUrl) {
            globalResults[i] = null; // null = dòng trống
            continue;
        }

        let url = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl;
        let keyword = rawKeywords[i] || '';
        let expectedCategory = rawCategories[i] || '';

        checkedCount++;
        document.getElementById('progressText').innerText = `Đang quét ${checkedCount}/${totalNonEmpty}: ${url}`;

        // Add row to UI
        let sttLabel = window.globalStartSTT + i;
        let tr = document.createElement('tr');
        tr.id = `row_${i}`;
        tr.innerHTML = `
            <td><a href="${url}" target="_blank" style="color:var(--primary);text-decoration:none">${url}</a></td>
            <td id="score_${i}"><span class="badge badge-warning">Đang quét...</span></td>
            <td class="col-title" id="title_${i}">...</td>
            <td class="col-desc" id="desc_${i}">...</td>
            <td class="col-h1" id="h1_${i}">...</td>
            <td class="col-h2h3" id="h2h3_${i}">...</td>
            <td class="col-img" id="img_${i}">...</td>
            <td class="col-featimg" id="featimg_${i}">...</td>
            <td class="col-word" id="word_${i}">...</td>
            <td class="col-kw" id="kw_${i}">...</td>
            <td id="category_${i}">...</td>
            <td class="col-catmatch" id="catmatch_${i}">...</td>
            <td id="schema_${i}">...</td>
            <td class="col-sapo" id="sapo_${i}">...</td>
            <td class="col-urlslug" id="urlslug_${i}">...</td>
            <td>
                <button class="details-btn" onclick="showDetails(${i})" disabled id="btn_detail_${i}">Chi tiết</button>
                <button class="details-btn" style="background:var(--primary); color:white; border:none; margin-top:4px;" onclick="recheckRow(${i})">Quét lại</button>
            </td>
        `;
        tbody.appendChild(tr);

        let result = await fetchAndAnalyze(url, keyword, expectedCategory);
        globalResults[i] = result;
        
        if (result.error) {
            document.getElementById(`score_${i}`).innerHTML = `<span class="badge badge-danger">Lỗi Mạng</span>`;
        } else {
            renderResult(i, result);
        }
        generateTextReport();

        document.getElementById('progressBar').style.width = `${(checkedCount / totalNonEmpty) * 100}%`;
        await new Promise(r => setTimeout(r, 1000)); // Delay 1s chống block
    }

    if (isRunning) {
        document.getElementById('progressText').innerText = `✅ Đã quét xong ${checkedCount}/${totalNonEmpty} bài viết!`;
        isRunning = false;
        document.getElementById('auditor_btnStart').innerHTML = "🚀 Chạy Lại";
        document.getElementById('auditor_btnStart').disabled = false;

        // Báo cáo Telegram
        let summary = `<b>📊 BÁO CÁO SEO HOÀN TẤT</b>\n`;
        summary += `Tổng số: <b>${checkedCount}</b> bài viết.\n`;
        summary += `STT bắt đầu: ${sttNum}\n`;
        summary += `Thời gian: ${new Date().toLocaleString()}\n`;
        summary += `\nSếp vào xem chi tiết kết quả trên Web nhé!`;
        await sendToTelegram(summary);
        
        document.getElementById('auditor_btnStop').disabled = true;
        generateTextReport();
    }
}



function removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    return str;
}

async function fetchAndAnalyze(url, keyword, expectedCategory) {
    try {
        let htmlString = "";
        let proxySuccess = false;

        const proxies = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
            `https://thingproxy.freeboard.io/fetch/${url}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`
        ];

        for (let p of proxies) {
            try {
                const response = await fetch(p);
                if (!response.ok) continue;
                
                if (p.includes('allorigins') && !p.includes('/raw')) {
                    const data = await response.json();
                    htmlString = data.contents;
                } else {
                    htmlString = await response.text();
                }

                if (htmlString && htmlString.length > 50) {
                    proxySuccess = true;
                    break; 
                }
            } catch (e) {}
        }

        if (!proxySuccess || !htmlString) throw new Error("Cả 3 Proxy đều thất bại");

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        return analyzeSEO(doc, url, keyword, expectedCategory);

    } catch (error) {
        return { error: true, details: ["❌ Mạng lỗi hoặc bị Firewall chặn."], url: url, score: 0 };
    }
}

function analyzeSEO(doc, url, keyword, expectedCategory) {
    const opts = {
        url: document.getElementById('chkUrl').checked,
        title: document.getElementById('chkTitle').checked,
        desc: document.getElementById('chkDesc').checked,
        h1: document.getElementById('chkH1').checked,
        h2h3: document.getElementById('chkH2H3').checked,
        alt: document.getElementById('chkAlt').checked,
        featImg: document.getElementById('chkFeatImg').checked,
        word: document.getElementById('chkWord').checked,
        kw: document.getElementById('chkKw').checked,
        sapo: document.getElementById('chkSapo').checked
    };

    let score = 100;
    let details = [];
    let errorMap = {};

    // --- CHECK CẤU TRÚC URL SLUG ---
    let urlStatus = 'none';
    if (opts.url && keyword) {
        urlStatus = 'pass';
        try {
            let urlObj = new URL(url);
            let pathname = urlObj.pathname.replace(/\/$/, '');
            let slug = pathname.substring(pathname.lastIndexOf('/') + 1).toLowerCase();
            
            // Chuyển dấu "/", ".", "," thành "-" trước, sau đó mới xóa các ký tự đặc biệt khác
            let kwSlug = removeVietnameseTones(keyword).toLowerCase().replace(/[\/.,:;]/g, '-').replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
            
            if (!slug.includes(kwSlug)) {
                urlStatus = 'fail';
                score -= 5;
                details.push(`❌ Cấu trúc URL ("${slug}") không chứa từ khóa dạng slug ("${kwSlug}").`);
            } else {
                details.push(`✅ URL chứa từ khóa chuẩn SEO.`);
            }

            let numberMatch = slug.match(/\d+$/);
            if (numberMatch) {
                let trailingNum = numberMatch[0];
                let kwNoTone = removeVietnameseTones(keyword).toLowerCase();
                if (!kwNoTone.includes(trailingNum)) {
                    urlStatus = 'fail';
                    score -= 5;
                    details.push(`❌ Đuôi URL là số rác ("${trailingNum}") không có mặt trong từ khóa.`);
                } else {
                    details.push(`✅ Đuôi URL có số ("${trailingNum}") hợp lệ vì nằm trong từ khóa.`);
                }
            } else {
                details.push(`✅ Đuôi URL không bị dính số rác.`);
            }
        } catch (e) {
            details.push(`⚠️ URL không hợp lệ để phân tích cấu trúc.`);
        }
    }

    // 1. Title (45-60)
    let titleEl = doc.querySelector('title');
    let titleText = titleEl ? titleEl.textContent.trim() : '';
    let titleStatus = 'none';
    if (opts.title) {
        titleStatus = 'fail';
        if (!titleText) {
            score -= 15;
            details.push('❌ Thiếu thẻ Title.');
        } else if (titleText.length >= 45 && titleText.length <= 60) {
            titleStatus = 'pass';
            details.push(`✅ Thẻ Title chuẩn (${titleText.length} ký tự).`);
        } else {
            score -= 5;
            titleStatus = 'warn';
            details.push(`⚠️ Thẻ Title dài ${titleText.length} ký tự (Chuẩn: 45-60).`);
        }
    }

    // 2. Meta Description (140-160)
    let descEl = doc.querySelector('meta[name="description"]');
    let descText = descEl ? (descEl.getAttribute('content') || '').trim() : '';
    let descStatus = 'none';
    if (opts.desc) {
        descStatus = 'fail';
        if (!descText) {
            score -= 15;
            details.push('❌ Thiếu thẻ Meta Description.');
        } else if (descText.length >= 140 && descText.length <= 160) {
            descStatus = 'pass';
            details.push(`✅ Thẻ Description chuẩn (${descText.length} ký tự).`);
        } else {
            score -= 5;
            descStatus = 'warn';
            details.push(`⚠️ Thẻ Description dài ${descText.length} ký tự (Chuẩn: 140-160).`);
        }
    }

    // 3. H1 (H1 thường nằm ở phần Header của bài viết, ngoài entry-content)
    let h1s = doc.querySelectorAll('h1');
    let h1Status = 'none';
    if (opts.h1) {
        h1Status = 'fail';
        if (h1s.length === 1) {
            h1Status = 'pass';
            details.push(`✅ Có duy nhất 1 thẻ H1.`);
        } else if (h1s.length === 0) {
            score -= 10;
            details.push(`�� Thiếu thẻ H1.`);
        } else {
            score -= 15;
            details.push(`❌ Có quá nhiều thẻ H1 (${h1s.length} thẻ). Chỉ được phép có 1.`);
        }
    }

    // --- ĐỊNH VỊ KHU VỰC NỘI DUNG CHÍNH CHUẨN WORDPRESS/FLATSOME ---
    // Tìm khung chứa nội dung bài viết để loại bỏ hoàn toàn Footer, Sidebar, Menu, Comments
    let contentWrapper = doc.querySelector('.entry-content') || doc.querySelector('article') || doc.querySelector('main') || doc.body;

    // 4. H2 / H3 Logic - CHỈ LẤY TRONG KHU VỰC NỘI DUNG
    let h2h3Status = 'none';
    if (opts.h2h3) {
        let headings = Array.from(contentWrapper.querySelectorAll('h2, h3'));
        h2h3Status = 'pass';
        let h2ErrorCount = 0;
        let currentH2 = null;
        let h3CountForCurrentH2 = 0;

        headings.forEach(h => {
            if (h.tagName.toLowerCase() === 'h2') {
                if (currentH2 && h3CountForCurrentH2 === 1) {
                    h2ErrorCount++;
                    details.push(`❌ Thẻ H2 "${currentH2.textContent.substring(0,20)}..." chỉ có duy nhất 1 thẻ H3 bên dưới.`);
                }
                currentH2 = h;
                h3CountForCurrentH2 = 0;
            } else if (h.tagName.toLowerCase() === 'h3') {
                if (currentH2) {
                    h3CountForCurrentH2++;
                } else {
                    h2ErrorCount++;
                    details.push(`❌ Thẻ H3 "${h.textContent.substring(0,20)}..." đứng lơ lửng không nằm dưới H2 nào.`);
                }
            }
        });

        // Ngoại lệ: Bỏ qua H2 cuối cùng trong bài (Đoạn Kết Luận)
        if (currentH2 && h3CountForCurrentH2 === 1) {
            details.push(`✅ Thẻ H2 cuối (Kết luận) "${currentH2.textContent.substring(0,20)}..." có 1 thẻ H3 (Được ngoại lệ bỏ qua).`);
        }

        if (h2ErrorCount > 0) {
            h2h3Status = 'fail';
            score -= (h2ErrorCount * 5);
        } else {
            details.push(`✅ Cấu trúc H2/H3 hợp lệ.`);
        }
    }

    // 5. Hình ảnh (Alt) - CHỈ LẤY TRONG KHU VỰC NỘI DUNG
    let imgStatus = 'none';
    if (opts.alt) {
        let contentImages = Array.from(contentWrapper.querySelectorAll('img'));
        imgStatus = 'pass';
        let missingAltCount = 0;
        
        contentImages.forEach(img => {
            if (!img.hasAttribute('alt') || img.getAttribute('alt').trim() === '') {
                missingAltCount++;
            }
        });

        if (contentImages.length === 0) {
            imgStatus = 'warn';
            details.push(`⚠️ Khu vực nội dung bài viết không có ảnh nào.`);
        } else if (missingAltCount > 0) {
            imgStatus = 'fail';
            score -= Math.min(10, missingAltCount * 2);
            details.push(`❌ Có ${missingAltCount}/${contentImages.length} ảnh trong nội dung thiếu thẻ alt.`);
        } else {
            details.push(`✅ Tất cả ${contentImages.length} ảnh trong nội dung đều có thẻ alt.`);
        }
    }

    // 6. Word Count - CHỈ ĐẾM CHỮ TRONG KHU VỰC NỘI DUNG
    let wordStatus = 'none';
    if (opts.word) {
        let walker = doc.createTreeWalker(contentWrapper, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                let parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
                // Bỏ qua các thẻ kịch bản hoặc style nếu vô tình lọt vào
                if (['script', 'style', 'noscript'].includes(parentTag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        let mainText = "";
        let currentNode;
        while (currentNode = walker.nextNode()) {
            mainText += currentNode.nodeValue + " ";
        }
        
        let wordCount = mainText.trim().split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount < 1000) {
            wordStatus = 'fail';
            score -= 10;
            details.push(`❌ Số từ: ${wordCount} (Yêu cầu >= 1000 từ).`);
        } else {
            wordStatus = 'pass';
            details.push(`✅ Số từ: ${wordCount} từ.`);
        }
    }

    // 7. Keyword (4 tiêu chí)
    let kwStatus = 'none';
    if (opts.kw && keyword) {
        let kwLower = keyword.toLowerCase();
        let kwErrors = [];

        // 7.1 Từ khóa phải xuất hiện ở ĐẦU tiêu đề
        let titleLower = titleText.toLowerCase().trim();
        if (titleLower.startsWith(kwLower)) {
            details.push(`✅ Từ khóa nằm ở đầu Title.`);
        } else {
            kwErrors.push('Từ khóa không nằm ở đầu Title');
            details.push(`❌ Từ khóa không nằm ở đầu Title (Title bắt đầu bằng: "${titleText.substring(0, 30)}...").`);
        }

        // 7.2 Từ khóa phải có trong Meta Description
        if (descText.toLowerCase().includes(kwLower)) {
            details.push(`✅ Từ khóa có trong Meta Description.`);
        } else {
            kwErrors.push('Từ khóa không có trong Meta Description');
            details.push(`❌ Từ khóa không xuất hiện trong Meta Description.`);
        }

        // 7.3 Từ khóa phải trong câu đầu tiên của Sapo
        let paragraphs = Array.from(contentWrapper.querySelectorAll('p'));
        let sapoP = paragraphs.find(p => p.textContent.trim().length > 20);
        if (sapoP) {
            let sapoText = sapoP.textContent.trim();
            // Lấy câu đầu tiên (kết thúc bằng dấu chấm, chấm hỏi, chấm than)
            let firstSentence = sapoText.split(/[.!?]/)[0] || sapoText;
            if (firstSentence.toLowerCase().includes(kwLower)) {
                details.push(`✅ Từ khóa có trong câu đầu tiên của Sapo.`);
            } else {
                kwErrors.push('Từ khóa không có trong câu đầu tiên của Sapo');
                details.push(`❌ Từ khóa không xuất hiện trong câu đầu tiên của Sapo ("${firstSentence.substring(0, 50)}...").`);
            }
        } else {
            kwErrors.push('Không tìm thấy đoạn Sapo');
            details.push(`❌ Không tìm thấy đoạn Sapo để kiểm tra từ khóa.`);
        }

        // 7.4 Từ khóa phải có trong đoạn văn kết luận (nội dung sau H2 cuối cùng)
        let allH2 = Array.from(contentWrapper.querySelectorAll('h2'));
        if (allH2.length > 0) {
            let lastH2 = allH2[allH2.length - 1];
            // Thu thập text từ H2 cuối đến hết contentWrapper
            let conclusionText = '';
            let sibling = lastH2;
            while (sibling) {
                conclusionText += sibling.textContent + ' ';
                sibling = sibling.nextElementSibling;
            }
            if (conclusionText.toLowerCase().includes(kwLower)) {
                details.push(`✅ Từ khóa có trong đoạn kết luận.`);
            } else {
                kwErrors.push('Từ khóa không có trong đoạn kết luận');
                details.push(`❌ Từ khóa không xuất hiện trong đoạn kết luận (phần sau H2 cuối).`);
            }
        } else {
            kwErrors.push('Không tìm thấy H2 để xác định đoạn kết luận');
            details.push(`⚠️ Không tìm thấy thẻ H2 để xác định đoạn kết luận.`);
        }

        // Tổng kết
        if (kwErrors.length === 0) {
            kwStatus = 'pass';
        } else {
            kwStatus = 'fail';
            score -= (kwErrors.length * 3);
        }
    }

    // 8. Sapo Check (Đoạn văn đầu tiên)
    let sapoStatus = 'none';
    if (opts.sapo && keyword) {
        let paragraphs = Array.from(contentWrapper.querySelectorAll('p'));
        // Lấy đoạn văn đầu tiên có độ dài > 20 ký tự để loại bỏ thẻ <p> rỗng
        let sapo = paragraphs.find(p => p.textContent.trim().length > 20);
        
        if (!sapo) {
            sapoStatus = 'fail';
            score -= 10;
            details.push(`❌ Không tìm thấy đoạn văn Sapo (thẻ <p> đầu tiên).`);
        } else {
            let linksInSapo = Array.from(sapo.querySelectorAll('a'));
            let hasKeywordLink = false;
            let hasBrandLink = false;
            
            try {
                let urlObj = new URL(url);
                let homepage = urlObj.origin;
                let currentPath = urlObj.pathname;
                let brandName = urlObj.hostname.replace('www.', '').split('.')[0].toLowerCase();
                
                let normUrl = url.replace(/\/$/, '');
                let normHomepage = homepage.replace(/\/$/, '');

                linksInSapo.forEach(a => {
                    let href = a.getAttribute('href') || '';
                    let text = a.textContent.toLowerCase();
                    
                    // Chuẩn hóa href tuyệt đối
                    let absoluteHref = href;
                    if (href.startsWith('/')) absoluteHref = homepage + href;
                    let normHref = absoluteHref.replace(/\/$/, '');
                    
                    // Check Keyword Link
                    if ((normHref === normUrl || href === currentPath) && text.includes(keyword.toLowerCase())) {
                        hasKeywordLink = true;
                    }
                    
                    // Check Brand Link (Trỏ về trang chủ, bất kể đoạn text là gì)
                    if (normHref === normHomepage || href === '/') {
                        hasBrandLink = true;
                    }
                });

                if (hasKeywordLink && hasBrandLink) {
                    sapoStatus = 'pass';
                    details.push(`✅ Sapo chuẩn: Chứa link Từ khóa trỏ về bài viết và có Link trỏ về trang chủ.`);
                } else {
                    sapoStatus = 'fail';
                    score -= 10;
                    let sapoErr = [];
                    if (!hasKeywordLink) sapoErr.push(`Thiếu link Từ khóa ("${keyword}") trỏ về bài viết`);
                    if (!hasBrandLink) sapoErr.push(`Thiếu Link trỏ về trang chủ`);
                    details.push(`❌ Sapo bị lỗi: ${sapoErr.join(', ')}.`);
                }
            } catch (e) {
                details.push(`⚠️ Không thể phân tích link trong Sapo do URL gốc bị lỗi.`);
            }
        }
    }

    // 9. Featured Image (Ảnh đại diện)
    let featImgStatus = 'none';
    if (opts.featImg) {
        let ogImage = doc.querySelector('meta[property="og:image"]');
        if (ogImage && ogImage.getAttribute('content').trim() !== '') {
            featImgStatus = 'pass';
            details.push(`✅ Bài viết đã được cài đặt Ảnh đại diện (Featured Image).`);
        } else {
            featImgStatus = 'fail';
            score -= 5;
            details.push(`❌ Thiếu Ảnh đại diện (Không tìm thấy thẻ og:image chuẩn SEO).`);
        }
    }

    // 10. Lấy Danh mục (Category)
    let categoryText = '';
    
    // Cách 1: Dùng Schema JSON-LD (Cực kỳ chính xác cho cấu trúc Breadcrumb Cha > Con)
    let schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
    for (let script of schemas) {
        try {
            let json = JSON.parse(script.textContent);
            let graph = json['@graph'] || (Array.isArray(json) ? json : [json]);
            for (let item of graph) {
                if (item['@type'] === 'BreadcrumbList' && item.itemListElement) {
                    // Item đầu là Home, Item cuối là Bài viết. Ở giữa là Danh mục Cha > Con
                    let cats = item.itemListElement
                        .filter(el => el.position > 1 && el.position < item.itemListElement.length)
                        .map(el => el.name || (el.item && el.item.name));
                    if (cats.length > 0) {
                        categoryText = cats.join(' > ');
                        break;
                    }
                }
            }
        } catch(e) {}
        if (categoryText) break;
    }

    // Cách 2: Lấy thẻ mặc định của WordPress (a rel="category tag")
    if (!categoryText) {
        let catLinks = Array.from(doc.querySelectorAll('a[rel="category tag"]'));
        if (catLinks.length > 0) {
            categoryText = catLinks.map(a => a.textContent.trim()).join(', ');
        }
    }

    // Cách 3: Lấy từ Meta
    if (!categoryText) {
        let metaCat = doc.querySelector('meta[property="article:section"]');
        if (metaCat) categoryText = metaCat.getAttribute('content').trim();
    }

    if (!categoryText) {
        categoryText = "Không phân loại";
    }

    // 11. Trích xuất Schema (Cấu trúc dữ liệu)
    let schemaList = new Set();
    // schemas array đã được lấy ở trên phần Danh mục
    schemas.forEach(script => {
        try {
            let json = JSON.parse(script.textContent);
            
            // Dùng đệ quy lùng sục mọi ngóc ngách của file JSON để nhặt ra các @type
            function extractTypes(obj) {
                if (!obj) return;
                if (Array.isArray(obj)) {
                    obj.forEach(item => extractTypes(item));
                } else if (typeof obj === 'object') {
                    if (typeof obj['@type'] === 'string') {
                        schemaList.add(obj['@type']);
                    } else if (Array.isArray(obj['@type'])) {
                        obj['@type'].forEach(t => {
                            if (typeof t === 'string') schemaList.add(t);
                        });
                    }
                    // Tiếp tục đào sâu vào các node con (như author, publisher, v.v.)
                    Object.values(obj).forEach(val => extractTypes(val));
                }
            }
            
            extractTypes(json);
        } catch(e) {}
    });

    let schemaText = schemaList.size > 0 ? Array.from(schemaList).join(', ') : 'Không có Schema';

    // 12. So khớp Danh mục
    let catMatchStatus = 'none';
    if (expectedCategory) {
        let actualCatLower = categoryText.toLowerCase().trim();
        let expectedCatLower = expectedCategory.toLowerCase().trim();
        // So khớp: danh mục thực tế phải chứa danh mục mong muốn (hỗ trợ cả "Cha > Con")
        let isMatch = actualCatLower.includes(expectedCatLower) || expectedCatLower.includes(actualCatLower);
        
        // Ngoại lệ: nếu yêu cầu là "trang" và thực tế là "không phân loại"
        if (!isMatch && expectedCatLower === 'trang' && actualCatLower === 'không phân loại') {
            isMatch = true;
        }

        if (isMatch) {
            catMatchStatus = 'pass';
            details.push(`✅ Danh mục khớp: "${categoryText}" đúng với yêu cầu "${expectedCategory}".`);
        } else {
            catMatchStatus = 'fail';
            score -= 5;
            // Trong report chỉ ghi ngắn gọn, chi tiết hiện khi bấm Details
            details.push(`❌ Danh mục SAI (thực tế: "${categoryText}", yêu cầu: "${expectedCategory}").`);
        }
    }

    return {
        score: Math.max(0, score),
        urlStatus, titleStatus, descStatus, h1Status, h2h3Status, imgStatus, featImgStatus, wordStatus, kwStatus, sapoStatus, catMatchStatus,
        categoryText, schemaText,
        details, errorMap,
        url
    };
}

function removeVietnameseTones(str) {
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a"); 
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e"); 
    str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i"); 
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o"); 
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u"); 
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y"); 
    str = str.replace(/đ/g,"d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
    str = str.replace(/Đ/g, "D");
    return str;
}

function renderResult(index, data) {
    if (data.error) return; // Mạng lỗi đã render ở trên

    // Cập nhật trạng thái hiển thị của các cột nếu có lỗi
    let table = document.querySelector('table');
    if (data.titleStatus === 'fail' || data.titleStatus === 'warn') table.classList.add('show-title');
    if (data.descStatus === 'fail' || data.descStatus === 'warn') table.classList.add('show-desc');
    if (data.h1Status === 'fail' || data.h1Status === 'warn') table.classList.add('show-h1');
    if (data.h2h3Status === 'fail' || data.h2h3Status === 'warn') table.classList.add('show-h2h3');
    if (data.imgStatus === 'fail' || data.imgStatus === 'warn') table.classList.add('show-img');
    if (data.featImgStatus === 'fail' || data.featImgStatus === 'warn') table.classList.add('show-featimg');
    if (data.wordStatus === 'fail' || data.wordStatus === 'warn') table.classList.add('show-word');
    if (data.kwStatus === 'fail' || data.kwStatus === 'warn') table.classList.add('show-kw');
    if (data.sapoStatus === 'fail' || data.sapoStatus === 'warn') table.classList.add('show-sapo');
    if (data.urlStatus === 'fail' || data.urlStatus === 'warn') table.classList.add('show-urlslug');
    if (data.catMatchStatus === 'fail' || data.catMatchStatus === 'warn') table.classList.add('show-catmatch');

    const row = document.getElementById(`row_${index}`);
    
    // Nút details
    const btn = row.querySelector('.details-btn');
    btn.disabled = false;

    // Score Circle
    let scoreColor = data.score >= 80 ? 'var(--success)' : (data.score >= 50 ? 'var(--warning)' : 'var(--danger)');
    document.getElementById(`score_${index}`).innerHTML = `<div class="score-circle" style="border: 2px solid ${scoreColor}; color: ${scoreColor}">${data.score}</div>`;

    document.getElementById(`title_${index}`).innerHTML = getBadge(data.titleStatus);
    document.getElementById(`desc_${index}`).innerHTML = getBadge(data.descStatus);
    document.getElementById(`h1_${index}`).innerHTML = getBadge(data.h1Status);
    document.getElementById(`h2h3_${index}`).innerHTML = getBadge(data.h2h3Status);
    document.getElementById(`img_${index}`).innerHTML = getBadge(data.imgStatus);
    document.getElementById(`featimg_${index}`).innerHTML = getBadge(data.featImgStatus);
    document.getElementById(`word_${index}`).innerHTML = getBadge(data.wordStatus);
    document.getElementById(`kw_${index}`).innerHTML = data.kwStatus !== 'none' ? getBadge(data.kwStatus) : '<span style="color:var(--text-muted)">-</span>';
    document.getElementById(`category_${index}`).innerHTML = `<span class="badge badge-info" style="max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${data.categoryText}">${data.categoryText}</span>`;
    document.getElementById(`catmatch_${index}`).innerHTML = data.catMatchStatus !== 'none' ? getBadge(data.catMatchStatus) : '<span style="color:var(--text-muted)">-</span>';
    document.getElementById(`schema_${index}`).innerHTML = `<span class="badge badge-warning" style="max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${data.schemaText}">${data.schemaText}</span>`;
    document.getElementById(`sapo_${index}`).innerHTML = data.sapoStatus !== 'none' ? getBadge(data.sapoStatus) : '<span style="color:var(--text-muted)">-</span>';
    document.getElementById(`urlslug_${index}`).innerHTML = data.urlStatus !== 'none' ? getBadge(data.urlStatus) : '<span style="color:var(--text-muted)">-</span>';
}

async function recheckRow(i) {
    let url = window.globalUrls[i];
    let keyword = window.globalKeywords[i] || '';
    let expectedCategory = window.globalCategories[i] || '';
    
    // Reset dòng
    document.getElementById(`score_${i}`).innerHTML = '<span class="badge badge-warning">Đang quét...</span>';
    document.getElementById(`btn_detail_${i}`).disabled = true;
    globalResults[i] = null;
    
    let result = await fetchAndAnalyze(url, keyword, expectedCategory);
    globalResults[i] = result;
    
    if (result.error) {
        document.getElementById(`score_${i}`).innerHTML = `<span class="badge badge-danger">Lỗi Mạng</span>`;
    } else {
        renderResult(i, result);
    }
    generateTextReport();
}

function generateTextReport() {
    let report = [];
    let startSTT = window.globalStartSTT || 1;

    // Hàm rút gọn 1 dòng lỗi chi tiết thành cụm từ ngắn gọn
    function shorten(msg) {
        let m = msg.replace(/^[❌⚠️✅]\s*/, '').replace(/\.$/, '').trim();

        // --- URL ---
        if (/Cấu trúc URL.*không chứa từ khóa/i.test(m)) return 'URL thiếu Key';
        if (/Đuôi URL.*số rác/i.test(m)) return 'sai url';
        if (/URL không hợp lệ/i.test(m)) return 'URL lỗi';

        // --- Title ---
        if (/Thiếu thẻ Title/i.test(m)) return 'Thiếu title';
        if (/Title dài.*ký tự/i.test(m)) {
            let len = m.match(/(\d+)\s*ký tự/);
            let n = len ? parseInt(len[1]) : 0;
            return n < 45 ? 'Title ngắn' : 'Title dài';
        }

        // --- Meta Description ---
        if (/Thiếu thẻ Meta Description/i.test(m)) return 'Thiếu meta';
        if (/Description dài.*ký tự/i.test(m)) {
            let len = m.match(/(\d+)\s*ký tự/);
            let n = len ? parseInt(len[1]) : 0;
            return n < 140 ? 'Meta ngắn' : 'Meta dài';
        }

        // --- H1 ---
        if (/Thiếu thẻ H1/i.test(m)) return 'Thiếu H1';
        if (/quá nhiều thẻ H1/i.test(m)) {
            let cnt = m.match(/\((\d+)\s*thẻ\)/);
            return cnt ? `Có ${cnt[1]} H1` : 'Nhiều H1';
        }

        // --- H2/H3 ---
        if (/H2.*chỉ có duy nhất 1 thẻ H3/i.test(m)) return 'H2 chỉ có 1 H3';
        if (/H3.*đứng lơ lửng/i.test(m)) return 'sai cấu trúc h2/h3';

        // --- Ảnh ---
        if (/không có ảnh nào/i.test(m)) return 'Không có ảnh';
        if (/ảnh.*thiếu.*alt/i.test(m)) {
            let cnt = m.match(/(\d+)\/(\d+)/);
            return cnt ? `${cnt[1]}/${cnt[2]} ảnh thiếu alt` : 'Ảnh thiếu alt';
        }

        // --- Featured Image ---
        if (/Thiếu Ảnh đại diện/i.test(m)) return 'Thiếu ảnh đại diện';

        // --- Số từ ---
        if (/Số từ.*\d+/i.test(m)) {
            return 'nội dung ngắn';
        }

        // --- Từ khóa ---
        if (/Từ khóa không nằm ở đầu Title/i.test(m)) return 'Sai quy chuẩn tiêu đề';
        if (/Từ khóa không.*Meta Description/i.test(m)) return 'Meta thiếu Key';
        if (/Từ khóa không.*câu đầu.*Sapo/i.test(m)) return 'Sapo thiếu Key';
        if (/Không tìm thấy đoạn Sapo.*từ khóa/i.test(m)) return 'Không có sapo';
        if (/Từ khóa không.*kết luận/i.test(m)) return 'Kết luận thiếu Key';
        if (/Không tìm thấy.*H2.*kết luận/i.test(m)) return 'Không có H2 kết luận';

        // --- Sapo link ---
        if (/Không tìm thấy đoạn văn Sapo/i.test(m)) return 'Không có sapo';
        if (/Sapo bị lỗi.*Thiếu link Từ khóa.*Thiếu Link.*trang chủ/i.test(m)) return 'Sai link chính nó + Sai anchor';
        if (/Sapo bị lỗi.*Thiếu link Từ khóa/i.test(m)) return 'Sai link chính nó';
        if (/Sapo bị lỗi.*Thiếu Link.*trang chủ/i.test(m)) return 'Sai anchor';
        if (/Không thể phân tích link.*Sapo/i.test(m)) return 'Sapo lỗi URL';

        // --- Danh mục ---
        if (/Chưa có danh mục/i.test(m) || /Không phân loại/i.test(m)) return 'Thiếu danh mục';
        if (/Danh mục SAI/i.test(m) || /Danh mục không khớp/i.test(m)) return 'Sai danh mục';

        // Fallback: cắt ngắn nếu quá dài
        return m.length > 30 ? m.substring(0, 30) + '...' : m;
    }

    globalResults.forEach((res, idx) => {
        if (!res) return;
        let stt = startSTT + idx;

        if (res.error) {
            report.push(`STT ${stt}: Lỗi kết nối`);
            return;
        }

        let errors = res.details.filter(d => d.includes('❌') || d.includes('⚠️'));
        if (errors.length === 0) return;

        // Rút gọn + gộp trùng lặp (ví dụ nhiều H3 đứng 1 mình)
        let shortList = errors.map(shorten);
        let unique = [];
        let seen = {};
        shortList.forEach(s => {
            if (!seen[s]) { seen[s] = true; unique.push(s); }
        });

        report.push(`STT ${stt}: ${unique.join('+')}`);
    });
    
    let reportBox = document.getElementById('reportText');
    if (report.length === 0 && globalResults.filter(r => r).length > 0) {
        reportBox.value = "Tuyệt vời! Tất cả các bài viết đều đạt 100 điểm chuẩn SEO, không có lỗi nào được ghi nhận.";
    } else {
        reportBox.value = report.join('\n');
    }
}

function copyReport() {
    let text = document.getElementById('reportText');
    text.select();
    document.execCommand('copy');
    alert('Đã copy Báo cáo lỗi vào khay nhớ tạm!');
}

function copyExcelReport() {
    let startSTT = window.globalStartSTT || 1;
    let lines = [];

    globalResults.forEach((res, idx) => {
        // Dòng trống trong input → dòng trống trong Excel
        if (res === null || res === undefined) {
            lines.push('');
            return;
        }

        if (res.error) {
            lines.push('Lỗi kết nối');
            return;
        }

        let errors = res.details.filter(d => d.includes('❌') || d.includes('⚠️'));
        if (errors.length === 0) {
            // Bài OK → ô trống trong Excel
            lines.push('');
            return;
        }

        // Dùng lại hàm shorten (copy inline để copyExcelReport tự đứng được)
        function sh(msg) {
            let m = msg.replace(/^[❌⚠️✅]\s*/, '').replace(/\.$/, '').trim();
            if (/Cấu trúc URL.*không chứa từ khóa/i.test(m)) return 'URL thiếu Key';
            if (/Đuôi URL.*số rác/i.test(m)) return 'sai url';
            if (/URL không hợp lệ/i.test(m)) return 'URL lỗi';
            if (/Thiếu thẻ Title/i.test(m)) return 'Thiếu title';
            if (/Title dài.*ký tự/i.test(m)) { let n = parseInt((m.match(/(\d+)\s*ký tự/) || [])[1]||0); return n < 45 ? 'Title ngắn' : 'Title dài'; }
            if (/Thiếu thẻ Meta Description/i.test(m)) return 'Thiếu meta';
            if (/Description dài.*ký tự/i.test(m)) { let n = parseInt((m.match(/(\d+)\s*ký tự/) || [])[1]||0); return n < 140 ? 'Meta ngắn' : 'Meta dài'; }
            if (/Thiếu thẻ H1/i.test(m)) return 'Thiếu H1';
            if (/quá nhiều thẻ H1/i.test(m)) { let c = (m.match(/\((\d+)\s*thẻ\)/) || [])[1]; return c ? `Có ${c} H1` : 'Nhiều H1'; }
            if (/H2.*chỉ có duy nhất 1 thẻ H3/i.test(m)) return 'H2 chỉ có 1 H3';
            if (/H3.*đứng lơ lửng/i.test(m)) return 'sai cấu trúc h2/h3';
            if (/không có ảnh nào/i.test(m)) return 'Không có ảnh';
            if (/ảnh.*thiếu.*alt/i.test(m)) { let c = m.match(/(\d+)\/(\d+)/); return c ? `${c[1]}/${c[2]} ảnh thiếu alt` : 'Ảnh thiếu alt'; }
            if (/Thiếu Ảnh đại diện/i.test(m)) return 'Thiếu ảnh đại diện';
            if (/Số từ.*\d+/i.test(m)) return 'nội dung ngắn';
            if (/Từ khóa không nằm ở đầu Title/i.test(m)) return 'Sai quy chuẩn tiêu đề';
            if (/Từ khóa không.*Meta Description/i.test(m)) return 'Meta thiếu Key';
            if (/Từ khóa không.*câu đầu.*Sapo/i.test(m)) return 'Sapo thiếu Key';
            if (/Không tìm thấy đoạn Sapo.*từ khóa/i.test(m)) return 'Không có sapo';
            if (/Từ khóa không.*kết luận/i.test(m)) return 'Kết luận thiếu Key';
            if (/Không tìm thấy.*H2.*kết luận/i.test(m)) return 'Không có H2 kết luận';
            if (/Không tìm thấy đoạn văn Sapo/i.test(m)) return 'Không có sapo';
            if (/Sapo bị lỗi.*Thiếu link Từ khóa.*Thiếu Link.*trang chủ/i.test(m)) return 'Sai link chính nó + Sai anchor';
            if (/Sapo bị lỗi.*Thiếu link Từ khóa/i.test(m)) return 'Sai link chính nó';
            if (/Sapo bị lỗi.*Thiếu Link.*trang chủ/i.test(m)) return 'Sai anchor';
            if (/Không thể phân tích link.*Sapo/i.test(m)) return 'Sapo lỗi URL';
            if (/Chưa có danh mục/i.test(m) || /Không phân loại/i.test(m)) return 'Thiếu danh mục';
            if (/Danh mục SAI/i.test(m) || /Danh mục không khớp/i.test(m)) return 'Sai danh mục';
            return m.length > 30 ? m.substring(0, 30) + '...' : m;
        }

        let shortList = errors.map(sh);
        let unique = [];
        let seen = {};
        shortList.forEach(s => { if (!seen[s]) { seen[s] = true; unique.push(s); } });
        lines.push(unique.join('+'));
    });

    let text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        alert('✅ Đã copy định dạng Excel! Sếp dán thẳng vào cột trên Excel là xong.');
    }).catch(() => {
        // fallback
        let ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('✅ Đã copy định dạng Excel! Sếp dán thẳng vào cột trên Excel là xong.');
    });
}

function getBadge(status) {
    if (status === 'pass') return `<span class="badge badge-success">OK</span>`;
    if (status === 'warn') return `<span class="badge badge-warning">Cảnh báo</span>`;
    if (status === 'fail') return `<span class="badge badge-danger">Lỗi</span>`;
    return '-';
}

function showDetails(index) {
    const data = globalResults[index];
    if (!data || data.error) return;

    let html = `<p><strong>URL:</strong> <a href="${data.url}" target="_blank" style="color:var(--primary)">${data.url}</a></p>`;
    html += `<ul style="list-style-type:none; padding:0;">`;
    data.details.forEach(d => {
        let color = d.includes('✅') ? 'var(--success)' : (d.includes('❌') ? 'var(--danger)' : 'var(--warning)');
        html += `<li style="margin-bottom:10px; color:${color}; background:rgba(255,255,255,0.05); padding:10px; border-radius:5px;">${d}</li>`;
    });
    html += `</ul>`;

    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('detailModal').style.display = 'flex';
}


