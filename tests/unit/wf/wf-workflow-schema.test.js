/**
 * wf-workflow-schema.test.js — n8n 工作流 JSON 结构验证
 *
 * 目标: 在运行时之前捕获工作流定义的静默损坏
 * 覆盖:
 *   1. JSON 可解析性
 *   2. 顶层必填字段完整性
 *   3. 节点字段完整性
 *   4. 命名规范 (wfXX 前缀)
 *   5. 无硬编码 IP 或明文密码
 *   6. CTE 内联 set_config 反模式检测 (CLAUDE.md 红线)
 *   7. set_config 节点必须是独立 SQL (不可嵌套在 CTE/子查询中)
 */

const fs = require('fs');
const path = require('path');

// ── 辅助：加载所有工作流 ──────────────────────────────────────────────────

const WF_DIR = path.resolve(__dirname, '../../../apps/wf');

function loadWorkflows() {
    const files = fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json'));
    return files.map(filename => {
        const fpath = path.join(WF_DIR, filename);
        const raw = fs.readFileSync(fpath, 'utf8');
        const parsed = JSON.parse(raw); // 解析失败则测试直接报错
        return { filename, fpath, wf: parsed };
    });
}

const WORKFLOWS = loadWorkflows();

// 过滤出含 PG 节点的工作流
function pgNodes(wf) {
    return (wf.nodes || []).filter(n => n.type === 'n8n-nodes-base.postgres');
}

// 提取节点 SQL
function nodeSQL(node) {
    return (node.parameters && node.parameters.query) || '';
}

// ── 测试套件 ──────────────────────────────────────────────────────────────

describe('工作流 JSON 结构验证', () => {

    // ── 1. 可解析性 (loadWorkflows 已隐式保证，这里显式记录) ──

    test('所有工作流文件均为有效 JSON', () => {
        // 若任何文件解析失败，WORKFLOWS 数组构建时已抛出异常
        expect(WORKFLOWS.length).toBeGreaterThan(0);
        for (const { filename, wf } of WORKFLOWS) {
            expect(typeof wf).toBe('object');
            expect(wf).not.toBeNull();
        }
    });

    // ── 2. 顶层必填字段 ──

    describe('顶层必填字段', () => {
        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 存在 name 字段且非空',
            (filename, wf) => {
                expect(typeof wf.name).toBe('string');
                expect(wf.name.trim().length).toBeGreaterThan(0);
            }
        );

        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 存在 nodes 数组且非空',
            (filename, wf) => {
                expect(Array.isArray(wf.nodes)).toBe(true);
                expect(wf.nodes.length).toBeGreaterThan(0);
            }
        );

        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 存在 connections 对象',
            (filename, wf) => {
                expect(typeof wf.connections).toBe('object');
                expect(wf.connections).not.toBeNull();
                expect(Array.isArray(wf.connections)).toBe(false);
            }
        );
    });

    // ── 3. 节点字段完整性 ──

    describe('节点字段完整性', () => {
        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 每个节点均含 id / name / type / typeVersion / position',
            (filename, wf) => {
                for (const node of wf.nodes) {
                    expect(node.id).toBeDefined();
                    expect(typeof node.name).toBe('string');
                    expect(node.name.trim().length).toBeGreaterThan(0);
                    expect(typeof node.type).toBe('string');
                    expect(node.typeVersion).toBeDefined();
                    expect(node.position).toBeDefined();
                }
            }
        );
    });

    // ── 4. 命名规范 ──

    describe('命名规范', () => {
        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 工作流 name 以 wf 开头',
            (filename, wf) => {
                expect(wf.name.toLowerCase()).toMatch(/^wf/);
            }
        );
    });

    // ── 5. 无硬编码非回环 IP ──

    describe('无硬编码 IP 地址', () => {
        const IP_PATTERN = /\b(?!127\.0\.0\.1\b)(?!10\.\d+\.\d+\.\d+\b)(\d{1,3}\.){3}\d{1,3}\b/;

        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — SQL 中不含硬编码公网 IP',
            (filename, wf) => {
                for (const node of pgNodes(wf)) {
                    const sql = nodeSQL(node);
                    expect(sql).not.toMatch(IP_PATTERN);
                }
            }
        );
    });

    // ── 6. 无明文密码 ──

    describe('无硬编码明文密码', () => {
        // 匹配 password= 或 password: 后跟非空非变量字符串
        const PWD_PATTERN = /password\s*[=:]\s*['"][^$\s'"]{4,}/i;

        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 节点参数中不含明文密码',
            (filename, wf) => {
                for (const node of wf.nodes) {
                    const raw = JSON.stringify(node.parameters || {});
                    expect(raw).not.toMatch(PWD_PATTERN);
                }
            }
        );
    });

    // ── 7. CTE 内联 set_config 反模式 (CLAUDE.md 红线) ──
    //
    // 错误模式:
    //   WITH cc AS (SELECT set_config('app.company_code', ...) ...)
    //   SELECT * FROM wms.table WHERE ...
    //
    // 问题: PG 优化器先评估 RLS 策略，CTE 内的 set_config 尚未生效
    //       → RLS 过滤在 GUC 设置之前执行 → 返回 0 行 (静默数据丢失)

    describe('CTE 内联 set_config 反模式检测', () => {
        // 匹配 WITH ... AS ( ... set_config ... )
        const CTE_SET_CONFIG_PATTERN = /\bWITH\b[\s\S]*?\bAS\s*\([\s\S]*?set_config\s*\(/i;

        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — PG 节点 SQL 不含 CTE 内联 set_config',
            (filename, wf) => {
                for (const node of pgNodes(wf)) {
                    const sql = nodeSQL(node);
                    if (!sql) continue;
                    const hasCteAntiPattern = CTE_SET_CONFIG_PATTERN.test(sql);
                    if (hasCteAntiPattern) {
                        throw new Error(
                            `[${filename}] 节点 "${node.name}" 包含 CTE 内联 set_config 反模式。` +
                            `应将 set_config 放在独立 PG 节点中，不可内联在 CTE 子查询内。` +
                            `参见 CLAUDE.md "RLS — set_config 陷阱" 章节。`
                        );
                    }
                }
            }
        );
    });

    // ── 8. set_config 节点必须是独立 SQL ──
    //
    // 规则: 若某 PG 节点含 set_config，则该节点 SQL 只应是
    //       SELECT set_config(...) 语句，不应同时执行业务查询。
    //       这保证 set_config 在独立事务节点中先行完成。

    describe('set_config 节点必须是独立 SQL', () => {
        test.each(WORKFLOWS.map(({ filename, wf }) => [filename, wf]))(
            '%s — 含 set_config 的 PG 节点不混入业务 SQL',
            (filename, wf) => {
                for (const node of pgNodes(wf)) {
                    const sql = nodeSQL(node);
                    if (!sql || !sql.includes('set_config')) continue;

                    // 独立 set_config 节点的 SQL 结构:
                    //   SELECT set_config('app.company_code', $1, false) [AS ...]
                    // 不应包含 INSERT/UPDATE/DELETE/WITH/JOIN 等业务操作
                    const BUSINESS_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|WITH\s+\w+\s+AS)\b/i;
                    const hasBusiness = BUSINESS_SQL_PATTERN.test(sql);

                    if (hasBusiness) {
                        throw new Error(
                            `[${filename}] 节点 "${node.name}" 在同一 SQL 中混用了 set_config 和业务操作。` +
                            `set_config 必须在独立 PG 节点中执行。`
                        );
                    }
                }
            }
        );
    });
});
