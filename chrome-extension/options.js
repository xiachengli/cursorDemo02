/**
 * 扩展 Options 页面逻辑：保存/读取 Kimi API Key 与模型选择。
 */

const DEFAULT_MODEL = 'kimi-k2.5';

/**
 * 将状态信息渲染到页面。
 * @param {string} text - 状态文本
 * @param {'ok'|'err'|'info'} kind - 状态类型
 * @returns {void}
 */
function setStatus(text, kind) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.remove('ok', 'err');
  if (kind === 'ok') el.classList.add('ok');
  if (kind === 'err') el.classList.add('err');
}

/**
 * 从 `chrome.storage.sync` 读取配置。
 * @returns {Promise<{apiKey: string, model: string}>}
 */
function loadSettings() {
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
 * 保存配置到 `chrome.storage.sync`。
 * @param {{apiKey: string, model: string}} data - 待保存配置
 * @returns {Promise<void>}
 */
function saveSettings(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        apiKey: data.apiKey || '',
        model: data.model || DEFAULT_MODEL,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve();
      },
    );
  });
}

/**
 * 加载当前配置并回填到页面表单。
 * @returns {Promise<void>}
 */
async function init() {
  const settings = await loadSettings();
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('model').value = settings.model;
  setStatus('请修改后点击“保存配置”。', 'info');
}

/**
 * 绑定 Options 页面事件（保存按钮等）。
 * @returns {void}
 */
function bindEvents() {
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('model').value;
    setStatus('正在保存…', 'info');
    try {
      await saveSettings({ apiKey, model });
      setStatus('配置已保存。', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('保存失败：' + msg, 'err');
    }
  });
}

bindEvents();
init();

