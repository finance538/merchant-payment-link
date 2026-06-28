const params = new URLSearchParams(window.location.search)
const highlightedId = params.get('cart_id') || params.get('review_id') || ''
let token = params.get('token') || window.localStorage.getItem('controlPanelToken') || ''

const authForm = document.getElementById('authForm')
const tokenInput = document.getElementById('tokenInput')
const controlApp = document.getElementById('controlApp')
const reviewsList = document.getElementById('reviewsList')
const panelStatus = document.getElementById('panelStatus')
const refreshButton = document.getElementById('refreshButton')

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
setInterval(() => {
  if (token) loadReviews()
}, 3000)

function showApp() {
  authForm.hidden = true
  controlApp.hidden = false
}

function showAuth() {
  authForm.hidden = false
  controlApp.hidden = true
}

async function loadReviews() {
  panelStatus.textContent = 'جار التحديث'
  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token))
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      window.localStorage.removeItem('controlPanelToken')
      token = ''
      showAuth()
      panelStatus.textContent = 'رمز غير صحيح'
      return
    }
    if (!response.ok) throw new Error(data.error || 'Failed')
    renderReviews(data.reviews || [])
    panelStatus.textContent = 'متصل'
  } catch (error) {
    console.error(error)
    panelStatus.textContent = 'تعذر التحديث'
  }
}

function renderReviews(reviews) {
  if (!reviews.length) {
    reviewsList.innerHTML = '<p class="empty-state">لا توجد عمليات حالياً.</p>'
    return
  }

  reviewsList.innerHTML = reviews.map(renderReview).join('')
  reviewsList.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => decide(button.dataset.id, button.dataset.action))
  })
}

function renderReview(review) {
  const actualLabel = getActualLabel(review)
  const decisionLabel = getDecisionLabel(review)
  const amount = review.amount ? formatAmount(review.amount, review.currency || 'SAR') : '-'
  const isHighlighted = highlightedId && highlightedId === review.id
  const successDisabled = !review.actualAccepted || Boolean(review.decision)
  const disabled = Boolean(review.decision)
  const reasonOptions = [
    'مراجعة عادية',
    'عملة مشتبهة',
    'دفع دولي',
    'مراجعة يدوية',
    'رفض احترازي'
  ]

  return `
    <article class="review-item ${isHighlighted ? 'is-highlighted' : ''}">
      <div class="review-main">
        <div>
          <span class="status-pill ${review.actualAccepted ? 'is-ok' : 'is-warn'}">${actualLabel}</span>
          ${decisionLabel ? `<span class="status-pill is-manual">${decisionLabel}</span>` : ''}
        </div>
        <h2>${amount}</h2>
        <p class="muted">رقم المراجعة: ${escapeHtml(review.id)}</p>
        ${review.tranRef ? `<p class="muted">رقم PayTabs: ${escapeHtml(review.tranRef)}</p>` : ''}
        ${review.actualMessage ? `<p class="muted">${escapeHtml(review.actualMessage)}</p>` : ''}
      </div>
      <div class="review-actions">
        <select id="reason-${cssEscape(review.id)}" ${disabled ? 'disabled' : ''}>
          ${reasonOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}
        </select>
        <div class="button-row">
          <button class="decision-button success" type="button" data-id="${escapeHtml(review.id)}" data-action="success" ${successDisabled ? 'disabled' : ''}>ناجح</button>
          <button class="decision-button failed" type="button" data-id="${escapeHtml(review.id)}" data-action="failed" ${disabled ? 'disabled' : ''}>فاشل</button>
          <button class="decision-button pending" type="button" data-id="${escapeHtml(review.id)}" data-action="pending" ${disabled ? 'disabled' : ''}>معلق</button>
        </div>
      </div>
    </article>
  `
}

async function decide(id, status) {
  const select = document.getElementById('reason-' + cssEscape(id))
  const reason = getReason(status, select?.value || '')
  panelStatus.textContent = 'جار الحفظ'

  try {
    const response = await fetch('/api/payment-control?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, category: select?.value || '', reason })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Decision failed')
    await loadReviews()
  } catch (error) {
    console.error(error)
    panelStatus.textContent = error.message || 'تعذر حفظ القرار'
  }
}

function getReason(status, category) {
  if (status === 'success') return category || 'تم تأكيد الدفع'
  if (status === 'failed') return category || 'لم تكتمل عملية الدفع'
  return category || 'عملية الدفع قيد المراجعة'
}

function getActualLabel(review) {
  if (!review.actualStatus) return 'بانتظار PayTabs'
  if (review.actualAccepted) return 'PayTabs ناجح'
  return 'PayTabs غير مكتمل'
}

function getDecisionLabel(review) {
  if (!review.decision) return ''
  if (review.decision.status === 'success') return 'قرار: ناجح'
  if (review.decision.status === 'failed') return 'قرار: فاشل'
  return 'قرار: معلق'
}

function formatAmount(value, currencyCode) {
  const number = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(number)) return escapeHtml(value + ' ' + currencyCode)
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: currencyCode }).format(number)
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
