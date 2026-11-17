// Load env vars the same way `next dev` does: .env.local first, then .env.
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'], quiet: true });
