import { loadEnv } from './env.js';
loadEnv();

const { createServer } = await import('./server.js');
const { createBot } = await import('./bot.js');

const port = Number(process.env.PORT || 3000);
createServer().listen(port, () => console.log(`🌐 Sayt: http://localhost:${port}`));

const token = process.env.BOT_TOKEN;
if (!token) {
  console.warn('⚠️  BOT_TOKEN yo\'q — bot ishga tushmadi (sayt ishlaydi).');
} else {
  const bot = createBot(token);
  bot.start({ onStart: (me) => console.log(`🤖 Bot ishga tushdi: @${me.username}`) });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => bot.stop());
}
