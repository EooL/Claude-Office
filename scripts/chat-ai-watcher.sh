#!/usr/bin/env bash
# =============================================================================
# chat-ai-watcher.sh — Watches office chat and replies as Claude
# Started by start-office.sh, stopped by stop-office.sh
#
# Only messages a person typed into the office chat are answered. The server
# stores those with role 'default', is_system 0 and no recipient; the
# watcher's own replies and the server's "starting: / done:" announcements
# carry an agent role, and agent-to-agent messages carry a recipient, so none
# of them can trigger another `claude -p` call.
#
# Environment (all optional):
#   AGENT_OFFICE_HOME            state dir            (default ~/.agent-office)
#   AGENT_OFFICE_PORT            office server port   (default 3334)
#   CHAT_AI_POLL_INTERVAL        seconds between polls (default 8)
#   CHAT_AI_BACKEND              default: the choice saved on the office start screen (backend.json), else claude; any adapter in server/adapters.mjs (claude, codex, agy, opencode, qoder)
#   CHAT_AI_MODEL                model for the backend (default: the adapter's own default model)
#   CHAT_AI_DEBUG                set to log the raw reply and the backend's stderr
#   CHAT_AI_TIMEOUT              seconds before a `claude -p` call is killed (default 60)
#   CHAT_AI_MAX_REPLIES_PER_MIN  backstop against reply loops (default 5)
# =============================================================================

set -u

PORT="${AGENT_OFFICE_PORT:-3334}"
SERVER="http://127.0.0.1:$PORT"
POLL_INTERVAL="${CHAT_AI_POLL_INTERVAL:-8}"
# load_backend — which service answers: CHAT_AI_BACKEND, else the one picked on the
# office start screen (server/settings.mjs), else claude. Run again before each
# reply, so a pick in the page takes effect without restarting the watcher.
SETTINGS_JS="$(dirname "${BASH_SOURCE[0]}")/../server/settings.mjs"
load_backend() {
    local backend bin saved
    backend="${CHAT_AI_BACKEND:-$(node "$SETTINGS_JS" get backend 2>/dev/null)}"
    backend="${backend:-claude}"
    bin=$(node "$(dirname "${BASH_SOURCE[0]}")/adapter-bin.mjs" "$backend") || { echo "[chat-ai] Unknown backend '$backend', keeping ${BACKEND:-claude}"; return 1; }
    BACKEND="$backend"; ADAPTER_BIN="$bin"
    saved=$(node "$SETTINGS_JS" get model 2>/dev/null)
    MODEL="${CHAT_AI_MODEL:-$saved}"  # empty: the adapter's own default model
}
load_backend || exit 1
CLAUDE_TIMEOUT="${CHAT_AI_TIMEOUT:-60}"
MAX_REPLIES_PER_MIN="${CHAT_AI_MAX_REPLIES_PER_MIN:-5}"

STATE_DIR="${AGENT_OFFICE_HOME:-$HOME/.agent-office}"
PID_FILE="$STATE_DIR/chat-watcher.pid"
LAST_TS_FILE="$STATE_DIR/chat-ai-last-ts"
LOCK_FILE="$STATE_DIR/chat-ai.lock"
ERR_FILE="$STATE_DIR/chat-ai-claude.err"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# These calls disable MSYS argument conversion to preserve /goal. Convert the script path explicitly first.
DELEGATE_JS="$SCRIPT_DIR/delegate.mjs"
if command -v cygpath >/dev/null 2>&1; then DELEGATE_JS=$(cygpath -m "$DELEGATE_JS"); fi

# The flags each service runs with (for claude: --safe-mode, --tools "", --name agent-office-bot ...)
# live with its adapter in server/adapters.mjs.

mkdir -p "$STATE_DIR"
# A lock left behind by a crashed or SIGKILLed watcher must not block this one
rm -f "$LOCK_FILE"

# The watermark: the newest chat row (ms epoch) the watcher has seen. It is
# replaced through a temp file and a rename, so a crash mid-write cannot
# leave it empty.
save_last_ts() {
    printf '%s\n' "$LAST_TS" > "$LAST_TS_FILE.tmp" && mv -f "$LAST_TS_FILE.tmp" "$LAST_TS_FILE"
}

