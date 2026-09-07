/**
 * KELVO LUXURY COFFEE CONCIERGE (WhatsApp Integration)
 * Phone: +91 91366 26006
 * Located directly under the FAQ section
 */

export const KELVO_WHATSAPP_NUMBER = '919136626006';
export const KELVO_WHATSAPP_DISPLAY = '+91 91366 26006';

export interface ConciergePrompt {
  id: string;
  icon: string;
  label: string;
  query: string;
}

export const CONCIERGE_PROMPTS: ConciergePrompt[] = [
  {
    id: 'oat-milk',
    icon: '🥛',
    label: 'Oat Milk Pairing',
    query: 'Hi Arjun! Which of your 4 concentrates (Hazelnut, Vanilla, Whiskey, Caramel) works best with cold oat milk for iced lattes?',
  },
  {
    id: 'whiskey-profile',
    icon: '🥃',
    label: 'Whiskey Roast Profile',
    query: 'Hi Kelvo team! Tell me more about the Bourbon Barrel Whiskey extract — does it have non-alcoholic oak notes, and how bold is the roast?',
  },
  {
    id: 'dilution-ratio',
    icon: '⚖️',
    label: 'Perfect Dilution Ratio',
    query: 'Hi! What is the ideal water-to-concentrate ratio for a crisp morning Americano vs an afternoon tonic espresso?',
  },
  {
    id: 'restock-status',
    icon: '📦',
    label: 'Batch Restock & Delivery',
    query: 'Hi! I would like to check when the next micro-lot roast batch will dispatch and estimated delivery time to my pincode.',
  },
  {
    id: 'gift-rec',
    icon: '🎁',
    label: 'Gift Recommendation',
    query: 'Hi! Looking to gift a serious coffee lover. Would you recommend the 4-pack discovery sampler or a 500ml single lot?',
  },
  {
    id: 'wholesale',
    icon: '☕',
    label: 'Cafe Kegs / Wholesale',
    query: 'Hi Kelvo! We are interested in serving Kelvo concentrates at our cafe/workspace. Can we get wholesale pricing details?',
  },
];

// High-end gentle acoustic micro-interaction chime
function playChime(type: 'select' | 'copy' | 'scroll' = 'select') {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;

    if (type === 'copy') {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'scroll') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(739.99, now + 0.1);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    }
  } catch {
    // Gracefully ignore audio constraints on restricted browsers
  }
}

let activePromptId = 'oat-milk';
let customerName = '';
let currentCustomMessage = CONCIERGE_PROMPTS[0].query;
let isMobileQrOpen = false;

/**
 * Initialize WhatsApp Concierge in-page section
 */
export function initWhatsAppConcierge() {
  console.log('[Kelvo Concierge] Initializing In-Page WhatsApp Concierge (+91 91366 26006)...');

  renderPromptChips();
  setupConciergeEvents();
  updateLiveChatPreview();
  setupNavScrollLinks();
}

/**
 * Render quick inquiry prompt chips
 */
function renderPromptChips() {
  const container = document.getElementById('concierge-prompt-chips');
  if (!container) return;

  container.innerHTML = CONCIERGE_PROMPTS.map((p) => {
    const isSelected = p.id === activePromptId;
    return `
      <button
        type="button"
        class="concierge-chip ${isSelected ? 'active' : ''}"
        data-prompt-id="${p.id}"
      >
        <span class="chip-icon">${p.icon}</span>
        <span class="chip-label">${p.label}</span>
      </button>
    `;
  }).join('');

  // Attach click listeners to chips
  const chips = container.querySelectorAll('.concierge-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.getAttribute('data-prompt-id');
      if (!id) return;
      selectPrompt(id);
    });
  });
}

/**
 * Handle selecting an inquiry prompt
 */
