// Kintoneミニプラグイン販売サイト - メインスクリプト（日本語版）

// グローバル変数
let currentLang = 'ja';
let currentCurrency = 'jpy';
let products = [];

// 商品データをロードして表示
async function loadProducts() {
    try {
        const response = await fetch('products.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        products = await response.json();
        
        displayProducts(products);
        hideLoading();
        
    } catch (error) {
        console.error('商品データの読み込みに失敗しました:', error);
        showError();
        hideLoading();
    }
}

// 商品一覧を表示（日本語版）
function displayProducts(products) {
    const gridContainer = document.getElementById('products-grid');
    if (!gridContainer) return;
    
    gridContainer.innerHTML = products.map(product => {
        const title = product.title;
        const summary = product.summary;
        const tags = product.tags;
        const price = currentCurrency === 'usd' ? product.priceUsd || Math.round(product.price / 130) : product.price;
        const currency = currentCurrency === 'usd' ? '$' : '¥';
        const storesUrl = product.storesUrl;
        
        return `
            <div class="kb-product-card">
                <div class="kb-product-image">
                    <img src="${product.image}" alt="${title}" width="280" height="160" loading="lazy">
                </div>
                <div class="kb-product-info">
                    <h3 class="kb-product-title">${title}</h3>
                    <p class="kb-product-summary">${summary}</p>
                    <div class="kb-tags">
                        ${tags.map(tag => `<span class="kb-tag">${tag}</span>`).join('')}
                    </div>
                    <div class="kb-product-meta">
                        <span class="kb-product-price">${currency}${price}</span>
                    </div>
                    <div class="kb-product-actions">
                        <a href="products/${product.slug}.html" class="kb-btn">詳細</a>
                        <a href="${storesUrl}" class="kb-btn kb-btn-primary" target="_blank" rel="noopener">購入</a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ローディング非表示
function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = 'none';
    }
}

// エラー表示
function showError() {
    const error = document.getElementById('error');
    if (error) {
        error.style.display = 'block';
    }
}


// 通貨切り替え
function switchCurrency(currency) {
    currentCurrency = currency;
    localStorage.setItem('preferred-currency', currency);
    
    // ボタンの状態更新
    document.querySelectorAll('.kb-currency-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-currency') === currency);
    });
    
    // 商品表示を更新
    if (products.length > 0) {
        displayProducts(products);
    }
}

// 設定を復元（日本語版）
function restoreSettings() {
    const savedCurrency = localStorage.getItem('preferred-currency');
    
    if (savedCurrency && ['jpy', 'usd'].includes(savedCurrency)) {
        currentCurrency = savedCurrency;
    }
    
    // 通貨ボタンの初期状態を設定
    document.querySelectorAll('.kb-currency-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-currency') === currentCurrency);
    });
}

// トースト表示
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `kb-toast kb-toast-${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// 個別商品ページ用の共通関数
window.loadProductData = async function(slug) {
    try {
        const response = await fetch('../products.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const products = await response.json();
        return products.find(product => product.slug === slug);
    } catch (error) {
        console.error('商品データの読み込みに失敗しました:', error);
        showToast('商品データの読み込みに失敗しました', 'error');
        return null;
    }
};

// 個別商品ページの関連商品を取得
window.getRelatedProducts = function(currentProduct, allProducts, limit = 2) {
    if (!currentProduct || !allProducts) return [];
    
    return allProducts
        .filter(product => 
            product.slug !== currentProduct.slug && 
            product.tags.some(tag => currentProduct.tags.includes(tag))
        )
        .slice(0, limit);
};

// スムーススクロール
function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            
            // 空のhrefやJavaScriptリンクは除外
            if (href === '#' || href.startsWith('#!')) return;
            
            e.preventDefault();
            
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

// 購入ボタンのクリック追跡（アナリティクス用）
function trackPurchaseClick(productTitle, storesUrl) {
    // Google Analytics や他のアナリティクスツール用
    if (typeof gtag !== 'undefined') {
        gtag('event', 'purchase_click', {
            event_category: 'Product',
            event_label: productTitle,
            value: storesUrl
        });
    }
    
    // コンソールログ（開発用）
    console.log('Purchase click tracked:', { productTitle, storesUrl });
}

// 詳細ボタンのクリック追跡
function trackDetailClick(productTitle, detailUrl) {
    if (typeof gtag !== 'undefined') {
        gtag('event', 'detail_click', {
            event_category: 'Product',
            event_label: productTitle,
            value: detailUrl
        });
    }
    
    console.log('Detail click tracked:', { productTitle, detailUrl });
}

// イベントリスナーの設定（日本語版）
function setupEventListeners() {
    document.addEventListener('click', function(e) {
        // 通貨切り替えボタン
        if (e.target.classList.contains('kb-currency-btn')) {
            const currency = e.target.getAttribute('data-currency');
            switchCurrency(currency);
        }
        
        // 購入ボタンのクリック追跡
        const target = e.target.closest('a[href*="stores.jp"]');
        if (target) {
            const productCard = target.closest('.kb-product-card');
            if (productCard) {
                const productTitle = productCard.querySelector('.kb-product-title')?.textContent || 'Unknown';
                trackPurchaseClick(productTitle, target.href);
            }
        }
        
        // 詳細ボタンのクリック追跡
        const detailTarget = e.target.closest('a[href*="products/"]');
        if (detailTarget && (detailTarget.textContent.includes('詳細') || detailTarget.textContent.includes('Details'))) {
            const productCard = detailTarget.closest('.kb-product-card');
            if (productCard) {
                const productTitle = productCard.querySelector('.kb-product-title')?.textContent || 'Unknown';
                trackDetailClick(productTitle, detailTarget.href);
            }
        }
    });
}

// フォームバリデーション（将来の拡張用）
function validateForm(form) {
    const requiredFields = form.querySelectorAll('[required]');
    let isValid = true;
    
    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.setAttribute('aria-invalid', 'true');
            field.classList.add('kb-field-error');
            isValid = false;
        } else {
            field.setAttribute('aria-invalid', 'false');
            field.classList.remove('kb-field-error');
        }
    });
    
    return isValid;
}

// パフォーマンス監視（将来の拡張用）
function measurePerformance() {
    if ('performance' in window) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                if (perfData) {
                    console.log('Page load performance:', {
                        loadTime: perfData.loadEventEnd - perfData.loadEventStart,
                        domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
                        totalTime: perfData.loadEventEnd - perfData.fetchStart
                    });
                }
            }, 0);
        });
    }
}