# Initialise it from the file, or to now. Anything in the file that is not a
# plain timestamp up to now — empty, junk, a time in the future — starts from
# now too: GET /chat?since= with a value it cannot parse returns every recent
# row, so the same message would be answered on every poll, and a future one
# would never let a message through.
NOW_MS=$(date +%s)000
LAST_TS=$(tr -d '[:space:]' 2>/dev/null < "$LAST_TS_FILE" || true)
case "$LAST_TS" in
    ''|*[!0-9]*) LAST_TS="" ;;
    *) if [ "${#LAST_TS}" -gt 15 ] || [ "$LAST_TS" -gt "$NOW_MS" ]; then LAST_TS=""; fi ;;
esac
if [ -z "$LAST_TS" ]; then
    [ -f "$LAST_TS_FILE" ] && echo "[chat-ai] $LAST_TS_FILE did not hold a timestamp — starting from now"
    LAST_TS="$NOW_MS"
    save_last_ts
fi

# Publish readiness only after the watermark is initialised; a caller may post as soon as this file exists.
echo $$ > "$PID_FILE"
echo "[chat-ai] Started (pid $$), polling $SERVER every ${POLL_INTERVAL}s, backend $BACKEND, model ${MODEL:-default}"
command -v "$ADAPTER_BIN" >/dev/null 2>&1 || echo "[chat-ai] Warning: '$ADAPTER_BIN' CLI not on PATH — messages will be seen but not answered"

cleanup() { trap - EXIT INT TERM; rm -f "$PID_FILE" "$LOCK_FILE" "$ERR_FILE" "$LAST_TS_FILE.tmp"; echo "[chat-ai] Stopped"; exit 0; }
trap cleanup EXIT INT TERM

# --- helpers -----------------------------------------------------------------

# (Each reply's time limit, CHAT_AI_TIMEOUT, is enforced by scripts/chat-backend.mjs.)

# Reply-rate backstop: epoch seconds of the `claude -p` calls made in the last
# minute, so a misclassified message can never burn tokens indefinitely.
CALL_TIMES=""
rate_cap_hit() {
    local now t keep="" n=0
    now=$(date +%s)
    for t in $CALL_TIMES; do
        if [ $((now - t)) -lt 60 ]; then keep="$keep $t"; n=$((n + 1)); fi
    done
    CALL_TIMES="$keep"
    [ "$n" -ge "$MAX_REPLIES_PER_MIN" ]
}
record_claude_call() { CALL_TIMES="$CALL_TIMES $(date +%s)"; }

# Keyword routing: which office persona answers.
route_message() {
    node "$SCRIPT_DIR/../server/roles.mjs" route "$1"
}

# Generate and post one reply. Returns non-zero when nothing was posted; the
# caller (reply_to_message) clears the lock either way.
# run_backend PROMPT — one text-only reply from the configured backend.
# Anything but claude goes through scripts/chat-backend.mjs (server/adapters.mjs).
run_backend() {
    CHAT_AI_ROLE="${REPLY_ROLE:-}" CHAT_AI_MODEL="$MODEL" CHAT_AI_TIMEOUT="$CLAUDE_TIMEOUT" node "$SCRIPT_DIR/chat-backend.mjs" "$BACKEND" "$1"
}

