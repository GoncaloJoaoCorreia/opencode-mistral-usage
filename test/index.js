// Entry point for `node --test test/` on Node v22: positional test-runner args
// are glob patterns, and a bare directory arg is executed as a script — which
// resolves to this index file, importing every *.test.ts in this directory.
// (Bare `node --test` discovers the *.test.ts files directly; this file only
// exists so the `test/` directory form works.)
import "./format.test.ts"
import "./mistral.test.ts"
