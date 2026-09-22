import { createApp } from "../server/app.js";

// A Vercel invocation must never read or write a shared on-disk user library.
// Results are returned to the caller and retained in that browser's IndexedDB.
export default createApp({ stateless: true });
