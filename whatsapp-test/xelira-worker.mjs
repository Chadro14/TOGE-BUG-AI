import { runSiteWorker } from './site-worker.mjs'
import { bindXeliraCommands } from './xelira-commands.mjs'

export function runXelira() {
  return runSiteWorker({
    id: 'xelira-md', label: 'Xelira MD',
    key: process.env.BOT_CONNECT_XELIRA_WORKER_KEY,
    bind: bindXeliraCommands,
  })
}
