const T = {
  title: 'صفحة التاجر',
  kicker: 'إنشاء رابط جديد',
  heading: 'أدخل المبلغ فقط',
  body: 'سيظهر للعميل المبلغ والعملة وزر Pay Now فقط. لا توجد حقول اسم أو بريد إلكتروني أو رقم جوال.',
  amount: 'المبلغ',
  generate: 'إنشاء الرابط',
  link: 'رابط الدفع',
  copy: 'نسخ الرابط',
  copied: 'تم النسخ',
  open: 'فتح الرابط'
}

document.title = T.title
setText('merchantKicker', T.kicker)
setText('merchantTitle', T.heading)
setText('merchantBody', T.body)
setText('amountInputLabel', T.amount)
setText('generateButton', T.generate)
setText('linkLabel', T.link)
setText('copyButton', T.copy)
setText('openButton', T.open)

const form = document.getElementById('linkForm')
const result = document.getElementById('result')
const generatedLink = document.getElementById('generatedLink')
const copyButton = document.getElementById('copyButton')
const openButton = document.getElementById('openButton')

form.addEventListener('submit', event => {
  event.preventDefault()
  const formData = new FormData(form)
  const amount = Number(String(formData.get('amount') || '').replace(',', '.'))
  const currency = 'SAR'

  if (!Number.isFinite(amount) || amount <= 0) return

  const url = new URL('/', window.location.origin)
  url.searchParams.set('amount', (Math.round(amount * 100) / 100).toFixed(2))
  url.searchParams.set('currency', currency)

  generatedLink.value = url.toString()
  openButton.href = url.toString()
  result.hidden = false
  copyButton.textContent = T.copy
})

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(generatedLink.value)
  copyButton.textContent = T.copied
})

function setText(id, text) {
  document.getElementById(id).textContent = text
}
