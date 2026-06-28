const T = {
  title: 'دفع مباشر',
  kicker: 'دفع آمن',
  heading: 'أدخل المبلغ للدفع',
  body: 'اكتب المبلغ فقط وسيتم تحويلك مباشرة إلى صفحة الدفع الآمنة. لا توجد حقول اسم أو بريد إلكتروني أو رقم جوال.',
  amount: 'المبلغ',
  pay: 'المتابعة للدفع',
  loading: 'جاري تحويلك إلى صفحة الدفع...',
  invalid: 'المبلغ غير صحيح.',
  failed: 'تعذر بدء الدفع. حاول مرة أخرى.'
}

document.title = T.title
setText('merchantKicker', T.kicker)
setText('merchantTitle', T.heading)
setText('merchantBody', T.body)
setText('amountInputLabel', T.amount)
setText('payButton', T.pay)

const form = document.getElementById('paymentForm')
const payButton = document.getElementById('payButton')
const statusBox = document.getElementById('merchantStatus')

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const formData = new FormData(form)
  const amount = parseAmount(formData.get('amount'))
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
      body: JSON.stringify({ amount, currency })
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

function setText(id, text) {
  document.getElementById(id).textContent = text
}
