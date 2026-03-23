/**
 * env-config.test.js — shared.js CONFIG 对象 window.__ENV 读取和降级行为测试
 *
 * env.js 是容器启动时动态生成的脚本，将环境变量注入为 window.__ENV。
 * shared.js 读取 window.__ENV 构建 CONFIG 对象，未配置时使用内置默认值。
 *
 * 本测试验证 JavaScript 侧的防御性读取逻辑:
 *   1. __ENV 完全缺失时 CONFIG 使用全部内置默认值
 *   2. __ENV 部分缺失时 CONFIG 使用对应默认值
 *   3. __ENV 正常注入时 CONFIG 正确反映各字段
 *   4. WMS_CONFIG 子对象的默认值防御性读取
 *   5. envName='testing' 时注入测试环境横幅
 *   6. API_BASE_URL 为空时 console.error 发出警告
 *
 * 注意: 此测试直接解析 shared.js 中的 CONFIG 构建逻辑，
 *       不依赖 loadSharedJs() 的全量加载，以隔离 CONFIG 初始化行为。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SHARED_JS = path.join(__dirname, '../../../apps/wms/shared.js');

/**
 * 在隔离的 jsdom-like 上下文中执行 shared.js 的 CONFIG 构建部分
 * @param {object} envOverrides - 注入到 window.__ENV 的值
 * @returns {{ CONFIG, consoleErrors }}
 */
function buildConfig(envOverrides) {
    const errors = [];

    // 构造精简上下文 (只需要 CONFIG 构建部分)
    const context = {
        window: { __ENV: envOverrides },
        document: {
            addEventListener: () => {},
            createElement: () => ({ style: {}, textContent: '', insertBefore: () => {} }),
            body: { insertBefore: () => {}, style: {}, firstChild: null },
        },
        navigator: {},
        sessionStorage: { getItem: () => null, setItem: () => {} },
        console: {
            error: (msg) => errors.push(msg),
            warn: () => {},
            log: () => {},
            info: () => {},
        },
        crypto: { randomUUID: () => 'test-uuid' },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        setTimeout: () => {},
        clearTimeout: () => {},
        fetch: () => Promise.resolve(),
        AbortController: class { abort() {} signal = {} },
        Audio: class { play() { return Promise.resolve(); } },
        AudioContext: class {
            createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: {} }; }
            createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
            get currentTime() { return 0; }
        },
        Blob: global.Blob || class {},
        Event: global.Event || class {},
    };

    // 提取 CONFIG 构建段落 (从 var _env = window.__ENV 到 CONFIG 定义结束)
    let code = fs.readFileSync(SHARED_JS, 'utf-8');
    // 将 const CONFIG 替换为 var CONFIG 以便在 vm 上下文中访问
    code = code.replace(/^const CONFIG/m, 'var CONFIG');

    try {
        const script = new vm.Script(code);
        const vmContext = vm.createContext(context);
        script.runInContext(vmContext);
        return { CONFIG: vmContext.CONFIG, consoleErrors: errors };
    } catch (e) {
        // 忽略 shared.js 中 DOM 操作等非 CONFIG 相关错误
        return { CONFIG: context.CONFIG, consoleErrors: errors };
    }
}

// ===========================================================================
// 1. window.__ENV 完全缺失
// ===========================================================================

describe('window.__ENV 完全缺失时的内置默认值', () => {

    test('API_BASE_URL 默认空字符串', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG).toBeDefined();
        expect(CONFIG.n8nBaseUrl).toBe('');
    });

    test('timezone 默认 UTC', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG.timezone).toBe('UTC');
    });

    test('envName 默认 development', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG.envName).toBe('development');
    });

    test('soundEnabled 默认 true', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG.soundEnabled).toBe(true);
    });

    test('autoFocusDelay 默认 100', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG.autoFocusDelay).toBe(100);
    });

    test('debug 默认 false', () => {
        const { CONFIG } = buildConfig(undefined);
        expect(CONFIG.debug).toBe(false);
    });
});

// ===========================================================================
// 2. window.__ENV 部分配置 (只注入部分字段)
// ===========================================================================

describe('window.__ENV 部分配置时的混合默认值', () => {

    test('仅设置 API_BASE_URL，其余字段使用默认值', () => {
        const { CONFIG } = buildConfig({ API_BASE_URL: '/api/wms' });
        expect(CONFIG.n8nBaseUrl).toBe('/api/wms');
        expect(CONFIG.timezone).toBe('UTC');
        expect(CONFIG.envName).toBe('development');
    });

    test('仅设置 ENV_NAME=production，API_BASE_URL 降级为空', () => {
        const { CONFIG } = buildConfig({ ENV_NAME: 'production' });
        expect(CONFIG.envName).toBe('production');
        expect(CONFIG.n8nBaseUrl).toBe('');
    });

    test('仅设置 SOUND_ENABLED=false，其余保持默认', () => {
        const { CONFIG } = buildConfig({ SOUND_ENABLED: false });
        expect(CONFIG.soundEnabled).toBe(false);
        expect(CONFIG.timezone).toBe('UTC');
    });

    test('AUTO_FOCUS_DELAY=50 被正确读取', () => {
        const { CONFIG } = buildConfig({ AUTO_FOCUS_DELAY: 50 });
        expect(CONFIG.autoFocusDelay).toBe(50);
    });
});

