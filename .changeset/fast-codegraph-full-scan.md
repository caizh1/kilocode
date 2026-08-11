---
"@chipmate/chipmate-indexing": patch
---

Speed up Code Graph full scans by reusing unchanged graph and BM25 postings records, pruning deleted files at scan completion, and parsing supported graph files through a fallback-safe worker pool.
