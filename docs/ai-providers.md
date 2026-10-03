# AI providers: giving Dayspring a brain

Dayspring works without AI. Its built-in commands handle your schedule, reminders, music and more. Adding an AI "brain" lets it hold real conversations, understand anything you say, plan your day, write messages, look things up and help with ideas.

You can use any **one** of these, and switch at any time in Settings → AI brain:

| Provider | Good for | Cost | Default model |
|---|---|---|---|
| **Claude** (Anthropic) | Planning, careful thinking, writing. Has built-in web search. | Prepaid credits, pay per use | `claude-sonnet-5` |
| **ChatGPT** (OpenAI) | All-round help. The same key also unlocks OpenAI voices. | Prepaid credits, pay per use | `gpt-5-mini` |
| **Grok** (xAI) | All-round help, a casual style | Prepaid credits, pay per use | `grok-4` |
| **Ollama** | Free and private. Runs entirely on your computer. | Free | recommended for your computer (`qwen2.5:3b` without a graphics card) |

> **Note:** An **API key** is different from a chat subscription. A ChatGPT Plus, Claude Pro or SuperGrok subscription does **not** include API access. The API is billed separately, by use. For a typical Dayspring day (a few dozen short conversations) that's usually a few cents to a few dimes.

> **Warning:** Treat an API key like a password. Anyone with it can spend your credits. Dayspring keeps it only in the `.env` file on your computer and never shows it again after you save it. If you think a key has leaked, delete it on the provider's website and make a new one.

## Claude (Anthropic)

