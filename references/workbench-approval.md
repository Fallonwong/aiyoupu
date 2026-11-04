# Separate human confirmation page

The one-song direction console has no approval controls. Human content decisions
remain on a separate page, opened only with an actual review request:

```sh
node <skill>/scripts/aiyoupu.mjs workbench review --request <review/request.json> [--out <approval.json>] [--port 7802]
```

The skill has two human content gates: `score` and `keyframes`. Each gate can now be
satisfied from either of two places, and the two are equivalent in authority.

| Source | Record | Written by |
| --- | --- | --- |
| chat | `aiyoupu-user-approval/v1` (+ `aiyoupu-user-response/v1`) | `approveReview()` |
| separate review page | `aiyoupu-user-approval/v2`, `source: "workbench"` | `confirmWorkbenchApproval()` |

Both are read by `requireApproval(file, stage, {musicSha256, jobSha256, propsSha256})`.
The chat path is unchanged; the `v2` path is a new branch that only accepts
`source: "workbench"`. Existing approvals and existing tests stay valid.

## What the workbench record proves

- **A human clicked.** The click must carry a one-time nonce that only the running
  workbench server can issue. `openWorkbenchSession()` refuses to mint a session
  without the server's in-memory runtime key, and the nonce store persists only
  `sha256(serverKey)`. An Agent-run script cannot produce a valid nonce.
  The session entry is also HMAC'd (`credential.sessionMac`); verification can
  re-derive it when the server key is present as
  `AIYOUPU_WORKBENCH_SERVER_KEY`.
- **The approved content was the displayed content.** The session pins
  `displayFingerprint(request)` — a hash over request id, bundle hash, stage,
  every displayed file name plus its sha256, and the music/job hashes. The click
  echoes it as `displayedSha256`; a mismatch is rejected before any record exists.
- **It cannot be replayed.** `nonceSha256` is marked `consumedAt` on first use, and
  the record file is created with `wx`. A second click or a second approval for the
  same request is refused.
- **It cannot be edited.** The record is self-hashed: `approvalSha256 =
  hashObject(record minus approvalSha256)`. `requireApproval` recomputes it, and
  re-reads `request.json` so a rewritten review bundle also fails. It also loads
  `nonceStore` and requires the referenced session to exist, be consumed, and
  match the record's request, click time, display hash and MAC.
- **It expires with the work.** `requireApproval(..., {jobSha256})` and
  `{propsSha256}` compare the approved job/props against the current ones; a change
  returns `USER_APPROVAL_STALE`.

## Credential shape

The page posts these fields to the server on click; the server forwards them
unchanged to `confirmWorkbenchApproval`:

```json
{
  "provider": "workbench",
  "sessionId": "WS-...",
  "nonce": "<hex received from /api/review/open>",
  "displayedSha256": "<displaySha256 from the same response>",
  "requestId": "<request.id>",
  "bundleSha256": "<request.bundleSha256>",
  "stage": "score | keyframes",
  "clickedAt": "2026-11-03T12:00:00.000Z"
}
```

## Rejections and what to do next

| code | meaning | next |
| --- | --- | --- |
| `WORKBENCH_CREDENTIAL_REQUIRED` | no credential object | show the real page; the Agent cannot approve |
| `WORKBENCH_PROVIDER_INVALID` | provider is not `workbench` | open the review in the workbench |
| `WORKBENCH_CREDENTIAL_INCOMPLETE` | a required field is blank or `clickedAt` is not a timestamp | reload the page |
| `WORKBENCH_SERVER_KEY_REQUIRED` / `_INVALID` | session not minted by this server process | open the review from the workbench server |
| `WORKBENCH_REQUEST_MISMATCH` | credential names a different request | confirm the currently displayed request |
| `WORKBENCH_SESSION_INVALID` | no open session for this request | open a new session |
| `WORKBENCH_DISPLAY_MISMATCH` | content hash ≠ displayed hash, or bundle changed after opening | re-render, then confirm |
| `WORKBENCH_NONCE_INVALID` | nonce does not match the session | reload; never invent a nonce |
| `WORKBENCH_NONCE_REPLAY` | nonce already consumed | display a new review |
| `WORKBENCH_CREDENTIAL_EXPIRED` | click outside the session window | show the review again |
| `WORKBENCH_ALREADY_APPROVED` | approval file exists | keep it; do not approve twice |
| `USER_APPROVAL_STALE` | music/job/props changed | re-show the affected gate |
| `USER_APPROVAL_INVALID` | record edited or mismatched | obtain a fresh confirmation |

`requireApproval` performs the session check, so a v2 record whose nonce store is
missing, edited, or never consumed fails with `USER_APPROVAL_INVALID`. Keep
`workbench-approval-store.json` next to `request.json`; it holds no raw nonce and
no server key.

A workbench click is never accepted as `actor: "user"` text evidence, and a chat
message is never accepted as a workbench credential. Each source is checked on its
own path.

## Display-before-confirm

The order is enforced by the hashes, not by convention: the session is opened
against a specific `request.json`, the page reports the hash of what it rendered,
and the record binds that hash. Confirming content that was never rendered fails
`WORKBENCH_DISPLAY_MISMATCH`; confirming without an open session for that request
fails `WORKBENCH_SESSION_INVALID`. Show the full bundle for the stage first, then
let the user click.

## Server wiring (interface for the UI thread)

The server owns four calls; the page never sees the server key.

```js
import {initWorkbenchStore,openWorkbenchSession,confirmWorkbenchApproval} from './workbench-approval.mjs';

// once at startup; keep serverKey in memory only
const serverKey=crypto.randomBytes(32).toString('hex');
initWorkbenchStore({store:storeFile,serverKey});

// GET /api/review/open?request=<request.json>
const session=openWorkbenchSession({request,store:storeFile,serverKey});
// -> {sessionId,nonce,requestId,bundleSha256,stage,displaySha256,issuedAt,expiresAt}

// POST /api/review/confirm  body = the click credential above
const result=confirmWorkbenchApproval({request,credential:body,out:approvalFile,store:storeFile,jobSha256,propsSha256});
// -> {status:'SCORE_USER_APPROVED'|'KEYFRAMES_USER_APPROVED',approval,approvalSha256,next}
```

The page must render `displaySha256` from the open response (it is the hash of the
bundle it was told to show) and send `sessionId`, `nonce`, `displayedSha256`,
`requestId`, `bundleSha256`, `stage`, `clickedAt` back on click. Errors surface as
`{status:'blocked', code, message, next}`; render `message` verbatim and do not
retry automatically.
