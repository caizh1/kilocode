/**
 * Re-export Lucide icons for consumers of @chipmate/chipmate-ui.
 * Only add icons here that are actually used — esbuild/Vite will
 * tree-shake unused exports but explicit re-exports keep the API small.
 */
export { ChartNetwork, ScanSearch, WandSparkles } from "lucide-solid"