export function selectPrompt(id: string) {
  activePromptId = id;
  const prompt = CONCIERGE_PROMPTS.find((p) => p.id === id);
  if (prompt) {
    currentCustomMessage = prompt.query;
    const textarea = document.getElementById('concierge-msg-input') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = currentCustomMessage;
    }
  }

  // Update chips active states
  const chips = document.querySelectorAll('.concierge-chip');
  chips.forEach((c) => {
    if (c.getAttribute('data-prompt-id') === id) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  playChime('select');
  updateLiveChatPreview();
}

/**
 * Update the simulated WhatsApp chat preview bubble and target URLs
 */
function updateLiveChatPreview() {
  const previewTextEl = document.getElementById('wa-preview-text');
  const previewTimeEl = document.getElementById('wa-preview-time');
  const sendBtn = document.getElementById('concierge-send-wa-btn') as HTMLAnchorElement;
  const qrImg = document.getElementById('concierge-qr-img') as HTMLImageElement;

  // Format message text with optional name signature
  let fullMessage = currentCustomMessage.trim();
  if (customerName.trim()) {
    fullMessage = `[From ${customerName.trim()}]\n${fullMessage}`;
  }

  if (previewTextEl) {
    previewTextEl.textContent = fullMessage || 'Type your message...';
  }

  if (previewTimeEl) {
    const now = new Date();
    previewTimeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Generate target WhatsApp URL
  const waUrl = `https://wa.me/${KELVO_WHATSAPP_NUMBER}?text=${encodeURIComponent(fullMessage)}`;

  if (sendBtn) {
    sendBtn.href = waUrl;
  }

  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(waUrl)}`;
  }
}

/**
 * Setup smooth scrolling when navigation or footer links click to WhatsApp
 */
function setupNavScrollLinks() {
  const links = document.querySelectorAll('a[href="#whatsapp-concierge"]');
  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToConciergeSection();
    });
  });
}

/**
 * Scroll smoothly to the WhatsApp Roastery Concierge section
 */
export function scrollToConciergeSection() {
  const section = document.getElementById('whatsapp-concierge');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    playChime('scroll');
    const input = document.getElementById('concierge-msg-input');
    if (input) {
      setTimeout(() => input.focus(), 600);
    }
  }
}

// Backward compatibility alias in case other components call openConciergeModal
export const openConciergeModal = scrollToConciergeSection;
export const closeConciergeModal = () => {};

/**
 * Setup events for typing, copying number, and QR toggle in the static section
 */
function setupConciergeEvents() {
  const nameInput = document.getElementById('concierge-name-input') as HTMLInputElement;
  const msgTextarea = document.getElementById('concierge-msg-input') as HTMLTextAreaElement;
  const copyBtn = document.getElementById('concierge-copy-num-btn');
  const toggleQrBtn = document.getElementById('concierge-toggle-qr-btn');
  const qrCard = document.getElementById('concierge-mobile-qr-card');
  const footerCopyBtn = document.getElementById('footer-copy-whatsapp-btn');

  // Typing in Name
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      customerName = nameInput.value;
      updateLiveChatPreview();
    });
  }

  // Typing in Message Textarea
  if (msgTextarea) {
    msgTextarea.value = currentCustomMessage;
    msgTextarea.addEventListener('input', () => {
      currentCustomMessage = msgTextarea.value;
      updateLiveChatPreview();
    });
  }

  // Copy Phone Number button in section header
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(KELVO_WHATSAPP_DISPLAY).then(() => {
        playChime('copy');
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span>✓ Copied!</span>';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    });
  }

  // Copy Phone Number button in footer
  if (footerCopyBtn) {
    footerCopyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(KELVO_WHATSAPP_DISPLAY).then(() => {
        playChime('copy');
        const origText = footerCopyBtn.textContent;
        footerCopyBtn.textContent = '✓ Number Copied!';
        setTimeout(() => {
          footerCopyBtn.textContent = origText;
        }, 2000);
      });
    });
  }

  // Toggle QR Code Card
  if (toggleQrBtn && qrCard) {
    toggleQrBtn.addEventListener('click', () => {
      isMobileQrOpen = !isMobileQrOpen;
      qrCard.style.display = isMobileQrOpen ? 'block' : 'none';
      toggleQrBtn.classList.toggle('active', isMobileQrOpen);
      if (isMobileQrOpen) {
        updateLiveChatPreview();
      }
    });
  }
}

