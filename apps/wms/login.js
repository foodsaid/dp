/**
 * WMS 登录页 (login.html) 业务逻辑
 * SSO 强制化: 始终重定向到 Authelia，保留纯函数供工具复用
 */

// ============================================================================
// 纯函数 — 数据处理（无 DOM 依赖，可单元测试）
// ============================================================================

/**
 * 初始化环境变量
 * @returns {{ N8N_BASE: string }}
 */
function getLoginEnv() {
    var _env = (typeof window !== 'undefined' && window.__ENV) || {};
    return { N8N_BASE: _env.API_BASE_URL || '' };
}

/**
 * SHA-256 哈希（浏览器 Web Crypto API, 需要 HTTPS）
 * @param {string} password - 原始密码
 * @returns {Promise<string>} 十六进制哈希
 */
async function hashPassword(password) {
    if (!crypto || !crypto.subtle) {
        throw new Error('HTTPS_REQUIRED');
    }
    var encoder = new TextEncoder();
    var data = encoder.encode(password);
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/**
 * 校验登录表单输入
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {{ valid: boolean, message?: string }}
 */
function validateLoginInput(username, password) {
    if (!username || !password) {
        return { valid: false, message: '请输入用户名和密码' };
    }
    return { valid: true };
}

/**
 * 检查是否需要 HTTPS 重定向
 * @param {string} protocol - location.protocol
 * @param {string} hostname - location.hostname
 * @returns {boolean}
 */
function needsHttpsRedirect(protocol, hostname) {
    return protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1';
}

/**
 * 检查是否已登录且不是强制重登录
 * @param {string|null} storedUsername - localStorage 中的用户名
 * @param {string} search - location.search
 * @returns {boolean}
 */
function isAlreadyLoggedIn(storedUsername, search) {
    return !!storedUsername && !search.includes('relogin');
}

// ============================================================================
// DOM 绑定 — 浏览器环境
// ============================================================================

/* istanbul ignore next */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var _env = window.__ENV || {};
    if (_env.SSO_ENABLED) {
        // SSO 已在 nginx 层保护 /wms/，已认证用户直接跳转主页
        window.location.replace('/wms/');
    }
}

// ============================================================================
// 兼容性导出 — Jest 单元测试引用（不影响浏览器环境）
// ============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getLoginEnv: getLoginEnv,
        hashPassword: hashPassword,
        validateLoginInput: validateLoginInput,
        needsHttpsRedirect: needsHttpsRedirect,
        isAlreadyLoggedIn: isAlreadyLoggedIn
    };
}
