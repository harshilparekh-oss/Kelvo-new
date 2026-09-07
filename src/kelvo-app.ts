import {
  Product,
  Order,
  seedProductsIfEmpty,
  subscribeToProducts,
  subscribeToOrders,
  placeOrder,
  updateProductStock,
  updateOrderStatus,
  resetLaunchStock,
  WHATSAPP_NUMBER,
  ADMIN_PASSWORD,
} from './firebase';
import { initWhatsAppConcierge, KELVO_WHATSAPP_DISPLAY } from './whatsapp-concierge';

// Helper to format currency
const formatInr = (num: number) => `₹${num.toLocaleString('en-IN')}`;

// Cache of current live products from Firestore
let currentProducts: Record<string, Product> = {};
let activeModalFlavorId: string = 'hazelnut';
let activeModalFormat: string = '500ml Bottle';
let activeModalUnitPrice: number = 549;
let activeModalQuantity: number = 1;

/**
 * Initialize application backend integrations
 */
export async function initKelvoApp() {
  console.log('[Kelvo] Initializing Backend & Realtime Database...');

  // 1. Seed launch stock if Firestore products collection is empty
  await seedProductsIfEmpty();

  // 2. Setup Real-time stock listener for the 4 flavor cards
  setupLiveStockListeners();

  // 3. Setup Order Modal interactions
  setupOrderModal();

  // 4. Setup WhatsApp floating button and footer QR code
  setupWhatsAppLinks();
  initWhatsAppConcierge();

  // 5. Setup Admin Routing & Dashboard
  setupAdminRouter();
}

/**
 * Live stock listener: updates badges & preorder flags on the 4 flavor cards in real time
 */
function setupLiveStockListeners() {
  subscribeToProducts((products) => {
    currentProducts = products;

    const flavorKeys = ['hazelnut', 'vanilla', 'whiskey', 'caramel'];

    flavorKeys.forEach((key) => {
      const product = products[key];
      if (!product) return;

      const card = document.getElementById(`card-${key}`);
      if (!card) return;

      // Find or create live stock badge container in card-top-info
      let badgeEl = card.querySelector('.card-stock-badge') as HTMLElement;
      if (!badgeEl) {
        badgeEl = document.createElement('div');
        badgeEl.className = 'card-stock-badge';
        const topInfo = card.querySelector('.card-top-info');
        if (topInfo) {
          topInfo.appendChild(badgeEl);
        }
      }

      // Update badge based on stock rules:
      // - If stock > 10: show nothing extra, normal "ADD" button, label unchanged.
      // - If stock is 1–10: show small badge "Only {stock} left" in card's accent color.
      // - If stock is 0: badge changes to "PRE-ORDER — ships when restocked", "+" button still works.
      const addBtn = card.querySelector('.card-add-btn') as HTMLButtonElement;

      if (product.stock > 10) {
        badgeEl.style.display = 'none';
        badgeEl.innerHTML = '';
        if (addBtn) {
          addBtn.setAttribute('data-preorder', 'false');
          const btnSpan = addBtn.querySelector('span');
          if (btnSpan && !addBtn.classList.contains('is-added')) {
            btnSpan.textContent = 'ADD';
          }
        }
      } else if (product.stock >= 1 && product.stock <= 10) {
        badgeEl.style.display = 'inline-flex';
        badgeEl.className = 'card-stock-badge badge-low-stock';
        badgeEl.innerHTML = `<span class="badge-dot"></span>Only ${product.stock} left`;
        if (addBtn) {
          addBtn.setAttribute('data-preorder', 'false');
          const btnSpan = addBtn.querySelector('span');
          if (btnSpan && !addBtn.classList.contains('is-added')) {
            btnSpan.textContent = 'ADD';
          }
        }
      } else {
        // Stock is 0 -> PRE-ORDER
        badgeEl.style.display = 'inline-flex';
        badgeEl.className = 'card-stock-badge badge-preorder';
        badgeEl.innerHTML = `<span class="badge-dot pulse"></span>PRE-ORDER — ships when restocked`;
        if (addBtn) {
          addBtn.setAttribute('data-preorder', 'true');
          const btnSpan = addBtn.querySelector('span');
          if (btnSpan && !addBtn.classList.contains('is-added')) {
            btnSpan.textContent = 'PRE-ORDER';
          }
        }
      }

      // Update live price display if format is 500ml or card default
      const priceEl = card.querySelector('.card-price') as HTMLElement;
      if (priceEl && card.querySelector('.format-pill.active')?.getAttribute('data-format') === '500ml Bottle') {
        priceEl.textContent = formatInr(product.price);
      }
    });

    // Update modal if open
    updateModalPricingAndStock();

    // If Admin dashboard is open, refresh inventory table
    renderAdminInventory();
  });
}

