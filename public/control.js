const params = new URLSearchParams(window.location.search)
const highlightedId = params.get('cart_id') || params.get('review_id') || ''
let token = params.get('token') || window.localStorage.getItem('controlPanelToken') || ''
const lang = 'en'

const i18n = {
  en: {
    dir: 'ltr',
    lang: 'en',
    switchLang: 'English',
    title: 'Merchant control',
    newPayment: 'New payment',
    token: 'Panel token',
    login: 'Login',
    connected: 'Connected',
    updating: 'Updating',
    invalidToken: 'Invalid token',
    updateFailed: 'Unable to update',
    refresh: 'Refresh',
    enableSound: 'Enable sound',
    soundOn: 'Sound on',
    soundOff: 'Sound off',
    newPaymentAlert: 'New payment received',
    empty: 'No payments yet.',
    reviewId: 'Review ID',
    customerId: 'Customer ID',
    country: 'Country',
    card: 'Card type',
    paytabsRef: 'PayTabs ref',
    paytabsWaiting: 'Waiting for PayTabs',
    paytabsOk: 'PayTabs accepted',
    paytabsPending: 'PayTabs pending',
    paytabsFailed: 'PayTabs rejected',
    decisionSuccess: 'Decision: success',
    decisionFailed: 'Decision: failed',
    decisionPending: 'Decision: pending',
    decisionError: 'Decision: issue',
    reasonPlaceholder: 'Reason shown to the customer',
    categoryReview: 'Normal review',
    categoryCurrency: 'Suspicious currency',
    categoryInternational: 'International payment',
    categoryManual: 'Manual review',
    categoryPrecaution: 'Precautionary decline',
    categoryNetwork: 'Network issue',
    success: 'Success',
    failed: 'Failed',
    pending: 'Pending',
    error: 'Network issue',
    saving: 'Saving',
    saveFailed: 'Unable to save decision',
    testTelegram: 'Test Telegram',
    telegramTesting: 'Testing Telegram',
    telegramOk: 'Telegram test message sent',
    telegramFailed: 'Telegram test failed',
    gateway: 'Gateway',
    customerIp: 'Customer IP',
    registerTamara: 'Register Tamara',
    tamaraRegistering: 'Registering Tamara webhook',
    tamaraRegistered: 'Tamara webhook registered',
    tamaraRegisterFailed: 'Tamara webhook registration failed',
    successReason: 'Payment confirmed.',
    failedReason: 'Payment was not completed.',
    pendingReason: 'Payment is under review.',
    errorReason: 'A network or payment processing issue occurred.'
  }
}

const authForm = document.getElementById('authForm')
const tokenInput = document.getElementById('tokenInput')
const controlApp = document.getElementById('controlApp')
const reviewsList = document.getElementById('reviewsList')
const panelStatus = document.getElementById('panelStatus')
const refreshButton = document.getElementById('refreshButton')
const telegramTestButton = document.getElementById('telegramTestButton')
const tamaraWebhookButton = document.getElementById('tamaraWebhookButton')
const soundToggleButton = document.getElementById('soundToggleButton')
const baseDocumentTitle = document.title
let soundEnabled = window.localStorage.getItem('controlSoundEnabled') === 'true'
let audioContext = null
let firstReviewsLoad = true
let knownReviewIds = new Set()
let alertTitleTimer = null

applyLanguage()
updateSoundButton()

if (token) {
  tokenInput.value = token
  window.localStorage.setItem('controlPanelToken', token)
  showApp()
  loadReviews()
} else {
  showAuth()
}

authForm.addEventListener('submit', (event) => {
  event.preventDefault()
  token = tokenInput.value.trim()
  if (!token) return
  window.localStorage.setItem('controlPanelToken', token)
  showApp()
  loadReviews()
})

refreshButton.addEventListener('click', loadReviews)
telegramTestButton.addEventListener('click', testTelegram)
tamaraWebhookButton.addEventListener('click', registerTamaraWebhook)
soundToggleButton.addEventListener('click', toggleSound)
setInterval(() => {
  if (token) loadReviews()
}, 3000)

function applyLanguage() {
  const t = i18n[lang]
  document.documentElement.lang = t.lang
  document.documentElement.dir = t.dir
  document.getElementById('controlTitle').textContent = t.title
  document.getElementById('newPaymentLink').textContent = t.newPayment
  document.getElementById('tokenLabel').textContent = t.token
  document.getElementById('loginButton').textContent = t.login
  refreshButton.textContent = t.refresh
  telegramTestButton.textContent = t.testTelegram
  tamaraWebhookButton.textContent = t.registerTamara
  updateSoundButton()
  panelStatus.textContent = t.connected
}

function showApp() {
  authForm.hidden = true
  controlApp.hidden = false
}

