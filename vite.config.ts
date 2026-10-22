import { defineConfig, type Connect } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    port: 5176,
    host: true,
  },
  plugins: [
    {
      name: 'serve-cma-graphics',
      configureServer(server) {
        const graphicsRoot = path.resolve(__dirname, '../tiles-demo/cma-graphics_0.3.0/cma-graphics_0.3.0/graphics');
        server.middlewares.use('/graphics', (req: Connect.IncomingMessage, res, next) => {
          try {
            const cleanUrl = (req.url || '').split('?')[0];
            const filePath = path.join(graphicsRoot, decodeURIComponent(cleanUrl));
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              res.setHeader('Content-Type', 'image/png');
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          } catch (e) {
            console.error('Error serving graphics asset:', e);
          }
          next();
        });
      },
    },
  ],
});
