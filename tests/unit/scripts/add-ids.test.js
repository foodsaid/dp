/**
 * add-ids.js — 工作流 ID 生成器单元测试
 * 测试目标: scripts/n8n-tools/add-ids.js 中提取的纯函数
 */
const {
  generateWorkflowId,
  shouldAddId,
  filterWorkflowFiles,
  processWorkflowData
} = require('../../../scripts/n8n-tools/add-ids');

// =============================================================================
// generateWorkflowId — ID 生成
// =============================================================================

describe('generateWorkflowId', () => {
  test('生成 10 位十六进制字符串', () => {
    const id = generateWorkflowId();
    expect(id).toMatch(/^[0-9a-f]{10}$/);
  });

  test('长度固定为 10', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateWorkflowId()).toHaveLength(10);
    }
  });

  test('多次生成不重复', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateWorkflowId());
    }
    expect(ids.size).toBe(100);
  });

  test('返回字符串类型', () => {
    expect(typeof generateWorkflowId()).toBe('string');
  });
});

// =============================================================================
// shouldAddId — ID 有效性判断
// =============================================================================

describe('shouldAddId', () => {
  test('无 id 字段 → true', () => {
    expect(shouldAddId({})).toBe(true);
  });

  test('id 为 undefined → true', () => {
    expect(shouldAddId({ id: undefined })).toBe(true);
  });

  test('id 为 null → true', () => {
    expect(shouldAddId({ id: null })).toBe(true);
  });

  test('id 为空字符串 → true', () => {
    expect(shouldAddId({ id: '' })).toBe(true);
  });

  test('id 为 0 → true (falsy)', () => {
    expect(shouldAddId({ id: 0 })).toBe(true);
  });

  test('id 为有效十六进制字符串 → false', () => {
    expect(shouldAddId({ id: 'a1b2c3d4e5' })).toBe(false);
  });

  test('id 为数字 → false', () => {
    expect(shouldAddId({ id: 12345 })).toBe(false);
  });

  test('id 为 true → false', () => {
    expect(shouldAddId({ id: true })).toBe(false);
  });

  test('对象有其他字段但无 id → true', () => {
    expect(shouldAddId({ name: 'wf02-transaction', active: true, nodes: [] })).toBe(true);
  });
});

// =============================================================================
// filterWorkflowFiles — 文件名筛选
// =============================================================================

describe('filterWorkflowFiles', () => {
  test('筛选 wf*.json 文件', () => {
    const files = ['wf02-transaction.json', 'wf03-doc.json', 'README.md', '.env', 'package.json'];
    expect(filterWorkflowFiles(files)).toEqual(['wf02-transaction.json', 'wf03-doc.json']);
  });

  test('空数组返回空数组', () => {
    expect(filterWorkflowFiles([])).toEqual([]);
  });

  test('排除非 wf 开头的 JSON', () => {
    expect(filterWorkflowFiles(['config.json', 'data.json'])).toEqual([]);
  });

  test('排除非 .json 结尾的 wf 文件', () => {
    expect(filterWorkflowFiles(['wf02.txt', 'wf03.yml', 'wf-backup'])).toEqual([]);
  });

  test('保留复杂命名的 wf JSON', () => {
    const files = ['wf1a-wo-lookup.json', 'wf22-oms-dd.json', 'wf0b-init-inventory.json'];
    expect(filterWorkflowFiles(files)).toEqual(files);
  });

  test('不含目录分隔符的纯文件名', () => {
    expect(filterWorkflowFiles(['wf.json'])).toEqual(['wf.json']);
  });
});

// =============================================================================
// processWorkflowData — 单个工作流处理
// =============================================================================

describe('processWorkflowData', () => {
  test('无 id 时添加 ID 并标记 added=true', () => {
    const data = { name: 'test-workflow', nodes: [] };
    const result = processWorkflowData(data);
    expect(result.added).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f]{10}$/);
    expect(result.data.id).toBe(result.id);
  });

  test('已有 id 时不覆盖，标记 added=false', () => {
    const data = { id: 'existing123', name: 'test' };
    const result = processWorkflowData(data);
    expect(result.added).toBe(false);
    expect(result.id).toBe('existing123');
    expect(result.data.id).toBe('existing123');
  });

  test('id 为 null 时重新生成', () => {
    const data = { id: null, name: 'test' };
    const result = processWorkflowData(data);
    expect(result.added).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f]{10}$/);
  });

  test('id 为空字符串时重新生成', () => {
    const data = { id: '', name: 'test' };
    const result = processWorkflowData(data);
    expect(result.added).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f]{10}$/);
  });

  test('返回的 data 是同一引用 (原地修改)', () => {
    const data = { name: 'test' };
    const result = processWorkflowData(data);
    expect(result.data).toBe(data);
  });

  test('模拟真实工作流 JSON 结构', () => {
    const data = {
      name: 'wf02-transaction',
      active: true,
      nodes: [{ type: 'n8n-nodes-base.webhook' }],
      connections: {},
      settings: { executionOrder: 'v1' }
    };
    const result = processWorkflowData(data);
    expect(result.added).toBe(true);
    expect(data.id).toMatch(/^[0-9a-f]{10}$/);
    // 其他字段不受影响
    expect(data.name).toBe('wf02-transaction');
    expect(data.active).toBe(true);
    expect(data.nodes).toHaveLength(1);
  });
});
