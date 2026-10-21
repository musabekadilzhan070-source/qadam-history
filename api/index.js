// Vercel serverless entry: every /api/* request is handled by the Express app.
// Static files (public/) are served by Vercel's CDN.
import { app } from '../server/app.js';

export default app;