function showAuth() {
  authForm.hidden = false
  controlApp.hidden = true
}

async function loadReviews() {
  const t = i18n[lang]
  panelStatus.textContent = t.updating
  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token))
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      window.localStorage.removeItem('controlPanelToken')
      token = ''
      showAuth()
      panelStatus.textContent = t.invalidToken
      return
    }
    if (!response.ok) throw new Error(data.error || 'Failed')
    const reviews = data.reviews || []
    handleNewReviews(reviews)
    renderReviews(reviews)
    panelStatus.textContent = t.connected
  } catch (error) {
    console.error(error)
    panelStatus.textContent = t.updateFailed
  }
}

async function toggleSound() {
  soundEnabled = !soundEnabled
  window.localStorage.setItem('controlSoundEnabled', String(soundEnabled))
  updateSoundButton()

  if (soundEnabled) {
    await playBell()
  }
}

function updateSoundButton() {
  if (!soundToggleButton) return

  const t = i18n[lang]
  soundToggleButton.textContent = soundEnabled ? t.soundOn : t.enableSound
  soundToggleButton.setAttribute('aria-pressed', String(soundEnabled))
  soundToggleButton.classList.toggle('is-active', soundEnabled)
}

function handleNewReviews(reviews) {
  const currentIds = new Set(reviews.map((review) => review.id).filter(Boolean))

  if (firstReviewsLoad) {
    knownReviewIds = currentIds
    firstReviewsLoad = false
    return
  }

  const newReviews = reviews.filter((review) => review.id && !knownReviewIds.has(review.id))
  knownReviewIds = currentIds

  if (!newReviews.length) return

  showNewPaymentAlert(newReviews[0])
  if (soundEnabled) playBell()
}

function showNewPaymentAlert(review) {
  const t = i18n[lang]
  panelStatus.textContent = t.newPaymentAlert
  document.body.classList.add('has-new-payment')
  window.clearTimeout(alertTitleTimer)
  document.title = t.newPaymentAlert + ' - ' + baseDocumentTitle

  alertTitleTimer = window.setTimeout(() => {
    document.body.classList.remove('has-new-payment')
    document.title = baseDocumentTitle
  }, 4500)

  if (review.id && highlightedId !== review.id) {
    window.sessionStorage.setItem('latestPaymentReviewId', review.id)
  }
}

async function playBell() {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)()
    if (audioContext.state === 'suspended') await audioContext.resume()

    playTone(880, 0.08, 0)
    playTone(1175, 0.12, 0.11)
  } catch (error) {
    console.warn('Unable to play alert sound', error)
  }
}

function playTone(frequency, duration, delay) {
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  const startAt = audioContext.currentTime + delay
  const stopAt = startAt + duration

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, startAt)
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt)
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start(startAt)
  oscillator.stop(stopAt + 0.02)
}

function renderReviews(reviews) {
  const t = i18n[lang]
  if (!reviews.length) {
    reviewsList.innerHTML = `<p class="empty-state">${t.empty}</p>`
    return
  }

  reviewsList.innerHTML = reviews.map(renderReview).join('')
  reviewsList.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => decide(button.dataset.id, button.dataset.action))
  })
}

