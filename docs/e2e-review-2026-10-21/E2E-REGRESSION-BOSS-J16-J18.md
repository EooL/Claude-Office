# Regression journeys J16-J18 run by the boss (API level), current code

Run at 16:30 against a disposable instance of the CURRENT checkout (`node server/index.js`, temp home and registry root, ports 4893/4894), in parallel with agy's browser run. Script: a Node fetch/WebSocket client; all servers, temp dirs and ports were removed afterwards.

| Journey | Result | Evidence |
| --- | --- | --- |
| J16 `/o/default/…` equals legacy | **PASS** | `/chat`, `/agents`, `/sessions`, `/settings`: status 200 on both and identical bodies. `/o/default/` serves the UI (200, `text/html`). |
| J16 unknown offices | **PASS** | `/o/off_abc123`, `..%2f`, `OFF_ABC123`, `default%2f..%2fchat`, `%2e%2e`, `off_abcdefghijklm` all return 404 with exactly `{"error":"Unknown office"}`. |
| J16 guards | **PASS** | `Host: evil.example` gets 421; `Origin: https://evil.example` gets 403, both on a `/o/default/` path. |
| J16 WebSocket | **PASS** | `/ws` and `/o/default/ws` behave the same: trusted with the token (auth frame `trusted: true`, snapshot carries `uiToken`); anonymous is read-only (`trusted: false`, no `uiToken`); `/o/off_abc123/ws` gets 404 before any upgrade. |
| J17 secrets | **PASS** | `POST /chat/reply`: no token 401, random 64-hex token 401, the file token passes authentication (400 = body refused afterwards). A wrong token on `/o/default/chat/reply` is 401. A wrong token on either WebSocket path gives the read-only view with no `uiToken`. |
| J18 stale registry | **PASS** | `building.json` with `{"schemaVersion":2,"offices":[]}`: the server exits with code 1 and prints `Unsupported building schemaVersion. <file> cannot be used; fix it, or delete it to return to the single-office view (it holds nothing else).` The refused start created no files in the home. After deleting the file it starts (`/health` 200) and a normal start creates nothing in the registry root. |

Not covered here (agy's browser run covers them): the visual journeys, the responsive fix, the real-provider smoke.
