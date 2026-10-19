# FastMCP Servers

This repository currently contains a TypeScript hotel discovery and reservation MCP server built with FastMCP and Zod.

## TypeScript server

The server implementation and its tests are in [`mcp-server-ts/`](./mcp-server-ts/). It provides hotel search, stay-price estimates, room booking, a hotel catalog resource, and a trip-planning prompt. See [`mcp-server-ts/README.md`](./mcp-server-ts/README.md) for details.

### Requirements

- Node.js 22.18 or newer
- npm

### Install and run tests

```sh
cd mcp-server-ts
npm ci
npm test
```

To start the server locally, run `npm start` from `mcp-server-ts/`.

## Continuous integration

GitHub Actions runs the TypeScript test suite for pull requests targeting `main` and for pushes to `main` (including merge commits).

## Latest update

Updated 2026-10-19: added repository-level setup documentation, ignored local development artifacts, and automated test runs for changes targeting `main`.