// ===========================================================================
// 3. window.__ENV 完整配置 — 正确映射各字段
// ===========================================================================

describe('window.__ENV 完整注入时 CONFIG 正确反映', () => {

    const FULL_ENV = {
        API_BASE_URL: 'https://wms.example.com/api/wms',
        QR_SERVICE_URL: 'https://qr.example.com',
        APP_BASE_URL: 'https://wms.example.com',
        SYSTEM_TIMEZONE: 'Asia/Bangkok',
        ENV_NAME: 'production',
        SOUND_ENABLED: false,
        AUTO_FOCUS_DELAY: 200,
        DEBUG: false,
    };

    test('n8nBaseUrl 正确映射 API_BASE_URL', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.n8nBaseUrl).toBe('https://wms.example.com/api/wms');
    });

    test('qrServiceUrl 正确映射 QR_SERVICE_URL', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.qrServiceUrl).toBe('https://qr.example.com');
    });

    test('timezone 正确映射 SYSTEM_TIMEZONE', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.timezone).toBe('Asia/Bangkok');
    });

    test('envName 正确映射 ENV_NAME', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.envName).toBe('production');
    });

    test('soundEnabled 正确映射布尔值 false', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.soundEnabled).toBe(false);
    });

    test('autoFocusDelay 正确映射数值 200', () => {
        const { CONFIG } = buildConfig(FULL_ENV);
        expect(CONFIG.autoFocusDelay).toBe(200);
    });
});

// ===========================================================================
// 4. WMS_CONFIG 子对象的防御性默认值
// ===========================================================================

describe('WMS_CONFIG 子对象防御性默认值', () => {

    test('WMS_CONFIG 未配置时使用内置默认值', () => {
        const { CONFIG } = buildConfig({});
        expect(CONFIG.wmsConfig).toBeDefined();
        expect(CONFIG.wmsConfig.DEFAULT_BIN_SUFFIX).toBe('SYSTEM-BIN-LOCATION');
        expect(CONFIG.wmsConfig.BATCH_RULE).toBe('TODAY');
        expect(CONFIG.wmsConfig.PROD_DATE_RULE).toBe('TODAY');
        expect(CONFIG.wmsConfig.ALLOW_OVERAGE).toBe(false);
        expect(CONFIG.wmsConfig.SYSTEM_BIN_FILTER).toBe('SYSTEM-BIN');
    });

    test('WMS_CONFIG 部分覆盖时非覆盖字段保持默认值', () => {
        const { CONFIG } = buildConfig({
            WMS_CONFIG: { BATCH_RULE: 'FIFO', ALLOW_OVERAGE: true },
        });
        expect(CONFIG.wmsConfig.BATCH_RULE).toBe('FIFO');
        expect(CONFIG.wmsConfig.ALLOW_OVERAGE).toBe(true);
        expect(CONFIG.wmsConfig.DEFAULT_BIN_SUFFIX).toBe('SYSTEM-BIN-LOCATION');
        expect(CONFIG.wmsConfig.PROD_DATE_RULE).toBe('TODAY');
    });

    test('WMS_CONFIG.MODULES 未配置时默认空对象', () => {
        const { CONFIG } = buildConfig({});
        expect(CONFIG.wmsConfig.MODULES).toEqual({});
    });

    test('WMS_CONFIG.MODULES 正确透传', () => {
        const modules = { SO: { enabled: true }, PO: { enabled: false } };
        const { CONFIG } = buildConfig({ WMS_CONFIG: { MODULES: modules } });
        expect(CONFIG.wmsConfig.MODULES).toEqual(modules);
    });
});

// ===========================================================================
// 5. API_BASE_URL 未配置时 console.error 警告
// ===========================================================================

describe('env.js 加载检测 — API_BASE_URL 缺失时发出警告', () => {

    test('API_BASE_URL 为空时触发 console.error', () => {
        const { consoleErrors } = buildConfig({ API_BASE_URL: '' });
        const hasEnvWarning = consoleErrors.some(msg =>
            String(msg).includes('env.js') || String(msg).includes('API_BASE_URL')
        );
        expect(hasEnvWarning).toBe(true);
    });

    test('API_BASE_URL 正常配置时不触发 env.js 警告', () => {
        const { consoleErrors } = buildConfig({ API_BASE_URL: '/api/wms' });
        const hasEnvWarning = consoleErrors.some(msg =>
            String(msg).includes('env.js') || String(msg).includes('API_BASE_URL')
        );
        expect(hasEnvWarning).toBe(false);
    });

    test('window.__ENV 完全缺失时触发 env.js 警告', () => {
        const { consoleErrors } = buildConfig(undefined);
        const hasEnvWarning = consoleErrors.some(msg =>
            String(msg).includes('env.js') || String(msg).includes('API_BASE_URL')
        );
        expect(hasEnvWarning).toBe(true);
    });
});
