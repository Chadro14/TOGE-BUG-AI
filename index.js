import { loadEnvFile } from 'node:process'

try { loadEnvFile(new URL('./.env', import.meta.url)) } catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const workers = []
const mode = process.argv[2]
const workersOnly = mode === '--site-worker' || mode === '--xelira-site-worker'
if (mode === '--site-worker' || (!workersOnly && process.env.DOMA_SITE_WORKER === 'true')) {
  workers.push(import('./whatsapp-test/site-worker.mjs').then(({ runDomma }) => runDomma())
    .catch(() => console.error('Bot Connect : service Domma indisponible.')))
}
if (mode === '--xelira-site-worker' || (!workersOnly && process.env.XELIRA_SITE_WORKER === 'true')) {
  workers.push(import('./whatsapp-test/xelira-worker.mjs').then(({ runXelira }) => runXelira())
    .catch(() => console.error('Bot Connect : service Xelira MD indisponible.')))
}
if (workersOnly) await Promise.all(workers)
else {
  process.argv.splice(2, process.argv.length - 2, '--hosted')
  await Promise.all([import('./whatsapp-test/index.mjs'), ...workers])
}