/**
 * Setup Order Modal DOM and Event Listeners
 */
function setupOrderModal() {
  const modalOverlay = document.getElementById('order-modal-overlay');
  const modalCloseBtn = document.getElementById('order-modal-close');
  const qtyMinusBtn = document.getElementById('order-qty-minus');
  const qtyPlusBtn = document.getElementById('order-qty-plus');
  const qtyInput = document.getElementById('order-qty-val') as HTMLInputElement;
  const orderForm = document.getElementById('order-checkout-form') as HTMLFormElement;

  // Intercept all flavor card ADD buttons to open modal
  const flavorAddButtons = document.querySelectorAll('.card-add-btn');
  flavorAddButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const card = btn.closest('.flavor-card') as HTMLElement;
      const flavorAttr = btn.getAttribute('data-flavor') || 'Hazelnut';
      const flavorId = flavorAttr.toLowerCase();
      const activeFormatPill = card?.querySelector('.format-pill.active');
      const formatName = activeFormatPill?.getAttribute('data-format') || '500ml Bottle';
      const formatPriceAttr = activeFormatPill?.getAttribute('data-price');
      
      // Default to product price from Firestore if available, otherwise parse format pill
      const product = currentProducts[flavorId];
      let unitPrice = product ? product.price : 549;
      if (formatPriceAttr) {
        const parsed = parseInt(formatPriceAttr.replace(/[^\d]/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) {
          unitPrice = parsed;
        }
      }

      openOrderModal(flavorId, formatName, unitPrice);
    });
  });

  // Quantity stepper controls
  if (qtyMinusBtn && qtyInput) {
    qtyMinusBtn.addEventListener('click', () => {
      if (activeModalQuantity > 1) {
        activeModalQuantity--;
        qtyInput.value = String(activeModalQuantity);
        updateModalPricingAndStock();
      }
    });
  }

  if (qtyPlusBtn && qtyInput) {
    qtyPlusBtn.addEventListener('click', () => {
      activeModalQuantity++;
      qtyInput.value = String(activeModalQuantity);
      updateModalPricingAndStock();
    });
  }

  if (qtyInput) {
    qtyInput.addEventListener('change', () => {
      let val = parseInt(qtyInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      activeModalQuantity = val;
      qtyInput.value = String(activeModalQuantity);
      updateModalPricingAndStock();
    });
  }

  // Close modal controls
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeOrderModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeOrderModal();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOrderModal();
    }
  });

  // Handle Order Submission
  if (orderForm) {
    orderForm.addEventListener('submit', handleOrderSubmit);
  }
}

/**
 * Open Order Modal with selected flavor
 */