1. Go to [platform.claude.com](https://platform.claude.com) (the Claude Console) and sign up or log in.
2. **Add credits first.** Click **Settings** → **Billing** (it may be labelled "Plans & Billing"), then **Add to credit balance**. Enter a card and an amount; $5–$10 lasts most people a long time. You can turn on auto-reload if you like.
3. Click **Settings** → **API keys** → **Create key**. Name it "Dayspring" and click **Create**.
4. **Copy the key now.** It starts with `sk-ant-` and is shown only once.
5. In Dayspring, open Settings → **AI brain**, choose **Claude**, paste the key, and click **Test**. When it says **Works!**, pick a model and click **Save**.

To add more credits later, go to the Console → **Settings** → **Billing**.

> **Tip:** `claude-sonnet-5` is the default. For lower cost choose `claude-haiku-4-5`. For the most capable choose `claude-opus-5-5`.

## ChatGPT (OpenAI)

1. Go to [platform.openai.com](https://platform.openai.com) and sign up or log in. This is the developer site, not chatgpt.com.
2. **Add credits.** Click the ⚙ **Settings** icon, then **Billing**, then **Add to credit balance**. Enter a card and an amount.
3. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and click **+ Create new secret key**. Name it "Dayspring". Leave the permissions on **All** and click **Create secret key**.
4. **Copy the key.** It starts with `sk-` and is shown only once.
5. In Dayspring, open Settings → **AI brain**, choose **ChatGPT**, paste the key, and click **Test**, then **Save**.

The same key also enables **OpenAI voices** (see [Voices](voices.md)).

## Grok (xAI)

1. Go to [console.x.ai](https://console.x.ai/team/default/api-keys) and sign in (you can use an X account, Google or email). Finish the short welcome steps.
2. **Credits**: open **Billing** in the left menu to see any trial credits, or add some with a card.
3. Click **API Keys** in the left menu, then **Create API Key**. Name it "Dayspring" and click **Save**.
4. **Copy the key.** It starts with `xai-`.
5. In Dayspring, open Settings → **AI brain**, choose **Grok**, paste the key, and click **Test**, then **Save**.

## Ollama (free, on your computer)

Ollama runs an AI model on your own computer: no account, no key, no cost, and nothing leaves the machine. The catch is speed, and a small model is less capable than Claude. Dayspring does a lot to make a local model quick and accurate (see [Local AI: how it works](#local-ai-how-it-works)).

1. Go to [ollama.com/download](https://ollama.com/download), click **Download for Windows**, and run **OllamaSetup.exe**. (Dayspring never installs it for you.)
2. When it finishes, a llama icon appears by the clock.
3. In Dayspring, open Settings → **AI brain** and choose **Ollama**. It checks, live, whether Ollama is installed and running:
   - **"Ollama isn't installed"**: install it (step 1), then press **Check**.
   - **"Installed but not running"**: press **Start Ollama**.
   - **"Running, version …, models: …"**: you're ready.
4. Under **Your computer**, Dayspring lists the models that suit this computer, with their size and a speed estimate. Press **Pull** next to one (only when you press it; there's a progress bar). Without a graphics card, pick a 3B model such as `qwen2.5:3b` (1.9 GB) for commands.
5. Pick it under **Model for commands** and press **Test tool use**. It checks that "set a timer for 1 minute", "remind me to drink water at 11pm" and "what's on my schedule tomorrow?" come back as the right actions. Then click **Save**.

The address (`http://127.0.0.1:11434`) can point at another computer later, such as a home server (`http://192.168.1.20:11434`). A remote server counts as "running" only while it answers.

### Which model?

Only models that can use tools are recommended (they can do everything Dayspring does).

| Model | Size | For | Notes |
|---|---|---|---|
| `qwen2.5:3b` | 1.9 GB | commands | Quick on any computer; the best small model at picking tools. The default recommendation without a graphics card. |
| `llama3.2:3b` | 2.0 GB | commands | Quick; a little weaker at picking tools. |
| `qwen3:4b` | 2.5 GB | commands | Strong for its size. Dayspring switches its slow "thinking" off. |
| `qwen2.5:7b` | 4.7 GB | conversation | The best all-rounder at this size. Slow (a few words a second) without a graphics card. |
| `llama3.1:8b` | 4.9 GB | conversation | Friendly conversation, decent tool use. |
| `mistral-nemo:12b` | 7.1 GB | conversation | Wants a graphics card with 8 GB or more. |
| `qwen2.5:14b` | 9.0 GB | conversation | Close to cloud quality with tools; wants 12 GB of graphics memory. |
| `llava:7b`, `qwen2.5vl:3b`, `llama3.2-vision:11b` | 3–8 GB | pictures | Only for describing pictures (Settings → **Model for pictures**). |

On a laptop without a graphics card (for example 16 GB of memory and Intel graphics: Ollama's support for Intel graphics is limited or experimental, so models run on the processor), use a 3–4B model for commands. A 7–8B model works for conversation but is slow; you can choose one as the **Model for conversation**, which calls, meetings, emails and summaries use while commands stay on the quick one.

### Options (Settings → AI brain → Ollama)

- **Context size** (default 4,096): how much the model reads at once. Bigger is slower. Dayspring moves up to 8,192 only when a conversation needs it, and reads long documents in parts.
- **Tools per request** (default 10): how many of Dayspring's ~200 abilities the model is shown for one request. Fewer is faster and more accurate.
- **Keep the model loaded** (default 30 minutes; or "always, while Dayspring runs"). Dayspring loads the model when it starts, so the first question doesn't wait.
- **Give up if no answer starts within** (default 8 seconds): then the built-in commands answer (or Claude, below), and Dayspring says so once.
- **If Ollama fails or is too slow**: the built-in commands, or **Claude** if a Claude key is saved.
- **Speed**: how long the last answers took to their first word, first sentence and the end.

### Local AI: how it works

- **The built-in commands go first.** Timers, the time, reminders, the schedule, music commands and hundreds more are answered instantly without the model, whichever AI is chosen.
- **Only the tools that matter.** Each request is matched against the tools' descriptions (and the built-in command matcher's guess, and what the conversation was just about), and the model sees about ten of them, always including the schedule reader.
- **Short instructions** with the date, day, time and time zone, a few worked examples for the tools offered, and the same safety rules as Claude, word for word: changes that need your "yes" still need it, and emails, web pages and documents are treated as information, never as instructions.
- **Tool calls are checked and repaired**: "11pm" becomes 23:00, "friday" the right date, numbers written as words become numbers; a reminder at a time is one reminder, never a repeating one. If something can't be fixed, the model is told once what was wrong. A tool call written as text (common with small models) is recognised and run, never read out.
- **Never code talk**: tool names, program files, JSON and error messages are filtered out of what's said; a failed action becomes a plain sentence ("I couldn't reach Spotify just now. Want me to try YouTube instead?").
- **Warm and quick**: the model stays loaded, answers stream (on calls and in meetings the voice starts at the first sentence), and a repeated question with nothing new to look up is answered from memory.

### What's weaker with a local model

- **Understanding and judgement.** A 3B model follows clear requests well; long, subtle or many-step requests (planning a whole week, sparring about theology) are much better with Claude.
- **Speed without a graphics card.** Expect a second or two before simple answers and several seconds for longer ones.
- **Web search** uses Dayspring's own lookup (Claude has its own, which is better at reading results).
- **Pictures** need a separate vision model, and are slow without a graphics card. Money-page reading from pictures is less reliable.
- **Long documents** are read in parts, then summarised from the notes, so details can be lost.
- **Mood tags** (expression mode) are followed less reliably.

## Switching or turning it off

- **Quick switch:** on the Dayspring screen, open **⋯ → 🧠 AI brain** (it offers only what's set up: Claude if a key is saved, Ollama if it's installed, and No AI), or use the **Switch quickly** buttons at the top of Settings → **AI brain**. Each switch takes effect on the next thing you say, with no restart, and the conversation carries on.
- **By voice** (works even with no AI): "turn off the AI" / "use no AI" / "go offline mode", "switch to Claude", "use Ollama", "which AI are you using?", "use Opus", "switch to Haiku", "use the smartest model", "use the fastest model", "switch to qwen" (any installed Ollama model by name), "what model are you using?", "check my AI key".
- **Each keeps its own settings.** Switching back to Claude brings back the Claude model you used; switching back to Ollama brings back its model. Your keys stay in `.env`.
- **No AI** is really no AI: nothing calls any model (no warm-up, no summaries, no pictures). Features that need an AI say so, or use their built-in versions.
- **Pick for me** (off unless you turn it on): quick commands, schedule changes and quick questions go to the fast model (Claude Haiku, or the smaller of your Ollama models); writing, explaining, planning, coding, faith and Scripture questions, sparring, serious talks and between-blocks conversations go to the one you chose.

On the Dayspring screen, Claude's spoken answers are streamed: the first sentence is said while the rest is still being written.

## Looking things up online

With **Claude**, Dayspring uses Claude's built-in web search. With **ChatGPT, Grok or Ollama**, it uses its own web lookup. Either way, Dayspring can look things up only if **Web lookup** is on in Settings → **Permissions** (it's on by default). See [Permissions](permissions.md).

## For advanced users: the `.env` file

The wizard writes these lines to `.env` in the Dayspring folder. You can edit it in Notepad if you prefer (restart Dayspring afterwards):

```
AI_PROVIDER=anthropic        # anthropic | openai | xai | ollama   (empty = free mode)
AI_MODEL=                    # optional; empty = the provider's default
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
XAI_API_KEY=
OLLAMA_URL=http://127.0.0.1:11434
# optional, for a local model (Settings → AI brain → Ollama writes them):
OLLAMA_CHAT_MODEL=           # a bigger model for conversation, emails and summaries
OLLAMA_VISION_MODEL=         # a model for pictures (llava, qwen2.5vl…)
OLLAMA_EMBED_MODEL=auto      # auto | off | a name: an embedding model makes tool picking a little smarter
OLLAMA_NUM_CTX=4096          OLLAMA_MAX_CTX=8192     OLLAMA_TOOLS_N=10
OLLAMA_KEEP_ALIVE=30m        # or -1: always, while Dayspring runs
OLLAMA_FIRST_TOKEN_S=8       OLLAMA_FALLBACK=offline # or claude
AI_AUTO_MODEL=               # 1 = Pick for me
AI_MODEL_ANTHROPIC= / AI_MODEL_OLLAMA=   # each provider's model, kept while another one is in use
```

## If it doesn't work

> **Claude keys:** Dayspring cleans up a pasted key (spaces, line breaks, quotes, a pasted `ANTHROPIC_API_KEY=`) and checks it's a Claude key (it starts with `sk-ant-`; an Admin key `sk-ant-admin…`, an OpenAI key `sk-…` or a Grok key `xai-…` is caught before anything is sent). **Check my Claude connection** (Settings → AI brain → Claude, or say "check my AI key") tests the saved key and shows: key saved (last 4 characters only), reachable, credit, model, and the time taken. A key Anthropic rejects is never saved; one that only met a busy moment (429/529) or no internet can be saved with **Save anyway**. If a model isn't available with the key, Dayspring uses the default model and says so. If Settings says an update is available, install it: older versions had key bugs.

> **If it doesn't work:**
> - **"Invalid key" / 401**: the key was copied incompletely or has been deleted. Make a new one and paste it again, with no spaces before or after it.
> - **"Insufficient credit" / 402 / "quota"**: add credits on the provider's billing page. It can take a minute to take effect.
> - **"Rate limit" / 429**: you're sending a lot at once, or the account is new. Wait a minute. Adding credits often raises the limit.
> - **"Model not found"**: pick a model from the dropdown instead of typing one.
> - **Ollama: "can't connect"**: make sure the llama icon is by the clock. If not, start **Ollama** from the Start menu.
> - **Replies stop mid-way or say "Sorry, I couldn't get an answer just then"**: the provider was slow or offline. Dayspring falls back to free mode for that request. Try again.
