# FastMCP Servers

This repository contains TypeScript and Python hotel discovery and reservation MCP servers.

Both implementations provide hotel search, stay-price estimates, room booking, hotel and room resources, and a trip-planning prompt. They use the same sample catalog of 10 hotels and 20 room offers.

The shared catalog is stored in the repository-root [`data.json`](./data.json) and loaded by both servers.

## TypeScript server

The TypeScript implementation and its tests are in [`mcp-server-ts/`](./mcp-server-ts/). See [`mcp-server-ts/README.md`](./mcp-server-ts/README.md) for details.

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

## Python server

The Python implementation and its tests are in [`mcp-server-py/`](./mcp-server-py/). See [`mcp-server-py/README.md`](./mcp-server-py/README.md) for installation and usage.

### Requirements

- Python 3.11 or newer
- pip

### Install and run tests

```sh
cd mcp-server-py
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m unittest discover -s tests -v
```

To start the Python server locally, run `python server.py` from `mcp-server-py/`.

## Continuous integration

GitHub Actions runs the TypeScript and Python test suites for pull requests targeting `main` and for pushes to `main` (including merge commits).

## Latest update

Updated 2026-10-20: added the Python hotel reservation server, its isolated MCP tests and setup guide, and a Python GitHub Actions workflow.
