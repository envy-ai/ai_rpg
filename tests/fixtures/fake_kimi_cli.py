#!/usr/bin/env python3

import json
import os
import signal
import sys
import time


ARGS = sys.argv[1:]
STDIN_MESSAGES = []
PROMPT_TEXT = ""
CURRENT_MODEL = os.environ.get("FAKE_KIMI_DEFAULT_MODEL", "kimi-code/default-model")
CURRENT_THINKING = os.environ.get("FAKE_KIMI_DEFAULT_THINKING", "high")
RECEIVED_SIGNAL = ""


def build_config_options():
    configured = os.environ.get("FAKE_KIMI_MODELS")
    models = json.loads(configured) if configured else [
        "kimi-code/default-model",
        "kimi-code/custom-model",
    ]
    if CURRENT_MODEL and CURRENT_MODEL not in models:
        models.append(CURRENT_MODEL)
    return [
        {
            "type": "select",
            "id": "model",
            "name": "Model",
            "category": "model",
            "currentValue": CURRENT_MODEL,
            "options": [{"value": value, "name": value} for value in models],
        },
        {
            "type": "select",
            "id": "thinking",
            "name": "Thinking",
            "category": "thought_level",
            "currentValue": CURRENT_THINKING,
            "options": [
                {"value": "low", "name": "Low"},
                {"value": "high", "name": "High"},
                {"value": "max", "name": "Max"},
            ],
        },
        {
            "type": "select",
            "id": "mode",
            "name": "Mode",
            "category": "mode",
            "currentValue": "default",
            "options": [{"value": "default", "name": "Default"}],
        },
    ]


def write_log():
    log_path = os.environ.get("FAKE_KIMI_LOG_PATH", "")
    if not log_path:
        return
    with open(log_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "args": ARGS,
                "cwd": os.getcwd(),
                "stdinMessages": STDIN_MESSAGES,
                "promptText": PROMPT_TEXT,
                "thinkingEffortEnv": os.environ.get("KIMI_MODEL_THINKING_EFFORT", ""),
                "receivedSignal": RECEIVED_SIGNAL,
            },
            handle,
            indent=2,
        )


def write_message(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def write_response(request_id, result):
    write_message({"jsonrpc": "2.0", "id": request_id, "result": result})


def write_assistant_chunk(text, message_id="fake-kimi-message"):
    write_message(
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "fake-kimi-session",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "messageId": message_id,
                    "content": {"type": "text", "text": text},
                },
            },
        }
    )


def write_configured_event(event):
    if event.get("jsonrpc") or event.get("method"):
        write_message(event)
        return
    if event.get("role") != "assistant":
        return
    tool_calls = event.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        function = tool_calls[0].get("function", {})
        write_message(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "fake-kimi-session",
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "fake-kimi-tool-call",
                        "title": function.get("name", "Fake Kimi tool call"),
                        "kind": "other",
                        "status": "pending",
                        "rawInput": function.get("arguments", {}),
                    },
                },
            }
        )
        return
    content = event.get("content")
    if isinstance(content, str):
        write_assistant_chunk(content)


def handle_message(message):
    global CURRENT_MODEL, CURRENT_THINKING, PROMPT_TEXT
    STDIN_MESSAGES.append(message)
    write_log()
    method = message.get("method")
    if method == "initialize":
        write_response(
            message.get("id"),
            {
                "protocolVersion": 1,
                "agentCapabilities": {
                    "promptCapabilities": {
                        "image": True,
                        "audio": False,
                        "embeddedContext": True,
                    }
                },
                "authMethods": [],
                "agentInfo": {
                    "name": "Fake Kimi Code CLI",
                    "version": "0.0.0-test",
                },
            },
        )
        return
    if method == "session/new":
        write_response(
            message.get("id"),
            {
                "sessionId": "fake-kimi-session",
                "configOptions": build_config_options(),
            },
        )
        return
    if method == "session/set_config_option":
        params = message.get("params", {})
        if params.get("configId") == "model" and isinstance(params.get("value"), str):
            CURRENT_MODEL = params["value"]
        if (
            params.get("configId") == "thinking"
            and params.get("value") in {"low", "high", "max"}
        ):
            CURRENT_THINKING = params["value"]
        write_response(message.get("id"), {"configOptions": build_config_options()})
        return
    if method != "session/prompt":
        return

    prompt_blocks = message.get("params", {}).get("prompt", [])
    PROMPT_TEXT = next(
        (
            block.get("text", "")
            for block in prompt_blocks
            if block.get("type") == "text"
        ),
        "",
    )
    delay_ms = float(os.environ.get("FAKE_KIMI_DELAY_MS", "0"))
    if delay_ms > 0:
        time.sleep(delay_ms / 1000)

    malformed_stdout = os.environ.get("FAKE_KIMI_MALFORMED_STDOUT")
    if malformed_stdout:
        sys.stdout.write(malformed_stdout)
        sys.stdout.flush()
        write_log()
        return

    configured_events = os.environ.get("FAKE_KIMI_STDOUT_EVENTS")
    if configured_events:
        for event in json.loads(configured_events):
            write_configured_event(event)
    else:
        configured_chunks = os.environ.get("FAKE_KIMI_RESPONSE_CHUNKS")
        if configured_chunks:
            for chunk in json.loads(configured_chunks):
                write_assistant_chunk(str(chunk))
        else:
            write_assistant_chunk(
                os.environ.get(
                    "FAKE_KIMI_RESPONSE",
                    '{"content":"fake kimi response"}',
                )
            )
    configured_stderr = os.environ.get("FAKE_KIMI_STDERR")
    if configured_stderr:
        sys.stderr.write(configured_stderr)
        sys.stderr.flush()
    write_log()

    exit_code = int(os.environ.get("FAKE_KIMI_EXIT_CODE", "0"))
    if exit_code:
        raise SystemExit(exit_code)
    write_response(
        message.get("id"),
        {"stopReason": os.environ.get("FAKE_KIMI_STOP_REASON", "end_turn")},
    )


def handle_sigterm(_signum, _frame):
    global RECEIVED_SIGNAL
    RECEIVED_SIGNAL = "SIGTERM"
    raise SystemExit(0)


def main():
    if ARGS != ["acp"]:
        raise RuntimeError(f'Fake Kimi expected the "acp" subcommand, received: {ARGS!r}')
    signal.signal(signal.SIGTERM, handle_sigterm)
    write_log()
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if line:
            handle_message(json.loads(line))


if __name__ == "__main__":
    main()