do_reply() {
    local msg="$1"
    local agent_info agent_role agent_name dev_context persona context prompt reply posted

    agent_info=$(route_message "$msg")
    agent_role=${agent_info%%|*}
    agent_name=${agent_info#*|}
    echo "[chat-ai] Routed to: $agent_name ($agent_role)"
    # The chat brain (Settings > General): the first step's service and model, unless CHAT_AI_BACKEND pins one for all
    REPLY_ROLE="$agent_role"
    reply_service="$BACKEND"; reply_model="$MODEL"
    if [ -z "${CHAT_AI_BACKEND:-}" ]; then
        agent_cfg=$(node "$SCRIPT_DIR/../server/brains.mjs" chat 2>/dev/null)
        [ -n "$agent_cfg" ] && { IFS='|' read -r reply_service reply_model _ <<<"$agent_cfg"; }
    fi

    # Gather dev context
    dev_context=$(bash "$SCRIPT_DIR/gather-context.sh" 2>/dev/null || echo "")

    # Load persona file
    persona=""
    if [ -f "$STATE_DIR/claude-persona.md" ]; then
        persona=$(cat "$STATE_DIR/claude-persona.md")
    fi

    # Fetch last 10 messages for context
    context=$(curl -sf "$SERVER/chat" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data.get('messages', [])[-10:]
lines = []
for m in msgs:
    s = m.get('sender','?')
    t = m.get('text','')
    lines.append(f'{s}: {t}')
print(chr(10).join(lines))
" 2>/dev/null)

    prompt="$persona

You are responding as $agent_name, the office $agent_role. Stay in character.
Respond in English. This is a conversational reply, not an execution channel. Never promise to start, take over, review, change files, or create a PR. Never claim work has finished. Task starts and status are reported by the delegation controller.
This reply is being generated by $reply_service (model: ${reply_model:-its default}). If asked what AI is running or answering, say that; never guess otherwise.

$dev_context

Recent conversation:
$context

Reply to the latest message naturally in at most three short sentences. Continue the conversation — reference previous messages if relevant."

    echo "[chat-ai] Generating reply via $reply_service..."
    record_claude_call
    reply=$(run_backend "$prompt" 2>"$ERR_FILE" \
        | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    if [ -n "${CHAT_AI_DEBUG:-}" ]; then
        echo "[chat-ai] debug: backend=$BACKEND model=${MODEL:-default} reply=[$reply]"
        [ -s "$ERR_FILE" ] && sed 's/^/[chat-ai] debug stderr: /' "$ERR_FILE" | head -20
    fi

    if [ -z "$reply" ]; then
        echo "[chat-ai] Empty reply from claude — nothing posted"
        if [ -s "$ERR_FILE" ]; then sed "s/^/[chat-ai]   $reply_service: /" "$ERR_FILE"; fi
        rm -f "$ERR_FILE"
        return 1
    fi
    rm -f "$ERR_FILE"

    # Preserve the separate NEXT_ACTION line so the UI can offer a scoped approval.
    reply=$(printf '%s' "$reply" | python3 -c "import sys; print(sys.stdin.read().strip()[:1800])")

    echo "[chat-ai] Replying as $agent_name: $reply"

    # Post the reply with its agent role and name. Prints "ok", or "error: ...".
    # /chat/reply speaks as an agent, so it carries the office token (the file
    # the server writes once it is up — the same one the hook reads).
    #
    # The watermark is not moved past the reply: it stays at the newest row
    # seen before generating, so a message typed while `claude -p` was
    # thinking is still ahead of it and is answered on the next poll. The
    # reply itself comes back on that poll too, but it carries an agent role,
    # which typed_by_a_person never answers, and the poll moves the watermark
    # past it.
    posted=$(CHAT_SERVER="$SERVER" CHAT_REPLY="$reply" CHAT_ROLE="$agent_role" CHAT_SENDER="$agent_name" CHAT_TOKEN_FILE="$STATE_DIR/auth-token" python3 -c "
import urllib.request, json, os
server = os.environ['CHAT_SERVER']
data = json.dumps({
    'sender': os.environ.get('CHAT_SENDER', 'Claude'),
    'role': os.environ.get('CHAT_ROLE', 'assistant'),
    'text': os.environ.get('CHAT_REPLY', ''),
}).encode()
headers = {'Content-Type': 'application/json'}
try:
    with open(os.environ['CHAT_TOKEN_FILE']) as f:
        headers['Authorization'] = 'Bearer ' + f.read().strip()
except OSError:
    pass
req = urllib.request.Request(server + '/chat/reply', data=data, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        resp.read()
    print('ok')
except Exception as e:
    print('error: ' + str(e))
" 2>/dev/null)
    case "$posted" in
        ok) ;;
        *) echo "[chat-ai] Failed to post reply — ${posted:-no answer from python3}"; return 1 ;;
    esac

    echo "[chat-ai] Done"
    return 0
}

# Hold the lock only while a reply is being generated; it is dropped on every
# exit path (and by the EXIT trap), so an empty or failed reply can never wedge
# the watcher.
reply_to_message() {
    touch "$LOCK_FILE"
    do_reply "$1"
    local rc=$?
    rm -f "$LOCK_FILE"
    return $rc
}

# --- poll loop ---------------------------------------------------------------

while true; do
    sleep "$POLL_INTERVAL"

    # Check server
    curl -sf "$SERVER/health" > /dev/null 2>&1 || continue

    # Check AI toggle
    IS_PAUSED=$(curl -sf "$SERVER/chat/cron-state" 2>/dev/null | python3 -c "import sys,json; print('true' if json.load(sys.stdin).get('paused') else 'false')" 2>/dev/null || echo "true")
    [ "$IS_PAUSED" = "true" ] && continue

    # Fetch messages since last seen
    RESPONSE=$(curl -sf "$SERVER/chat?since=$LAST_TS" 2>/dev/null || echo '{"messages":[]}')

    # Line 1: newest timestamp seen (0 if none). Line 2: the latest message a
    # person typed (empty if none) — newlines flattened so it stays one line.
    PARSED=$(printf '%s' "$RESPONSE" | python3 -c '
import sys, json
try:
    msgs = json.load(sys.stdin).get("messages", [])
except Exception:
    msgs = []
def typed_by_a_person(m):
    text = m.get("text")
    return (m.get("role", "default") == "default"
            and not m.get("is_system")
            and not m.get("recipient")
            and isinstance(text, str)
            and text.strip() != ""
            and not text.lstrip().startswith("/"))
human = [m for m in msgs if typed_by_a_person(m)]
# /goal rows come from the server (role boss, type goal) only for a caller holding the token
goals = [m for m in msgs if m.get("msg_type") == "goal" and m.get("role") == "boss"]
print(max((int(m.get("timestamp") or 0) for m in msgs), default=0))
print(human[-1]["text"].replace("\n", " ").replace("\r", " ") if human else "")
print(goals[-1]["text"].replace("\n", " ").replace("\r", " ") if goals else "")
' 2>/dev/null)
    NEW_TS=$(printf '%s\n' "$PARSED" | sed -n 1p)
    RESULT=$(printf '%s\n' "$PARSED" | sed -n 2p)
    GOAL=$(printf '%s\n' "$PARSED" | sed -n 3p)

    # Advance past everything seen this poll — replies and announcements too
    case "$NEW_TS" in
        ''|*[!0-9]*) ;;
        *) if [ "$NEW_TS" -gt "$LAST_TS" ]; then
               LAST_TS="$NEW_TS"
               save_last_ts
           fi ;;
    esac

    # The boss approved a plan: the agent that made it goes to work (in the background)
    if [ -n "$GOAL" ]; then
        echo "[chat-ai] Goal approved: $GOAL"
        MSYS_NO_PATHCONV=1 node "$DELEGATE_JS" goal "$GOAL" >/dev/null
    fi

    # Skip if no new message from a person
    [ -z "$RESULT" ] && continue

    # A job for an agent (not small talk) is taken by the delegation flow, which answers in the chat itself
    if [ "$(MSYS_NO_PATHCONV=1 node "$DELEGATE_JS" message "$RESULT" 2>/dev/null)" = handled ]; then
        echo "[chat-ai] Delegated: $RESULT"
        continue
    fi

    last_backend="$BACKEND"; load_backend
    [ "$BACKEND" != "$last_backend" ] && echo "[chat-ai] Backend is now $BACKEND, model ${MODEL:-default}"

    # Skip if already generating a reply (prevent concurrent claude -p)
    if [ -f "$LOCK_FILE" ]; then
        echo "[chat-ai] Skipping — already generating a reply"
        continue
    fi

    if rate_cap_hit; then
        echo "[chat-ai] Reply cap reached ($MAX_REPLIES_PER_MIN per minute) — not answering: $RESULT"
        continue
    fi

    # A chat brain may use a different service, or fall back to one that is installed.
    if [ -n "${CHAT_AI_BACKEND:-}" ] && ! command -v "$ADAPTER_BIN" >/dev/null 2>&1; then
        echo "[chat-ai] '$BACKEND' CLI not on PATH — not answering: $RESULT"
        continue
    fi

    echo "[chat-ai] New message: $RESULT"
    reply_to_message "$RESULT" || true
done