function renderReview(review) {
  const t = i18n[lang]
  const actualLabel = getActualLabel(review)
  const decisionLabel = getDecisionLabel(review)
  const amount = review.amount ? formatAmount(review.amount, review.currency || 'SAR') : '-'
  const isHighlighted = highlightedId && highlightedId === review.id
  const successDisabled = !review.actualAccepted || Boolean(review.decision)
  const disabled = Boolean(review.decision)
  const reasonOptions = [
    t.categoryReview,
    t.categoryCurrency,
    t.categoryInternational,
    t.categoryManual,
    t.categoryPrecaution,
    t.categoryNetwork
  ]
  const country = review.customerCountry || review.cardCountry || '-'
  const card = [review.cardType, review.cardScheme].filter(Boolean).join(' / ') || '-'
  const gateway = review.gateway || review.provider || '-'

  return `
    <article class="review-item ${isHighlighted ? 'is-highlighted' : ''}">
      <div class="review-main">
        <div>
          <span class="status-pill ${review.actualAccepted ? 'is-ok' : getStatusClass(review.actualStatus)}">${actualLabel}</span>
          ${decisionLabel ? `<span class="status-pill is-manual">${decisionLabel}</span>` : ''}
        </div>
        <h2>${amount}</h2>
        <div class="review-meta">
          <p><strong>${t.reviewId}:</strong> ${escapeHtml(review.id)}</p>
          <p><strong>${t.customerId}:</strong> ${escapeHtml(review.customerId || review.cartId || review.id)}</p>
          <p><strong>${t.gateway}:</strong> ${escapeHtml(gateway)}</p>
          <p><strong>${t.customerIp}:</strong> ${escapeHtml(review.customerIp || '-')}</p>
          <p><strong>${t.country}:</strong> ${escapeHtml(country)}</p>
          <p><strong>${t.card}:</strong> ${escapeHtml(card)}</p>
          ${review.tranRef || review.gatewayOrderId ? `<p><strong>${t.paytabsRef}:</strong> ${escapeHtml(review.tranRef || review.gatewayOrderId)}</p>` : ''}
        </div>
        ${review.actualMessage ? `<p class="muted">${escapeHtml(review.actualMessage)}</p>` : ''}
      </div>
      <div class="review-actions">
        <select id="category-${cssEscape(review.id)}" ${disabled ? 'disabled' : ''}>
          ${reasonOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
        </select>
        <textarea class="reason-input" id="reason-${cssEscape(review.id)}" rows="3" placeholder="${t.reasonPlaceholder}" ${disabled ? 'disabled' : ''}></textarea>
        <div class="button-row">
          <button class="decision-button success" type="button" data-id="${escapeHtml(review.id)}" data-action="success" ${successDisabled ? 'disabled' : ''}>${t.success}</button>
          <button class="decision-button failed" type="button" data-id="${escapeHtml(review.id)}" data-action="failed" ${disabled ? 'disabled' : ''}>${t.failed}</button>
          <button class="decision-button pending" type="button" data-id="${escapeHtml(review.id)}" data-action="pending" ${disabled ? 'disabled' : ''}>${t.pending}</button>
          <button class="decision-button error" type="button" data-id="${escapeHtml(review.id)}" data-action="error" ${disabled ? 'disabled' : ''}>${t.error}</button>
        </div>
      </div>
    </article>
  `
}

async function decide(id, status) {
  const t = i18n[lang]
  const categorySelect = document.getElementById('category-' + cssEscape(id))
  const reasonInput = document.getElementById('reason-' + cssEscape(id))
  const category = categorySelect?.value || ''
  const reason = reasonInput?.value.trim() || getReason(status)
  panelStatus.textContent = t.saving

  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, category, reason })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Decision failed')
    await loadReviews()
  } catch (error) {
    console.error(error)
    panelStatus.textContent = error.message || t.saveFailed
  }
}

async function testTelegram() {
  const t = i18n[lang]
  panelStatus.textContent = t.telegramTesting
  telegramTestButton.disabled = true

  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test-telegram' })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) throw new Error(data.error || t.telegramFailed)
    panelStatus.textContent = t.telegramOk
  } catch (error) {
    console.error(error)
    panelStatus.textContent = `${t.telegramFailed}: ${error.message || ''}`.trim()
  } finally {
    telegramTestButton.disabled = false
  }
}

async function registerTamaraWebhook() {
  const t = i18n[lang]
  panelStatus.textContent = t.tamaraRegistering
  tamaraWebhookButton.disabled = true

  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register-tamara-webhook' })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok === false) throw new Error(data.error || t.tamaraRegisterFailed)
    panelStatus.textContent = t.tamaraRegistered
  } catch (error) {
    console.error(error)
    panelStatus.textContent = `${t.tamaraRegisterFailed}: ${error.message || ''}`.trim()
  } finally {
    tamaraWebhookButton.disabled = false
  }
}

function getReason(status) {
  const t = i18n[lang]
  if (status === 'success') return t.successReason
  if (status === 'failed') return t.failedReason
  if (status === 'error') return t.errorReason
  return t.pendingReason
}

function getActualLabel(review) {
  const gatewayName = review.gateway || review.provider || 'Gateway'
  if (!review.actualStatus) return gatewayName + ' waiting'
  if (review.actualAccepted) return gatewayName + ' accepted'
  if (['H', 'P', 'new', 'session_requested', 'checkout_created'].includes(review.actualStatus)) return gatewayName + ' pending'
  return gatewayName + ' rejected'
}

function getStatusClass(status) {
  if (['H', 'P', 'new', 'session_requested', 'checkout_created'].includes(status)) return 'is-pending'
  return 'is-warn'
}

function getDecisionLabel(review) {
  const t = i18n[lang]
  if (!review.decision) return ''
  if (review.decision.status === 'success') return t.decisionSuccess
  if (review.decision.status === 'failed') return t.decisionFailed
  if (review.decision.status === 'error') return t.decisionError
  return t.decisionPending
}

function formatAmount(value, currencyCode) {
  const number = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(number)) return escapeHtml(value + ' ' + currencyCode)
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', { style: 'currency', currency: currencyCode }).format(number)
  } catch {
    return number.toFixed(2) + ' ' + currencyCode
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character])
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value)
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-')
}
