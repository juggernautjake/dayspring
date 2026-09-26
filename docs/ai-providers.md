# AI providers: giving Dayspring a brain

Dayspring works without AI. Its built-in commands handle your schedule, reminders, music and more. Adding an AI "brain" lets it hold real conversations, understand anything you say, plan your day, write messages, look things up and help with ideas.

You can use any **one** of these, and switch at any time in Settings → AI brain:

| Provider | Good for | Cost | Default model |
|---|---|---|---|
| **Claude** (Anthropic) | Planning, careful thinking, writing. Has built-in web search. | Prepaid credits, pay per use | `claude-sonnet-5` |
| **ChatGPT** (OpenAI) | All-round help. The same key also unlocks OpenAI voices. | Prepaid credits, pay per use | `gpt-5-mini` |
| **Grok** (xAI) | All-round help, a casual style | Prepaid credits, pay per use | `grok-4` |
| **Ollama** | Free and private. Runs entirely on your computer. | Free | `llama3.1:8b` |

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

Ollama runs an AI model on your own computer: no account, no key, no cost, and nothing leaves the machine. The catch is speed. It needs a reasonably strong computer: 16 GB of memory, and a graphics card helps a lot. It's also less capable than the paid options.

1. Go to [ollama.com/download](https://ollama.com/download), click **Download for Windows**, and run **OllamaSetup.exe**.
2. When it finishes, a llama icon appears by the clock.
3. Open **Command Prompt**: press the Windows key, type `cmd` and press **Enter**. Then run:
   ```
   ollama pull llama3.1:8b
   ```
   This downloads about 5 GB. Wait for **success**.
4. Try it: `ollama run llama3.1:8b "Say hello"`. Type `/bye` to exit.
5. In Dayspring, open Settings → **AI brain** and choose **Ollama**. The address is filled in for you (`http://127.0.0.1:11434`). Click **Test**, pick the model, and click **Save**.

> **Tip:** Smaller models reply faster but aren't as smart: try `llama3.2:3b` (`ollama pull llama3.2:3b`). On a powerful computer, bigger models such as `qwen2.5:14b` are smarter. Any model you've pulled appears in Dayspring's model list.

## Looking things up online

With **Claude**, Dayspring uses Claude's built-in web search. With **ChatGPT, Grok or Ollama**, it uses its own web lookup. Either way, Dayspring can look things up only if **Web lookup** is on in Settings → **Permissions** (it's on by default). See [Permissions](permissions.md).

## Switching or turning it off

Open Settings → **AI brain** and pick another provider, or **Free (no AI)**. Your saved keys stay in `.env`, so you can switch back without pasting them again.

## For advanced users: the `.env` file

The wizard writes these lines to `.env` in the Dayspring folder. You can edit it in Notepad if you prefer (restart Dayspring afterwards):

```
AI_PROVIDER=anthropic        # anthropic | openai | xai | ollama   (empty = free mode)
AI_MODEL=                    # optional; empty = the provider's default
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
XAI_API_KEY=
OLLAMA_URL=http://127.0.0.1:11434
```

## If it doesn't work

> **If it doesn't work:**
> - **"Invalid key" / 401**: the key was copied incompletely or has been deleted. Make a new one and paste it again, with no spaces before or after it.
> - **"Insufficient credit" / 402 / "quota"**: add credits on the provider's billing page. It can take a minute to take effect.
> - **"Rate limit" / 429**: you're sending a lot at once, or the account is new. Wait a minute. Adding credits often raises the limit.
> - **"Model not found"**: pick a model from the dropdown instead of typing one.
> - **Ollama: "can't connect"**: make sure the llama icon is by the clock. If not, start **Ollama** from the Start menu.
> - **Replies stop mid-way or say "Sorry, I couldn't get an answer just then"**: the provider was slow or offline. Dayspring falls back to free mode for that request. Try again.
