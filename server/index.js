import { config } from './config.js';
import { app, whenReady } from './app.js';

await whenReady();
app.listen(config.port, config.host, () => {
  console.log(`QADAM: http://localhost:${config.port}`);
});
