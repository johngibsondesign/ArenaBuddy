/* Demo script for LCU detection */
import * as lcu from '../src/lcu';

console.log('Initial status:', lcu.getStatus());

lcu.on('up', async () => {
  console.log('[demo] LCU UP');
  try {
    const me = await lcu.getCurrentUser({ timeoutMs: 2500 });
    console.log('[demo] Current user:', me.displayName, me.gameName ? `${me.gameName}#${me.tagLine}` : '');
  } catch (e:any) {
    console.error('[demo] getCurrentUser failed:', e.message);
  }
});

lcu.on('down', () => console.log('[demo] LCU DOWN'));
lcu.on('change', () => console.log('[demo] Auth changed'));

setInterval(async () => {
  if (lcu.getStatus() === 'UP') {
    try { await lcu.getCurrentUser({ timeoutMs: 1500 }); } catch {} // warm poll
  }
}, 5000);

process.on('SIGINT', () => { lcu.dispose(); process.exit(0); });