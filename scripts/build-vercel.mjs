import fs from 'node:fs/promises';
import app from '../worker/index.js';
await fs.mkdir('public', { recursive: true });
const response = await app.fetch(new Request('https://localhost/'));
if (!response.ok) throw new Error('Could not render generator page');
await fs.writeFile('public/index.html', await response.text());
