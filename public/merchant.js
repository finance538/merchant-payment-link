const T = {
  title: 'Direct Payment',
  kicker: 'Secure payment',
  heading: 'Enter the amount',
  body: 'Enter the amount only. You will be redirected to the secure payment page. No name, email, or phone number is required.',
  amount: 'Amount',
  gateway: 'Payment gateway',
  pay: 'Continue to payment',
  loading: 'Redirecting to the payment page...',
  invalid: 'Invalid amount.',
  failed: 'Unable to start payment. Please try again.'
}

document.title = T.title
setText('merchantKicker', T.kicker)
setText('merchantTitle', T.heading)
setText('merchantBody', T.body)
setText('amountInputLabel', T.amount)
setText('gatewayLabel', T.gateway)
setText('payButton', T.pay)

const form = document.getElementById('paymentForm')
const payButton = document.getElementById('payButton')
const statusBox = document.getElementById('merchantStatus')

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const formData = new FormData(form)
  const amount = parseAmount(formData.get('amount'))
  const gateway = sanitiseGateway(formData.get('gateway'))
  const currency = 'SAR'

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
      body: JSON.stringify({ amount, currency, gateway })
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
  const number = Number(String(value || '').replace(',', '.'))

  if (!Number.isFinite(number) || number <= 0) return null

  return Math.round(number * 100) / 100
}

function sanitiseGateway(value) {
  return ['paytabs', 'tamara', 'tap'].includes(value) ? value : 'paytabs'
}

function setText(id, text) {
  document.getElementById(id).textContent = text
}
