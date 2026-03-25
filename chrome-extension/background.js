/**
 * Chrome 扩展后台服务工作线程（Manifest V3 Service Worker）。
 * 负责安全地调用 Moonshot/Kimi API：解释、翻译、润色。
 */

const ENDPOINT_CHAT_COMPLETIONS = 'https://api.moonshot.cn/v1/chat/completions';
const DEFAULT_MODEL = 'kimi-k2.5';

/**
 * 从 `chrome.storage.sync` 读取扩展设置。
 * @returns {Promise<{apiKey: string, model: string}>}
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        apiKey: '',
        model: DEFAULT_MODEL,
      },
      (items) => {
        resolve({
          apiKey: items.apiKey || '',
          model: items.model || DEFAULT_MODEL,
        });
      },
    );
  });
}

/**
 * 简单判断文本主要语言，用于选择输出语言/润色语言。
 * @param {string} text - 待检测文本
 * @returns {'zh'|'en'} - 返回 `zh` 或 `en`
 */
function detectLang(text) {
  const t = (text || '').slice(0, 2000);
  const hasChinese = /[\u3400-\u9FBF]/.test(t);
  return hasChinese ? 'zh' : 'en';
}

/**
 * 将模型返回文本做轻量清洗（去掉 ``` 代码围栏、两端包裹引号等）。
 * @param {string} raw - 模型原始返回
 * @returns {string} 清洗后的纯文本
 */
function sanitizeModelText(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.trim();
  if (!t) return '';

  // 去掉 ```xxx\n...\n``` 形式围栏（常见于模型“看起来像代码块”的输出）
  const fenceMatch = t.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fenceMatch && fenceMatch[1]) {
    t = fenceMatch[1].trim();
  }

  // 去掉整体包裹的首尾引号（避免“"xxx"”输出）
  t = t.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  return t;
}

/**
 * 调用 Moonshot/Kimi 的 Chat Completions 接口。
 * @param {string} apiKey - Kimi API Key
 * @param {string} model - 模型 ID
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages - 对话消息
 * @returns {Promise<string>} 模型生成的内容
 */
async function kimiChat(apiKey, model, messages) {
  const res = await fetch(ENDPOINT_CHAT_COMPLETIONS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      // kimi-k2.5 的 temperature/top_p/n 在文档中不可修改，这里不传这些字段。
      max_completion_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Kimi API 请求失败：HTTP ${res.status} ${res.statusText} ${bodyText}`.trim());
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * 根据动作类型构造提示词，并要求模型输出符合前端使用方式。
 * @param {'explain'|'translate'|'polish'} action - 动作类型
 * @param {string} text - 用户选中的文本
 * @param {'zh'|'en'} [translateLang] - 翻译目标语言，仅 translate 时使用
 * @returns {Array<{role: 'system'|'user', content: string}>} messages
 */
function buildMessages(action, text, translateLang) {
  const inputLang = detectLang(text);

  if (action === 'explain') {
    const outLang = inputLang === 'zh' ? '中文' : '英文';
    return [
      {
        role: 'system',
        content:
          '你是一名资深语言助手。请用用户输入的主要语言进行解释（中文->中文，英文->英文）。你输出要清晰、分点说明、避免废话。',
      },
      {
        role: 'user',
        content: `需要解释的文本（${outLang}）：\n${text}\n\n请解释：\n1) 这段/关键词的核心含义\n2) 可能的上下文理解\n3) 关键点/易错点（若适用）\n\n请用“纯文本”输出，不要包含额外的说明性前缀。`,
      },
    ];
  }

  if (action === 'translate') {
    const target = translateLang === 'en' ? '英文' : '中文';
    return [
      {
        role: 'system',
        content: '你是一名专业翻译助手。请严格按要求输出，不要添加解释或注释。',
      },
      {
        role: 'user',
        content: `把下面文本翻译成${target}：\n${text}\n\n要求：\n- 仅输出翻译结果\n- 不要输出“翻译：”“结果：”等前缀\n- 不要输出额外解释`,
      },
    ];
  }

  // polish
  const outLang = inputLang === 'zh' ? '中文' : '英文';
  return [
    {
      role: 'system',
      content: '你是一名资深文案润色助手。请只输出润色后的文本，不要添加解释或前后缀。',
    },
    {
      role: 'user',
      content: `请对下面文本做润色（${outLang}），保持原意不变，提升表达的流畅度与专业性：\n\n${text}\n\n要求：\n- 只输出润色后的正文文本\n- 不要包含“润色后：”等前缀\n- 不要包含解释或要点`,
    },
  ];
}

/**
 * 根据消息动作执行对应的 Kimi 调用。
 * @param {{action: 'explain'|'translate'|'polish', text: string, translateLang?: 'zh'|'en'}} msg - 前端消息
 * @returns {Promise<{ok: true, result: string}>|Promise<{ok: false, error: string}>}
 */
async function runKimiAction(msg) {
  const { action, text, translateLang } = msg || {};
  const cleanedText = typeof text === 'string' ? text.trim() : '';
  if (!cleanedText) {
    return { ok: false, error: '选中文本为空' };
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    return { ok: false, error: '未配置 Kimi API Key，请先在扩展 Options 中填写' };
  }

  try {
    const messages = buildMessages(action, cleanedText, translateLang);
    const raw = await kimiChat(settings.apiKey, settings.model, messages);
    const result = sanitizeModelText(raw);
    return { ok: true, result };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return { ok: false, error: errorMessage || 'Kimi 调用失败' };
  }
}

// 接收内容脚本的消息并返回结果
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 只处理我们约定的消息结构
  const action = msg?.action;
  const isSupported = action === 'explain' || action === 'translate' || action === 'polish';
  if (!isSupported) return;

  runKimiAction(msg)
    .then((res) => sendResponse(res))
    .catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error: errorMessage || '未知错误' });
    });

  // 保持消息通道有效（因为返回是异步）
  return true;
});

