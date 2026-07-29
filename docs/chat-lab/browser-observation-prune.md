# Browser observation context pruning

Open Studio keeps **execution trails**, not every historical page DOM, in the model context.

## Default

After each `browser_action` batch the host returns a fresh `observation` tagged with `pageGeneration`. When OpenClaw assembles the next LLM prompt, all but the **latest** `browser_action` tool result lose `observation.elements` and `observation.text`. Earlier results keep `steps`, `url`, `title`, and `pageGeneration` so the model still knows what happened.

Passive per-user-turn `previewContext` injection is unchanged: it is already volatile and only attached to the latest outgoing user message.

## Why

Element refs (`e1`, `e2`, …) are page-local. Keeping the previous page’s inventory after `navigate` / `reload` wastes tokens and actively misleads the model.

## Opt-in continuity

```json
{ "steps": [{ "action": "snapshot" }], "retainPriorPageDom": true }
```

Keeps the previous `pageGeneration`’s full DOM in prompt history (for rare cross-page comparison). Prefer summarizing facts in natural language when possible.

## Code

| Piece | Path |
|-------|------|
| Prune + generation helpers | `lib/browser-observation-prune.cjs` |
| Tag observations in preview | `src/context/ChatLabPreviewContext.jsx` |
| OpenClaw prompt hook | `scripts/patch-openclaw-browser-observation-prune.mjs` |
| Product docs | [`sidebar-action.md`](./sidebar-action.md) §2.3 |

Tests: `node --test lib/browser-observation-prune.test.cjs`