function openOrderModal(flavorId: string, formatName: string, unitPrice: number) {
  activeModalFlavorId = flavorId;
  activeModalFormat = formatName;
  activeModalUnitPrice = unitPrice;
  activeModalQuantity = 1;

  const modalOverlay = document.getElementById('order-modal-overlay');
  const qtyInput = document.getElementById('order-qty-val') as HTMLInputElement;
  const formView = document.getElementById('order-modal-form-view');
  const successView = document.getElementById('order-modal-success-view');
  const errorMsg = document.getElementById('order-modal-error');

  if (qtyInput) qtyInput.value = '1';
  if (formView) formView.style.display = 'block';
  if (successView) successView.style.display = 'none';
  if (errorMsg) errorMsg.textContent = '';

  updateModalPricingAndStock();

  if (modalOverlay) {
    modalOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close Order Modal
 */
function closeOrderModal() {
  const modalOverlay = document.getElementById('order-modal-overlay');
  if (modalOverlay) {
    modalOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

/**
 * Recalculate and update the pricing and pre-order warning in the order modal
 */
function updateModalPricingAndStock() {
  const modalOverlay = document.getElementById('order-modal-overlay');
  if (!modalOverlay || !modalOverlay.classList.contains('is-open')) return;

  const product = currentProducts[activeModalFlavorId] || {
    id: activeModalFlavorId,
    name: activeModalFlavorId.toUpperCase(),
    price: activeModalUnitPrice,
    tastingNote: '',
    stock: 0,
    isPreorder: true,
  };

  const nameEl = document.getElementById('modal-flavor-name');
  const noteEl = document.getElementById('modal-flavor-note');
  const formatEl = document.getElementById('modal-format-name');
  const unitPriceEl = document.getElementById('modal-unit-price');
  const stockBadgeEl = document.getElementById('modal-stock-badge');
  const totalAmountEl = document.getElementById('modal-total-amount');
  const submitBtn = document.getElementById('order-submit-btn');

  if (nameEl) nameEl.textContent = product.name;
  if (noteEl) noteEl.textContent = product.tastingNote;
  if (formatEl) formatEl.textContent = activeModalFormat;
  if (unitPriceEl) unitPriceEl.textContent = formatInr(activeModalUnitPrice);

  const total = activeModalUnitPrice * activeModalQuantity;
  if (totalAmountEl) totalAmountEl.textContent = formatInr(total);

  // Check if stock is sufficient or pre-order
  const willBePreorder = product.stock <= 0 || product.stock < activeModalQuantity;

  if (stockBadgeEl) {
    if (product.stock > 10) {
      stockBadgeEl.className = 'modal-stock-status in-stock';
      stockBadgeEl.innerHTML = `<span>● In Stock</span> (${product.stock} available)`;
    } else if (product.stock >= 1) {
      if (willBePreorder) {
        stockBadgeEl.className = 'modal-stock-status preorder';
        stockBadgeEl.innerHTML = `<span>⚡ High Demand</span> (Only ${product.stock} left in batch — excess units become Pre-Order)`;
      } else {
        stockBadgeEl.className = 'modal-stock-status low-stock';
        stockBadgeEl.innerHTML = `<span>● Low Stock</span> (Only ${product.stock} left)`;
      }
    } else {
      stockBadgeEl.className = 'modal-stock-status preorder';
      stockBadgeEl.innerHTML = `<span>⚡ PRE-ORDER</span> (Batch 04 Roasting — ships on restock)`;
    }
  }

  if (submitBtn) {
    const btnSpan = submitBtn.querySelector('span');
    if (btnSpan) {
      btnSpan.textContent = willBePreorder
        ? `CONFIRM PRE-ORDER • ${formatInr(total)}`
        : `CONFIRM ORDER • ${formatInr(total)}`;
    }
  }
}

/**
 * Handle form submission in the Order Modal
 */
async function handleOrderSubmit(e: Event) {
  e.preventDefault();

  const nameInput = document.getElementById('order-customer-name') as HTMLInputElement;
  const phoneInput = document.getElementById('order-customer-phone') as HTMLInputElement;
  const emailInput = document.getElementById('order-customer-email') as HTMLInputElement;
  const addressInput = document.getElementById('order-customer-address') as HTMLTextAreaElement;
  const errorMsg = document.getElementById('order-modal-error');
  const submitBtn = document.getElementById('order-submit-btn') as HTMLButtonElement;

  if (errorMsg) errorMsg.textContent = '';

  const customerName = nameInput?.value.trim() || '';
  const phone = phoneInput?.value.trim() || '';
  const email = emailInput?.value.trim() || '';
  const deliveryAddress = addressInput?.value.trim() || '';

  // Basic Validation: don't allow empty name, invalid phone number, or empty address
  if (!customerName || customerName.length < 2) {
    if (errorMsg) errorMsg.textContent = 'Please enter your full name.';
    nameInput?.focus();
    return;
  }

  const cleanPhone = phone.replace(/[^\d+]/g, '');
  if (!cleanPhone || cleanPhone.length < 10) {
    if (errorMsg) errorMsg.textContent = 'Please enter a valid 10-digit mobile number for WhatsApp updates.';
    phoneInput?.focus();
    return;
  }

  if (!deliveryAddress || deliveryAddress.length < 8) {
    if (errorMsg) errorMsg.textContent = 'Please provide your full delivery address and pincode.';
    addressInput?.focus();
    return;
  }

  // Disable button and show spinner state
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add('is-submitting');
  }

  try {
    const product = currentProducts[activeModalFlavorId];
    const flavorName = product ? product.name : activeModalFlavorId.toUpperCase();

    // Perform atomic transaction in Firestore (never lets stock drop below 0)
    const result = await placeOrder({
      customerName,
      phone,
      email,
      deliveryAddress,
      flavorId: activeModalFlavorId,
      flavorName,
      quantity: activeModalQuantity,
      unitPrice: activeModalUnitPrice,
      formatName: activeModalFormat,
    });

    console.log('[Kelvo] Order successfully created with ID:', result.orderId);

    // Switch modal to confirmation state
    const formView = document.getElementById('order-modal-form-view');
    const successView = document.getElementById('order-modal-success-view');

    if (formView) formView.style.display = 'none';
    if (successView) {
      successView.style.display = 'block';

      const successId = document.getElementById('success-order-id');
      const successSummary = document.getElementById('success-order-summary');
      const successBadge = document.getElementById('success-order-badge');
      const whatsappBtn = document.getElementById('success-whatsapp-btn') as HTMLAnchorElement;

      if (successId) {
        successId.textContent = `Order Ref: #${result.orderId.substring(0, 8).toUpperCase()}`;
      }

      const totalAmount = activeModalUnitPrice * activeModalQuantity;

      if (successSummary) {
        successSummary.textContent = `${activeModalQuantity}x ${flavorName} (${activeModalFormat}) • Total: ${formatInr(totalAmount)}`;
      }

      if (successBadge) {
        if (result.isPreorder) {
          successBadge.className = 'success-type-badge preorder';
          successBadge.textContent = 'PRE-ORDER REGISTERED';
        } else {
          successBadge.className = 'success-type-badge in-stock';
          successBadge.textContent = 'IN-STOCK CONFIRMED';
        }
      }

      // Pre-filled WhatsApp message URL
      if (whatsappBtn) {
        const orderText = `Hi! I just placed an order: ${activeModalQuantity}x ${flavorName} (${activeModalFormat}, ${formatInr(totalAmount)}). My name is ${customerName}. Order Ref: #${result.orderId.substring(0, 8).toUpperCase()}`;
        const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(orderText)}`;
        whatsappBtn.href = waUrl;
        whatsappBtn.target = '_blank';
        whatsappBtn.rel = 'noopener noreferrer';
      }
    }

    // Clear form inputs for subsequent orders
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (emailInput) emailInput.value = '';
    if (addressInput) addressInput.value = '';
  } catch (err: any) {
    console.error('[Kelvo] Order placement failed:', err);
    if (errorMsg) {
      errorMsg.textContent = `Unable to place order: ${err?.message || 'Please check your connection and try again.'}`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-submitting');
    }
  }
}

/**
 * Setup WhatsApp floating button and Footer QR Code
 */
function setupWhatsAppLinks() {
  const floatingBtn = document.getElementById('floating-whatsapp-btn') as HTMLAnchorElement;
  if (floatingBtn) {
    const defaultText = 'Hi Kelvo! I have a question about...';
    floatingBtn.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(defaultText)}`;
    floatingBtn.target = '_blank';
    floatingBtn.rel = 'noopener noreferrer';
  }

  // Update Footer QR code image with configured WhatsApp number
  const qrImg = document.getElementById('footer-whatsapp-qr-img') as HTMLImageElement;
  if (qrImg) {
    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=Hi%20Kelvo!%20I'd%20like%20to%20know%20more%20about%20your%20coffee%20concentrates.`;
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(waUrl)}`;
  }
}

/**
 * Admin Router & Dashboard
 */
let cachedOrders: Order[] = [];
let isAdminAuthenticated = false;

function setupAdminRouter() {
  // Check session storage
  if (sessionStorage.getItem('kelvo_admin_auth') === 'true') {
    isAdminAuthenticated = true;
  }

  // Listen to browser navigation
  window.addEventListener('popstate', checkAdminRoute);
  window.addEventListener('hashchange', checkAdminRoute);

  // Check on initial load
  checkAdminRoute();

  // Setup password gate form
  const passForm = document.getElementById('admin-password-form');
  if (passForm) {
    passForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const passInput = document.getElementById('admin-password-input') as HTMLInputElement;
      const errorMsg = document.getElementById('admin-password-error');

      if (passInput && passInput.value === ADMIN_PASSWORD) {
        isAdminAuthenticated = true;
        sessionStorage.setItem('kelvo_admin_auth', 'true');
        if (errorMsg) errorMsg.textContent = '';
        renderAdminDashboard();
      } else {
        if (errorMsg) errorMsg.textContent = 'Incorrect password. Access denied.';
        if (passInput) passInput.value = '';
      }
    });
  }

  // Back to Storefront button in admin topbar
  const backBtn = document.getElementById('admin-back-to-store');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToStore();
    });
  }

  // Reset launch stock button in admin
  const resetBtn = document.getElementById('admin-reset-stock-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (confirm('Reset all 4 flavors to launch inventory levels (Hazelnut 40, Vanilla 40, Whiskey 25, Caramel 40)?')) {
        await resetLaunchStock();
        alert('Launch inventory reset successfully.');
      }
    });
  }

  // Subscribe to Orders in real time when admin is active
  subscribeToOrders((orders) => {
    cachedOrders = orders;
    if (isAdminActive()) {
      renderAdminOrders();
      renderAdminSummary();
    }
  });
}

function checkAdminRoute() {
  const path = window.location.pathname;
  const hash = window.location.hash;

  if (path === '/admin' || hash === '#admin' || hash === '#/admin') {
    showAdminView();
  } else {
    showStorefrontView();
  }
}

function isAdminActive(): boolean {
  const adminView = document.getElementById('admin-view');
  return adminView ? adminView.style.display !== 'none' : false;
}

function navigateToStore() {
  if (window.location.pathname === '/admin') {
    window.history.pushState({}, '', '/');
  } else {
    window.location.hash = '';
  }
  showStorefrontView();
}

function showAdminView() {
  const storeView = document.getElementById('storefront-view');
  const adminView = document.getElementById('admin-view');
  const floatingWa = document.getElementById('floating-whatsapp-btn');
  const conciergeContainer = document.getElementById('concierge-floating-container');

  if (storeView) storeView.style.display = 'none';
  if (adminView) adminView.style.display = 'block';
  if (floatingWa) floatingWa.style.display = 'none'; // Hidden on /admin as requested
  if (conciergeContainer) conciergeContainer.style.display = 'none';

  renderAdminDashboard();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showStorefrontView() {
  const storeView = document.getElementById('storefront-view');
  const adminView = document.getElementById('admin-view');
  const floatingWa = document.getElementById('floating-whatsapp-btn');
  const conciergeContainer = document.getElementById('concierge-floating-container');

  if (storeView) storeView.style.display = 'block';
  if (adminView) adminView.style.display = 'none';
  if (floatingWa) floatingWa.style.display = 'flex';
  if (conciergeContainer) conciergeContainer.style.display = 'block';
}

function renderAdminDashboard() {
  const gateEl = document.getElementById('admin-gate-view');
  const mainEl = document.getElementById('admin-main-view');

  if (!isAdminAuthenticated) {
    if (gateEl) gateEl.style.display = 'block';
    if (mainEl) mainEl.style.display = 'none';
    const input = document.getElementById('admin-password-input');
    if (input) input.focus();
  } else {
    if (gateEl) gateEl.style.display = 'none';
    if (mainEl) mainEl.style.display = 'block';

    renderAdminSummary();
    renderAdminInventory();
    renderAdminOrders();
  }
}

/**
 * Render Admin Summary Row
 */
function renderAdminSummary() {
  const todayCountEl = document.getElementById('admin-metric-today');
  const pendingCountEl = document.getElementById('admin-metric-pending');
  const zeroStockAlertEl = document.getElementById('admin-metric-zero-stock');

  // Count orders created today
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let todayCount = 0;
  let pendingCount = 0;

  cachedOrders.forEach((order) => {
    let orderTime = 0;
    if (order.createdAt?.toMillis) {
      orderTime = order.createdAt.toMillis();
    } else if (order.createdAt) {
      orderTime = new Date(order.createdAt).getTime();
    }
    if (orderTime >= startOfToday) {
      todayCount++;
    }
    if (order.status === 'pending') {
      pendingCount++;
    }
  });

  if (todayCountEl) todayCountEl.textContent = String(todayCount);
  if (pendingCountEl) pendingCountEl.textContent = String(pendingCount);

  // Check for any flavors at 0 stock
  const zeroStockFlavors = Object.values(currentProducts).filter((p) => p.stock === 0);

  if (zeroStockAlertEl) {
    if (zeroStockFlavors.length > 0) {
      zeroStockAlertEl.className = 'admin-metric-val metric-alert';
      zeroStockAlertEl.innerHTML = zeroStockFlavors.map((p) => `<span class="zero-pill">${p.name} (0)</span>`).join(' ');
    } else {
      zeroStockAlertEl.className = 'admin-metric-val metric-healthy';
      zeroStockAlertEl.textContent = 'None • All In Stock';
    }
  }
}

/**
 * Render Admin Inventory Panel
 */
function renderAdminInventory() {
  const tableBody = document.getElementById('admin-inventory-table-body');
  if (!tableBody) return;

  const flavors = ['hazelnut', 'vanilla', 'whiskey', 'caramel'];

  tableBody.innerHTML = flavors
    .map((key) => {
      const product = currentProducts[key] || {
        id: key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        price: 549,
        tastingNote: '',
        stock: 0,
        isPreorder: true,
      };

      const isZero = product.stock === 0;

      return `
      <tr class="${isZero ? 'row-zero-stock' : ''}">
        <td class="col-flavor">
          <div class="flavor-name-cell">
            <strong>${product.name}</strong>
            <span class="flavor-note-sub">${product.tastingNote}</span>
          </div>
        </td>
        <td class="col-price">${formatInr(product.price)}</td>
        <td class="col-stock">
          <div class="stock-input-wrap">
            <input
              type="number"
              min="0"
              value="${product.stock}"
              id="admin-stock-input-${product.id}"
              class="admin-stock-input ${isZero ? 'input-zero' : ''}"
              aria-label="Stock count for ${product.name}"
            />
            <button
              type="button"
              class="admin-stock-save-btn"
              data-flavor-id="${product.id}"
              aria-label="Save stock for ${product.name}"
            >
              <span>Save</span>
            </button>
          </div>
        </td>
        <td class="col-status">
          ${
            product.stock > 0
              ? `<span class="status-pill status-instock">In Stock (${product.stock})</span>`
              : `<span class="status-pill status-preorder">Pre-Order Mode</span>`
          }
        </td>
      </tr>
    `;
    })
    .join('');

  // Attach click listeners to Save buttons
  const saveButtons = tableBody.querySelectorAll('.admin-stock-save-btn');
  saveButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const flavorId = btn.getAttribute('data-flavor-id');
      if (!flavorId) return;

      const input = document.getElementById(`admin-stock-input-${flavorId}`) as HTMLInputElement;
      if (!input) return;

      const val = parseInt(input.value, 10);
      if (isNaN(val) || val < 0) {
        alert('Please enter a valid non-negative integer.');
        return;
      }

      btn.classList.add('is-saving');
      btn.innerHTML = '<span>...</span>';

      try {
        await updateProductStock(flavorId, val);
        btn.classList.remove('is-saving');
        btn.classList.add('is-saved');
        btn.innerHTML = '<span>✓</span>';
        setTimeout(() => {
          btn.classList.remove('is-saved');
          btn.innerHTML = '<span>Save</span>';
        }, 1500);
      } catch (err: any) {
        alert(`Failed to update stock: ${err.message}`);
        btn.classList.remove('is-saving');
        btn.innerHTML = '<span>Save</span>';
      }
    });
  });
}

/**
 * Render Admin Orders Panel
 */
function renderAdminOrders() {
  const tableBody = document.getElementById('admin-orders-table-body');
  const countEl = document.getElementById('admin-orders-count');
  if (!tableBody) return;

  if (countEl) {
    countEl.textContent = `(${cachedOrders.length} total)`;
  }

  if (cachedOrders.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-empty-orders">
          No orders received yet. Once a customer places an order, it will appear here instantly.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = cachedOrders
    .map((order) => {
      let dateStr = 'Just now';
      if (order.createdAt?.toMillis) {
        const d = new Date(order.createdAt.toMillis());
        dateStr = d.toLocaleDateString('en-IN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }

      const itemsText = order.items
        .map((it) => `${it.quantity}× ${it.flavor}`)
        .join(', ');

      const waMsg = `Hi ${order.customerName}! Reaching out from Kelvo regarding your order #${order.id.substring(0, 6).toUpperCase()} (${itemsText}).`;
      const waLink = `https://wa.me/${order.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(waMsg)}`;

      return `
      <tr>
        <td class="col-date">${dateStr}</td>
        <td class="col-customer">
          <div class="cust-info">
            <strong>${order.customerName}</strong>
            <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="cust-phone-link" title="Open WhatsApp chat with customer">
              <span>${order.phone}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.34 5L2 22l5.14-1.32C8.58 21.51 10.24 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>
              </svg>
            </a>
            ${order.email ? `<span class="cust-email">${order.email}</span>` : ''}
          </div>
        </td>
        <td class="col-address">
          <div class="address-cell" title="${order.deliveryAddress}">
            ${order.deliveryAddress}
          </div>
        </td>
        <td class="col-items">${itemsText}</td>
        <td class="col-total"><strong>${formatInr(order.totalAmount)}</strong></td>
        <td class="col-type">
          ${
            order.isPreorder
              ? '<span class="status-pill status-preorder">Pre-Order</span>'
              : '<span class="status-pill status-instock">In-Stock</span>'
          }
        </td>
        <td class="col-status-select">
          <select
            class="admin-status-dropdown status-${order.status}"
            data-order-id="${order.id}"
            aria-label="Change order status for ${order.customerName}"
          >
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
            <option value="fulfilled" ${order.status === 'fulfilled' ? 'selected' : ''}>Fulfilled</option>
          </select>
        </td>
      </tr>
    `;
    })
    .join('');

  // Status dropdown change handlers
  const dropdowns = tableBody.querySelectorAll('.admin-status-dropdown');
  dropdowns.forEach((selectEl) => {
    selectEl.addEventListener('change', async (e) => {
      const target = e.target as HTMLSelectElement;
      const orderId = target.getAttribute('data-order-id');
      const newStatus = target.value as 'pending' | 'confirmed' | 'fulfilled';

      if (!orderId) return;

      target.className = `admin-status-dropdown status-${newStatus}`;

      try {
        await updateOrderStatus(orderId, newStatus);
      } catch (err: any) {
        alert(`Failed to update status: ${err.message}`);
      }
    });
  });
}

// Auto-run when module is loaded in browser
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKelvoApp);
  } else {
    initKelvoApp();
  }
}
