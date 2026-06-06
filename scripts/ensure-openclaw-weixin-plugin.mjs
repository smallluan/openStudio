import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { ensureOpenClawWeixinPlugin } = require("../lib/ensure-openclaw-weixin-plugin.cjs");

ensureOpenClawWeixinPlugin({ projectRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "..") });
