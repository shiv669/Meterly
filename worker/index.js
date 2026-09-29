const { runReconciliation } = require('./reconciliation.worker');

const runOnce = process.argv.includes('--once');
const intervalMilliseconds = Number(
  process.env.WORKER_INTERVAL_MS || 24 * 60 * 60 * 1000
);

async function run() {
  try {
    await runReconciliation();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'reconciliation_run_failed',
      message: error.message
    }));

    if (runOnce) {
      process.exitCode = 1;
    }
  }
}

run().then(() => {
  if (!runOnce) {
    setInterval(run, intervalMilliseconds);
  }
});
