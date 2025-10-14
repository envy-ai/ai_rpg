@echo off
curl -sS "https://nano-gpt.com/api/v1/chat/completions" ^
  -H "Authorization: Bearer YOUR_KEY_HERE" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"z-ai/glm-4.6\",\"messages\":[{\"role\":\"user\",\"content\":\"hello world\"}]}"
