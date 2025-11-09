// index.js
// Примітивний кешуючий проксі-сервер для https://http.cat
// Використовує вбудований модуль http, commander для CLI та superagent для запитів до http.cat

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const superagent = require('superagent');

// --- Парсинг аргументів командного рядка (Commander) ---
// Обов'язкові параметри: --host, --port, --cache
program
  .requiredOption('-h, --host <host>', 'Host to bind the server')
  .requiredOption('-p, --port <port>', 'Port to bind the server', parseInt)
  .requiredOption('-c, --cache <path>', 'Cache directory path');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

// --- Допоміжні функції ---
function cacheFilePath(code) {
  // Зберігаємо як <cache>/<code>.jpg
  return path.join(CACHE_DIR, `${code}.jpg`);
}

async function ensureCacheDir() {
  // Створюємо директорію кеша, якщо її немає
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

// --- Основна логіка обробки запитів ---
async function handleRequest(req, res) {
  try {
    const urlParts = req.url.split('/').filter(Boolean); // ['200'] для '/200'
    const code = urlParts[0];

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request: expected path /<http-code>');
      return;
    }

    const filePath = cacheFilePath(code);

    if (req.method === 'GET') {
      // GET: повернути картинку з кеша, або запитати у http.cat і зберегти
      try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(data);
        console.log(`Served from cache: ${code}`);
      } catch (err) {
        // Файлу немає в кеші -> запит до http.cat
        console.log(`Cache miss for ${code}, fetching from https://http.cat/${code}`);
        try {
          const r = await superagent.get(`https://http.cat/${code}`).buffer(true).parse(superagent.parse.image);
          // r.body is a Buffer
          const imageBuffer = r.body;
          // Збережемо у кеш
          await fs.writeFile(filePath, imageBuffer);
          // Відправимо клієнту
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(imageBuffer);
          console.log(`Fetched and cached: ${code}`);
        } catch (err2) {
          // Помилка при отриманні з http.cat -> 404
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
          console.log(`Not found on http.cat: ${code}`);
        }
      }

    } else if (req.method === 'PUT') {
      // PUT: тіло запиту містить картинку — зберегти або замінити у кеші
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        try {
          await fs.writeFile(filePath, body);
          res.writeHead(201, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Created');
          console.log(`Saved to cache (PUT): ${code}`);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
          console.error(e);
        }
      });
      req.on('error', () => {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
      });

    } else if (req.method === 'DELETE') {
      // DELETE: видалити файл з кеша
      try {
        await fs.unlink(filePath);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Deleted');
        console.log(`Deleted from cache: ${code}`);
      } catch (e) {
        if (e.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
        }
      }

    } else {
      // Інші методи — 405
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
    }
  } catch (err) {
    console.error('Unexpected error', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
}

// --- Запуск сервера ---
(async () => {
  try {
    await ensureCacheDir();
    const server = http.createServer((req, res) => {
      handleRequest(req, res);
    });

    server.listen(PORT, HOST, () => {
      console.log(`Server started at http://${HOST}:${PORT}/ — cache: ${CACHE_DIR}`);
    });
  } catch (e) {
    console.error('Failed to start server', e);
    process.exit(1);
  }
})();
