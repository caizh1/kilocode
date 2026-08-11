---
"@chipmate/chipmate-indexing": patch
"@chipmate/cli": patch
"chipmate": patch
---

Keep large workspace index rebuilds memory-bounded and isolate indexing failures from the main CLI process without changing RAG retrieval semantics.
