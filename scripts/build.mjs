import { access } from 'node:fs/promises'

await access('public/index.html')
await access('netlify/functions/create-payment-session.ts')
console.log('Static payment site is ready for Netlify.')
