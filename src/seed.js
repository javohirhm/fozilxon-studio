// Namuna (demo) ma'lumot — sinash uchun. DB_PATH=data/demo.db npm run seed
import { loadEnv } from './env.js';
loadEnv();
const db = await import('./db.js');

if (db.listProjects().length) {
  console.log('Bazada ma\'lumot bor — seed to\'xtatildi.');
  process.exit(0);
}

const assistants = [
  db.createAssistant('Bekzod', 300_000),
  db.createAssistant('Sardor', 250_000),
  db.createAssistant('Jasur', 400_000),
];

const projects = {
  toy: db.createProject('Aziz & Nilufar to\'yi'),
  brand: db.createProject('Korzinka reklama roligi'),
  klip: db.createProject('Shohruhxon — klip'),
};

const rows = [
  [projects.toy, '2026-06-14', 'Fotosessiya, bog\'da', 4_000_000, 300_000, 1, [0]],
  [projects.toy, '2026-07-05', 'Nikoh to\'yi, to\'liq kun', 12_000_000, 1_200_000, 1, [0, 1]],
  [projects.toy, '2026-08-02', 'Kelin salom', 3_500_000, 0, 1, [1]],
  [projects.toy, '2026-09-12', 'Montaj yakuni, qo\'shimcha съёмка', 2_000_000, 0, 0, []],
  [projects.brand, '2026-07-18', 'Studiyada mahsulot съёмка', 9_000_000, 2_500_000, 1, [2]],
  [projects.brand, '2026-08-19', 'Ko\'chada, aktyorlar bilan', 15_000_000, 3_000_000, 1, [0, 2]],
  [projects.brand, '2026-09-03', 'Qo\'shimcha kadrlar', 4_500_000, 500_000, 0, [2]],
  [projects.brand, '2026-09-20', 'Finalka uchun dublar', 6_000_000, 800_000, 1, [0, 1, 2]],
  [projects.klip, '2026-08-08', 'Tungi съёмка, ko\'prik', 18_000_000, 4_000_000, 1, [0, 1, 2]],
  [projects.klip, '2026-08-25', 'Pavilion, krandan', 11_000_000, 5_000_000, 1, [2]],
  [projects.klip, '2026-09-15', 'Retush va qo\'shimcha kadr', 5_000_000, 0, 0, [1]],
  [projects.klip, '2026-09-26', 'Bugungi съёмка — yakuniy blok', 7_500_000, 600_000, 1, [0, 2]],
];

for (const [projectId, date, note, amount, rent, paid, idx] of rows) {
  db.createShooting({
    projectId, date, note, amount, rent, paid,
    assistants: idx.map((i) => ({ id: assistants[i], fee: db.getAssistant(assistants[i]).rate })),
  });
}

console.log(`✅ ${rows.length} съёмка, 3 loyiha, 3 yordamchi qo'shildi.`);
