# bun-dedupe [![npm](https://img.shields.io/npm/v/bun-dedupe)](https://www.npmjs.com/package/bun-dedupe)

Dedupe dependencies in bun.lock.

🚧 WIP 🚧 Not tested with workspaces.

🗳️ Please vote for built-in support in Bun: https://github.com/oven-sh/bun/issues/1343

## Usage

### Run with bunx

```bash
bunx bun-dedupe
```

### Install locally

```bash
bun install -D bun-dedupe
bun dedupe
```

### Fail if duplicates are found

Automatically enabled if `process.env.CI` is truthy.

```bash
bun dedupe --check
```
