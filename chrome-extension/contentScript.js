/**
 * 内容脚本：监听页面选中内容，在选区上方悬浮面板，支持：
 * 1) 解释（Kimi）
 * 2) 翻译（Kimi，支持中文/英文）
 * 3) 朗读（浏览器内置 TTS）
 * 4) 润色并可编辑/一键替换（Kimi）
 */

(function () {
  const HOST_ID = 'kimi-text-helper-host';
  const MAX_SELECTION_CHARS = 2000;

  const STATE = {
    ui: null,
    shadowRoot: null,
    panelVisible: false,
    panelInteracting: false,
    selectionText: '',
    selectionTextForApi: '',
    selectionRange: null,
    replaceRange: null,
    selectionTruncated: false,
    isSpeaking: false,
    speechTextCache: '',
    requestBusy: { explain: false, translate: false, polish: false },
    selectionDebounceTimer: null,
  };

  /**
   * 确保页面上存在我们的 UI 宿主与 Shadow DOM。
   * @returns {void}
   */
  function ensureUI() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.style.position = 'absolute';
      host.style.zIndex = '2147483647';
      host.style.top = '0px';
      host.style.left = '0px';
      host.style.display = 'none';
      document.documentElement.appendChild(host);
    }

    if (host.shadowRoot) {
      STATE.shadowRoot = host.shadowRoot;
    } else {
      STATE.shadowRoot = host.attachShadow({ mode: 'open' });
    }

    if (!STATE.ui) {
      buildUI();
    }
  }

  /**
   * 构建 Shadow DOM UI（一次性）。
   * @returns {void}
   */
  function buildUI() {
    const root = STATE.shadowRoot;
    const style = `
      :host { all: initial; }
      .panel {
        width: 360px;
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 18px 60px rgba(2, 6, 23, 0.18);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      }
      .header {
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        background: rgba(255, 255, 255, 0.65);
      }
      .title {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.3px;
        color: #0f172a;
        white-space: nowrap;
      }
      .hint {
        font-size: 11px;
        color: rgba(15, 23, 42, 0.65);
        text-align: right;
        white-space: nowrap;
      }
      .body {
        padding: 10px 12px 12px;
      }
      .btn-col {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .btn {
        width: 100%;
        cursor: pointer;
        border-radius: 12px;
        border: 1px solid rgba(99, 102, 241, 0.35);
        padding: 10px 12px;
        background: rgba(99, 102, 241, 0.10);
        color: #3730a3;
        font-weight: 800;
        font-size: 13px;
        transition: transform 0.05s ease, background 0.15s ease;
      }
      .btn:hover { background: rgba(99, 102, 241, 0.16); }
      .btn:active { transform: scale(0.99); }
      .btn[disabled] { opacity: 0.6; cursor: not-allowed; }
      .translate-row {
        margin-top: -4px;
        margin-bottom: 6px;
        padding-left: 2px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .translate-label { font-size: 12px; color: rgba(15, 23, 42, 0.7); font-weight: 700; }
      select {
        flex: 1;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.5);
        background: white;
        padding: 8px 10px;
        font-weight: 800;
        font-size: 12px;
        outline: none;
      }
      .results {
        margin-top: 10px;
        display: grid;
        gap: 10px;
      }
      .section-title {
        font-size: 12px;
        font-weight: 900;
        color: rgba(15, 23, 42, 0.8);
        margin-bottom: 6px;
      }
      .result-box {
        min-height: 22px;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(15, 23, 42, 0.04);
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px;
        padding: 10px 10px;
        color: rgba(15, 23, 42, 0.95);
        font-size: 13px;
        line-height: 1.45;
      }
      .result-box.empty { color: rgba(15, 23, 42, 0.45); }
      textarea {
        width: 100%;
        resize: vertical;
        min-height: 84px;
        max-height: 220px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.5);
        padding: 10px 10px;
        outline: none;
        background: white;
        font-size: 13px;
        line-height: 1.45;
      }
      .textarea-wrap { display: grid; gap: 8px; }
      .replace-row { display: flex; gap: 10px; align-items: center; }
      .small {
        font-size: 11px;
        color: rgba(15, 23, 42, 0.65);
        line-height: 1.4;
      }
      .replace-btn {
        cursor: pointer;
        border-radius: 12px;
        border: 1px solid rgba(16, 185, 129, 0.35);
        background: rgba(16, 185, 129, 0.14);
        color: #047857;
        font-weight: 900;
        font-size: 13px;
        padding: 10px 12px;
        flex: 0 0 auto;
      }
      .replace-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
      .spinning {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(15, 23, 42, 0.20);
        border-top-color: rgba(99, 102, 241, 0.9);
        animation: spin 0.8s linear infinite;
        vertical-align: -2px;
        margin-right: 6px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;

    root.innerHTML = `
      <style>${style}</style>
      <div class="panel">
        <div class="header">
          <div class="title">文本助手</div>
          <div class="hint">选中后点功能</div>
        </div>
        <div class="body">
          <div class="btn-col">
            <button class="btn" id="btn-explain" type="button">解释</button>
            <div class="translate-row">
              <span class="translate-label">翻译目标</span>
              <select id="translate-lang">
                <option value="zh" selected>中文</option>
                <option value="en">英文</option>
              </select>
            </div>
            <button class="btn" id="btn-translate" type="button">翻译</button>
            <button class="btn" id="btn-speak" type="button">朗读</button>
            <button class="btn" id="btn-polish" type="button">润色</button>
          </div>

          <div class="results">
            <div>
              <div class="section-title">解释结果</div>
              <div class="result-box empty" id="result-explain">点击“解释”获取内容…</div>
            </div>
            <div>
              <div class="section-title">翻译结果</div>
              <div class="result-box empty" id="result-translate">点击“翻译”获取内容…</div>
            </div>
            <div>
              <div class="section-title">润色结果（可编辑）</div>
              <div class="textarea-wrap">
                <textarea id="result-polish" disabled></textarea>
                <div class="replace-row">
                  <button class="replace-btn" id="btn-replace" type="button" disabled>一键替换</button>
                  <div class="small">将把上面的内容替换回页面选中文本。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    STATE.ui = {
      host: document.getElementById(HOST_ID),
      root,
      btnExplain: root.getElementById('btn-explain'),
      btnTranslate: root.getElementById('btn-translate'),
      btnSpeak: root.getElementById('btn-speak'),
      btnPolish: root.getElementById('btn-polish'),
      translateLang: root.getElementById('translate-lang'),
      resultExplain: root.getElementById('result-explain'),
      resultTranslate: root.getElementById('result-translate'),
      textareaPolish: root.getElementById('result-polish'),
      btnReplace: root.getElementById('btn-replace'),
    };

    bindUIEvents();
  }

  /**
   * 绑定面板按钮事件。
   * @returns {void}
   */
  function bindUIEvents() {
    STATE.ui.btnExplain.addEventListener('click', onExplainClick);
    STATE.ui.btnTranslate.addEventListener('click', onTranslateClick);
    STATE.ui.btnSpeak.addEventListener('click', onSpeakClick);
    STATE.ui.btnPolish.addEventListener('click', onPolishClick);
    STATE.ui.btnReplace.addEventListener('click', onReplaceClick);

    // 面板交互期间，不触发外部 selectionchange 隐藏/重绘
    STATE.ui.host.addEventListener('mousedown', onPanelMouseDown, true);
    STATE.ui.host.addEventListener('mouseup', onPanelMouseUp, true);
  }

  /**
   * 面板按下时标记交互状态。
   * @returns {void}
   */
  function onPanelMouseDown() {
    STATE.panelInteracting = true;
  }

  /**
   * 面板抬起后延迟清除交互状态。
   * @returns {void}
   */
  function onPanelMouseUp() {
    window.setTimeout(onPanelMouseUpClear, 120);
  }

  /**
   * 清除面板交互标记。
   * @returns {void}
   */
  function onPanelMouseUpClear() {
    STATE.panelInteracting = false;
  }

  /**
   * 监听到选区变化后，根据当前选区内容更新面板。
   * @returns {void}
   */
  function onSelectionChange() {
    if (STATE.panelInteracting) return;
    if (STATE.selectionDebounceTimer) window.clearTimeout(STATE.selectionDebounceTimer);
    STATE.selectionDebounceTimer = window.setTimeout(onSelectionChangeDebounced, 180);
  }

  /**
   * selectionchange 去抖后的实际处理。
   * @returns {void}
   */
  function onSelectionChangeDebounced() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      hidePanel();
      return;
    }

    const fullText = (selection.toString() || '').trim();
    if (!fullText) {
      hidePanel();
      return;
    }
    STATE.selectionTruncated = fullText.length > MAX_SELECTION_CHARS;
    STATE.selectionText = fullText;
    STATE.selectionTextForApi = STATE.selectionTruncated ? fullText.slice(0, MAX_SELECTION_CHARS) : fullText;

    const range = selection.getRangeAt(0);
    if (!range) {
      hidePanel();
      return;
    }

    STATE.selectionRange = range.cloneRange();
    STATE.replaceRange = range.cloneRange();
    STATE.speechTextCache = STATE.selectionTextForApi;

    showPanel();
    clearResults();
    positionPanelByRange(range);
  }

  /**
   * 根据 Range 位置更新面板悬浮坐标。
   * @param {Range} range - 当前选区 Range
   * @returns {void}
   */
  function positionPanelByRange(range) {
    if (!STATE.ui || !STATE.ui.host) return;
    const rect = range.getBoundingClientRect();

    // 某些文本节点可能 rect 为 0，尽量退化到容器位置
    const clientRects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
    const firstRect = clientRects && clientRects.length ? clientRects[0] : null;
    const safeRect = rect && rect.width > 0 ? rect : firstRect || rect;
    const width = safeRect && typeof safeRect.width === 'number' ? safeRect.width : 120;
    const height = safeRect && typeof safeRect.height === 'number' ? safeRect.height : 20;

    const panelOffsetY = 10;
    const panelOffsetX = 0;

    const left = safeRect.left + window.scrollX + width / 2 + panelOffsetX;
    let top = safeRect.top + window.scrollY - panelOffsetY;

    // 先放在可见位置，再下一帧测量高度微调（避免高度未知）
    STATE.ui.host.style.display = 'block';
    STATE.ui.host.style.left = Math.max(8, left) + 'px';
    STATE.ui.host.style.top = Math.max(8, top) + 'px';

    window.requestAnimationFrame(() => {
      const panelRect = STATE.ui.host.getBoundingClientRect();
      const adjustedLeft = safeRect.left + window.scrollX + width / 2 - panelRect.width / 2 + panelOffsetX;
      const adjustedTop = safeRect.top + window.scrollY - panelRect.height - 10 - panelOffsetY;

      STATE.ui.host.style.left = Math.max(8, adjustedLeft) + 'px';
      STATE.ui.host.style.top = Math.max(8, adjustedTop) + 'px';
    });
  }

  /**
   * 显示面板。
   * @returns {void}
   */
  function showPanel() {
    if (!STATE.ui || !STATE.ui.host) return;
    STATE.ui.host.style.display = 'block';
    STATE.panelVisible = true;
  }

  /**
   * 隐藏面板。
   * @returns {void}
   */
  function hidePanel() {
    if (!STATE.ui || !STATE.ui.host) return;
    STATE.ui.host.style.display = 'none';
    STATE.panelVisible = false;
    STATE.selectionText = '';
    STATE.selectionTextForApi = '';
    STATE.selectionTruncated = false;
    STATE.selectionRange = null;
    STATE.replaceRange = null;
    STATE.isSpeaking = false;
  }

  /**
   * 清空结果区域（保持面板可用）。
   * @returns {void}
   */
  function clearResults() {
    if (!STATE.ui) return;
    STATE.ui.resultExplain.classList.add('empty');
    STATE.ui.resultTranslate.classList.add('empty');
    STATE.ui.resultExplain.textContent = '点击“解释”获取内容…';
    STATE.ui.resultTranslate.textContent = '点击“翻译”获取内容…';
    STATE.ui.textareaPolish.value = '';
    STATE.ui.textareaPolish.disabled = true;
    STATE.ui.btnReplace.disabled = true;
  }

  /**
   * 在结果区域显示加载状态。
   * @param {'explain'|'translate'|'polish'} which - 结果区标识
   * @returns {void}
   */
  function setLoading(which) {
    if (!STATE.ui) return;
    const spinner = '<span class="spinning"></span>';
    if (which === 'explain') {
      STATE.ui.resultExplain.classList.remove('empty');
      STATE.ui.resultExplain.innerHTML = spinner + '解释中…';
    }
    if (which === 'translate') {
      STATE.ui.resultTranslate.classList.remove('empty');
      STATE.ui.resultTranslate.innerHTML = spinner + '翻译中…';
    }
    if (which === 'polish') {
      STATE.ui.textareaPolish.disabled = true;
      STATE.ui.textareaPolish.value = '润色中…';
      STATE.ui.btnReplace.disabled = true;
    }
  }

  /**
   * 从后台请求 Kimi（解释/翻译/润色）。
   * @param {{action:'explain'|'translate'|'polish', text: string, translateLang?: 'zh'|'en'}} payload - 请求参数
   * @returns {Promise<{ok: boolean, result?: string, error?: string}>}
   */
  async function requestKimi(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!res || res.ok !== true) {
          resolve({ ok: false, error: res?.error || 'Kimi 调用失败' });
          return;
        }
        resolve({ ok: true, result: res.result || '' });
      });
    });
  }

  /**
   * 执行“解释”动作。
   * @returns {Promise<void>}
   */
  async function onExplainClick() {
    if (!STATE.selectionTextForApi) return;
    if (STATE.requestBusy.explain) return;

    STATE.requestBusy.explain = true;
    try {
      setLoading('explain');
      const res = await requestKimi({ action: 'explain', text: STATE.selectionTextForApi });
      if (!res.ok) {
        STATE.ui.resultExplain.textContent = '解释失败：' + res.error;
        STATE.ui.resultExplain.classList.add('empty');
        return;
      }
      STATE.ui.resultExplain.textContent = res.result || '';
      STATE.ui.resultExplain.classList.remove('empty');
    } finally {
      STATE.requestBusy.explain = false;
    }
  }

  /**
   * 执行“翻译”动作。
   * @returns {Promise<void>}
   */
  async function onTranslateClick() {
    if (!STATE.selectionTextForApi) return;
    if (STATE.requestBusy.translate) return;

    STATE.requestBusy.translate = true;
    try {
      setLoading('translate');
      const translateLang = STATE.ui.translateLang.value === 'en' ? 'en' : 'zh';
      const res = await requestKimi({ action: 'translate', text: STATE.selectionTextForApi, translateLang });
      if (!res.ok) {
        STATE.ui.resultTranslate.textContent = '翻译失败：' + res.error;
        STATE.ui.resultTranslate.classList.add('empty');
        return;
      }
      STATE.ui.resultTranslate.textContent = res.result || '';
      STATE.ui.resultTranslate.classList.remove('empty');
    } finally {
      STATE.requestBusy.translate = false;
    }
  }

  /**
   * 执行“朗读”动作（朗读选中文本）。
   * @returns {void}
   */
  function onSpeakClick() {
    if (!STATE.selectionText) return;
    if (STATE.isSpeaking) {
      stopSpeak();
      return;
    }
    speakText(STATE.speechTextCache || STATE.selectionText);
  }

  /**
   * 执行“润色”动作。
   * @returns {Promise<void>}
   */
  async function onPolishClick() {
    if (!STATE.selectionTextForApi) return;
    if (STATE.requestBusy.polish) return;

    STATE.requestBusy.polish = true;
    try {
      setLoading('polish');
      // 使用点击“润色”当时的选区，避免用户选择变化导致替换不一致
      if (STATE.selectionRange) STATE.replaceRange = STATE.selectionRange.cloneRange();

      const res = await requestKimi({ action: 'polish', text: STATE.selectionTextForApi });
      if (!res.ok) {
        STATE.ui.textareaPolish.value = '润色失败：' + res.error;
        return;
      }

      STATE.ui.textareaPolish.value = res.result || '';
      STATE.ui.textareaPolish.disabled = false;
      if (STATE.selectionTruncated) {
        STATE.ui.btnReplace.disabled = true;
        STATE.ui.textareaPolish.value = (STATE.ui.textareaPolish.value || '') + '\n[提示：选区过长，已截断用于润色，因此“一键替换”已禁用。]';
      } else {
        STATE.ui.btnReplace.disabled = false;
      }
    } finally {
      STATE.requestBusy.polish = false;
    }
  }

  /**
   * 执行“一键替换”：把 textarea 内容替换回页面选中文本。
   * @returns {void}
   */
  function onReplaceClick() {
    if (!STATE.replaceRange) return;
    if (STATE.ui.btnReplace.disabled) return;
    const newText = STATE.ui.textareaPolish.value || '';
    if (!newText.trim()) return;

    try {
      // 删除原内容并插入文本节点（尽量保持简单/稳定）
      STATE.replaceRange.deleteContents();
      const textNode = document.createTextNode(newText);
      STATE.replaceRange.insertNode(textNode);

      // 更新 selection 到新插入内容附近
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStart(textNode, textNode.nodeValue.length);
        range.setEnd(textNode, textNode.nodeValue.length);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) {
      // 替换失败时只提示在面板上
      STATE.ui.btnReplace.disabled = false;
      STATE.ui.textareaPolish.value = STATE.ui.textareaPolish.value + '\n[替换失败：' + (e instanceof Error ? e.message : String(e)) + ']';
    }

    // 替换后清理替换能力，避免重复替换
    STATE.replaceRange = null;
  }

  /**
   * 朗读文本：使用 SpeechSynthesis API。
   * @param {string} text - 需要朗读的文本
   * @returns {void}
   */
  function speakText(text) {
    const raw = (text || '').trim();
    if (!raw) return;
    const lang = /[\u3400-\u9FBF]/.test(raw) ? 'zh-CN' : 'en-US';

    stopSpeak();

    const utter = new SpeechSynthesisUtterance(raw);
    utter.lang = lang;

    const voice = pickVoice(lang);
    if (voice) utter.voice = voice;

    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.onend = function () {
      STATE.isSpeaking = false;
    };
    utter.onerror = function () {
      STATE.isSpeaking = false;
    };

    STATE.isSpeaking = true;
    window.speechSynthesis.speak(utter);
  }

  /**
   * 停止朗读。
   * @returns {void}
   */
  function stopSpeak() {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    STATE.isSpeaking = false;
  }

  /**
   * 根据 lang 前缀选择一个合适的语音（若浏览器已加载 voices）。
   * @param {string} lang - 例如 zh-CN / en-US
   * @returns {SpeechSynthesisVoice|null}
   */
  function pickVoice(lang) {
    const voices = window.speechSynthesis.getVoices?.() || [];
    const prefix = (lang || '').toLowerCase().split('-')[0];
    const match = voices.find((v) => (v.lang || '').toLowerCase().startsWith(prefix));
    return match || null;
  }

  /**
   * 初始化入口。
   * @returns {void}
   */
  function init() {
    ensureUI();
    document.addEventListener('selectionchange', onSelectionChange, { capture: true });
  }

  init();
})();