// アクセシビリティ向上
function enhanceAccessibility() {
    // フォーカス可視性の向上
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            document.body.classList.add('kb-keyboard-focus');
        }
    });
    
    document.addEventListener('mousedown', function() {
        document.body.classList.remove('kb-keyboard-focus');
    });
    
    // 減速モーション設定の検出
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReducedMotion.matches) {
        document.documentElement.style.setProperty('--animation-duration', '0s');
    }
}

// 初期化（日本語版）
async function init() {
    // 設定を復元
    restoreSettings();
    
    // メインページでのみ商品ロード
    if (document.getElementById('products-grid')) {
        await loadProducts();
    }
    
    setupSmoothScroll();
    setupEventListeners();
    enhanceAccessibility();
    measurePerformance();
    
    // ページロード完了のログ
    console.log('Japanese Kintone Mini Plugins site initialized');
}

// DOM読み込み完了時に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// エラーハンドリング
window.addEventListener('error', function(e) {
    console.error('JavaScript error:', e.error);
    
    // 重要なエラーの場合はユーザーに通知
    if (e.error && e.error.message && e.error.message.includes('products.json')) {
        showToast('商品データの読み込みでエラーが発生しました', 'error');
    }
});

// モジュールエクスポート（将来の拡張用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadProducts,
        displayProducts,
        showToast,
        validateForm
    };
}