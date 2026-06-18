import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config. revalidatePath()/revalidateTag() (on-demand ISR) work with the
// default in-memory cache; to persist ISR across deploys later, add the R2
// incremental-cache override + a NEXT_INC_CACHE_R2_BUCKET binding.
export default defineCloudflareConfig({});
