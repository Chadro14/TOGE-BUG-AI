import { loadEnvFile } from 'node:process'

try { loadEnvFile(new URL('./.env', import.meta.url)) } catch (error) {
  if (error.code !== 'ENOENT') throw error
}

if (process.argv[2] === '--site-worker') await import('./whatsapp-test/site-worker.mjs')
else {
  process.argv.splice(2, process.argv.length - 2, '--hosted')
  const personal = import('./whatsapp-test/index.mjs')
  if (process.env.DOMA_SITE_WORKER === 'true') {
    const website = import('./whatsapp-test/site-worker.mjs')
      .catch(() => console.error('Bot Connect : index du service indisponible.'))
    await Promise.all([personal, website])
  } else await personal
}
