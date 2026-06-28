const T = {
  title: 'Direct Payment',
  amountLabel: 'Amount due',
  gatewayLabel: 'Payment gateway',
  noAmount: 'Not set',
  payNow: 'Pay Now',
  loading: 'Creating secure payment session...',
  invalid: 'Invalid amount.',
  failed: 'Unable to start payment. Please try again.'
}

document.title = T.title
document.getElementById('amountLabel').textContent = T.amountLabel
document.getElementById('gatewayLabel').textContent = T.gatewayLabel
document.getElementById('payButtonText').textContent = T.payNow

const params = new URLSearchParams(window.location.search)
const currency = sanitiseCurrency(params.get('currency') || 'SAR')
const amount = parseAmount(params.get('amount'))
const amountValue = document.getElementById('amountValue')
const payButton = document.getElementById('payButton')
const statusBox = document.getElementById('status')

if (amount === null) {
  amountValue.textContent = T.noAmount
  payButton.disabled = true
} else {
  amountValue.textContent = formatAmount(amount, currency)
  payButton.disabled = false
}

payButton.addEventListener('click', async () => {
  if (amount === null) {
    statusBox.textContent = T.invalid
    return
  }

  payButton.disabled = true
  statusBox.textContent = T.loading

  try {
    const response = await fetch('/api/create-payment-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency, gateway: getSelectedGateway() })
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok || !data.url) {
      throw new Error(data.error || 'Missing checkout URL')
    }

    window.location.href = data.url
  } catch (error) {
    console.error(error)
    statusBox.textContent = T.failed
    payButton.disabled = false
  }
})

function parseAmount(value) {
  if (!value) return null
  const number = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number * 100) / 100
}

function sanitiseCurrency(value) {
  return /^[A-Z]{3}$/.test(value) ? value : 'SAR'
}

function getSelectedGateway() {
  const selected = document.querySelector('input[name="gateway"]:checked')?.value
  return ['paytabs', 'tamara', 'tap'].includes(selected) ? selected : 'paytabs'
}

function formatAmount(value, currencyCode) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode
    }).format(value)
  } catch {
    return value.toFixed(2) + ' ' + currencyCode
  }
}
