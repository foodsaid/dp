/**
 * filterLineByItemCode 智能过滤与免弹窗机制测试
 *
 * 覆盖:
 *   规则 1 — 防子串越权: 精确匹配，ITEM-1 不命中 ITEM-10
 *   规则 2 — 多行智能过滤:
 *     场景 A: 全完成 → 非阻断警告，不弹窗
 *     场景 B: 剩 1 行 → 自动选中，不弹窗
 *     场景 C: 剩 >=2 行 → 仅传未完成行给弹窗
 *   规则 3 — 单据状态前置: 单据已完成时拦截扫码
 */
const { loadSharedJs, setMockConfirm } = require('./setup');

beforeAll(() => {
  loadSharedJs();
});

// 辅助: 检测弹窗是否存在 (showLineSelectionModal 会创建 #lineSelectModal)
function isModalVisible() {
  return !!document.getElementById('lineSelectModal');
}

// 辅助: 获取弹窗中的行按钮 (排除取消按钮)
function getModalLineButtons() {
  var modal = document.getElementById('lineSelectModal');
  if (!modal) return [];
  var buttons = modal.querySelectorAll('button');
  // 最后一个是取消按钮，其余是行按钮
  return Array.prototype.slice.call(buttons, 0, buttons.length - 1);
}

// 辅助: 从行按钮文本提取 lineNum (格式: "行 N: ...")
function extractLineNums() {
  return getModalLineButtons().map(function (btn) {
    var match = btn.textContent.match(/^行 (\d+)/);
    return match ? parseInt(match[1], 10) : null;
  });
}

let mockSelectLine;
beforeEach(() => {
  mockSelectLine = jest.fn();
  // 清理 DOM (移除可能残留的弹窗)
  var existing = document.getElementById('lineSelectModal');
  if (existing) existing.remove();
  document.body.innerHTML = '<input id="scanInput" />';
  setMockConfirm(true);
});

// ============================================================================
// 规则 1: 防子串越权 — 精确匹配 (忽略大小写)
// ============================================================================

describe('规则 1: 防子串越权 — 精确匹配', () => {
  var lines = [
    { itemCode: 'ITEM-1', lineNum: 1, itemName: '物料A' },
    { itemCode: 'ITEM-10', lineNum: 2, itemName: '物料B' },
    { itemCode: 'ITEM-100', lineNum: 3, itemName: '物料C' },
  ];

  test('扫 ITEM-1 只匹配 ITEM-1，不命中 ITEM-10 或 ITEM-100', () => {
    filterLineByItemCode('ITEM-1', lines, mockSelectLine);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(1);
    expect(isModalVisible()).toBe(false);
  });

  test('扫 ITEM-10 只匹配 ITEM-10，不命中 ITEM-1 或 ITEM-100', () => {
    filterLineByItemCode('ITEM-10', lines, mockSelectLine);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(2);
    expect(isModalVisible()).toBe(false);
  });

  test('扫 ITEM-100 只匹配 ITEM-100', () => {
    filterLineByItemCode('ITEM-100', lines, mockSelectLine);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(3);
    expect(isModalVisible()).toBe(false);
  });

  test('大小写不敏感: 扫 item-1 匹配 ITEM-1', () => {
    filterLineByItemCode('item-1', lines, mockSelectLine);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(1);
  });

  test('完全不匹配时不选中、不弹窗', () => {
    filterLineByItemCode('ITEM-999', lines, mockSelectLine);
    expect(mockSelectLine).not.toHaveBeenCalled();
    expect(isModalVisible()).toBe(false);
  });

  test('子串 ITEM 不会匹配任何行 (防子串越权)', () => {
    filterLineByItemCode('ITEM', lines, mockSelectLine);
    expect(mockSelectLine).not.toHaveBeenCalled();
    expect(isModalVisible()).toBe(false);
  });
});

// ============================================================================
// 规则 2: 多行智能过滤与免弹窗机制
// ============================================================================

describe('规则 2: 多行智能过滤与免弹窗机制', () => {
  // 三行相同物料代码的单据
  var lines = [
    { itemCode: 'MAT-001', lineNum: 1, itemName: '钢管' },
    { itemCode: 'MAT-001', lineNum: 2, itemName: '钢管' },
    { itemCode: 'MAT-001', lineNum: 3, itemName: '钢管' },
    { itemCode: 'MAT-002', lineNum: 4, itemName: '螺丝' },
  ];

  // --- 场景 A: 全部完成 → 非阻断警告，严禁弹窗 ---

  describe('场景 A: 全完成 → 非阻断警告，不弹窗', () => {
    var allCompleteFn = function (lineNum) {
      if (lineNum <= 3) return { isComplete: true, remaining: 0 };
      return { isComplete: false, remaining: 5 };
    };

    test('三行全完成 → 不弹窗 (lineSelectModal 不存在)', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, allCompleteFn);
      expect(isModalVisible()).toBe(false);
    });

    test('三行全完成 → selectLineFn 不被调用', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, allCompleteFn);
      expect(mockSelectLine).toHaveBeenCalledTimes(0);
    });

    test('三行全完成 → 非阻断（函数正常返回，不抛异常）', () => {
      expect(() => {
        filterLineByItemCode('MAT-001', lines, mockSelectLine, allCompleteFn);
      }).not.toThrow();
    });
  });

  // --- 场景 B: 剩 1 行 → 自动选中，跳过弹窗 ---

  describe('场景 B: 剩 1 行 → 自动选中，不弹窗', () => {
    // 行 1, 2 已完成，行 3 未完成
    var oneRemainingFn = function (lineNum) {
      if (lineNum === 1) return { isComplete: true, remaining: 0 };
      if (lineNum === 2) return { isComplete: true, remaining: 0 };
      return { isComplete: false, remaining: 10 };
    };

    test('2 完成 + 1 未完成 → 不弹窗 (lineSelectModal 不存在)', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, oneRemainingFn);
      expect(isModalVisible()).toBe(false);
    });

    test('2 完成 + 1 未完成 → 自动选中唯一未完成行 (lineNum=3)', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, oneRemainingFn);
      expect(mockSelectLine).toHaveBeenCalledTimes(1);
      expect(mockSelectLine).toHaveBeenCalledWith(3);
    });
  });

  // --- 场景 C: 剩 >=2 行 → 弹窗仅含未完成行 ---

  describe('场景 C: 剩 >=2 行 → 弹窗仅含未完成行', () => {
    // 行 1 已完成，行 2, 3 未完成
    var twoRemainingFn = function (lineNum) {
      if (lineNum === 1) return { isComplete: true, remaining: 0 };
      return { isComplete: false, remaining: 5 };
    };

    test('1 完成 + 2 未完成 → 弹窗出现', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, twoRemainingFn);
      expect(isModalVisible()).toBe(true);
    });

    test('弹窗只包含未完成行 (行 2, 3)，不含已完成行 (行 1)', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, twoRemainingFn);
      var lineNums = extractLineNums();
      expect(lineNums).toHaveLength(2);
      expect(lineNums).toEqual([2, 3]);
    });

    test('弹窗参数不包含已完成行的 lineNum', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, twoRemainingFn);
      var lineNums = extractLineNums();
      expect(lineNums).not.toContain(1);
    });
  });

  // --- 全部未完成时仍正常弹窗 ---

  describe('全部未完成 → 弹窗含全部匹配行', () => {
    var noneCompleteFn = function () {
      return { isComplete: false, remaining: 10 };
    };

    test('3 行全未完成 → 弹窗含 3 行', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine, noneCompleteFn);
      expect(isModalVisible()).toBe(true);
      var lineNums = extractLineNums();
      expect(lineNums).toHaveLength(3);
      expect(lineNums).toEqual([1, 2, 3]);
    });
  });

  // --- 无 checkCompleteFn 时多行直接弹窗 (向后兼容) ---

  describe('无 checkCompleteFn → 多行直接弹窗 (向后兼容)', () => {
    test('3 行相同物料、无完成检查 → 弹窗含全部 3 行', () => {
      filterLineByItemCode('MAT-001', lines, mockSelectLine);
      expect(isModalVisible()).toBe(true);
      var lineNums = extractLineNums();
      expect(lineNums).toHaveLength(3);
    });
  });

  // --- 场景 C 回调: 点击弹窗中的行按钮触发 selectLineFn ---

  describe('场景 C 回调: 点击弹窗行按钮', () => {
    test('弹窗行按钮的 onclick 包含行号和回调', () => {
      var noneCompleteFn = function () { return { isComplete: false, remaining: 10 }; };
      filterLineByItemCode('MAT-001', lines, mockSelectLine, noneCompleteFn);
      expect(isModalVisible()).toBe(true);

      // 弹窗中的行按钮通过 onclick 调用 _lineSelectCallback(lineNum)
      var modal = document.getElementById('lineSelectModal');
      var buttons = modal.querySelectorAll('button');
      // 行按钮 + 取消按钮，至少 4 个 (3 行 + 1 取消)
      expect(buttons.length).toBeGreaterThanOrEqual(4);
      // 行按钮通过 addEventListener 绑定点击事件 (非 inline onclick)
      var firstBtn = buttons[0];
      expect(firstBtn.textContent).toContain('行');
    });

    test('showLineSelectionModal 直接调用 → 存储回调并创建弹窗', () => {
      // 验证 showLineSelectionModal 能正确创建弹窗和存储回调
      showLineSelectionModal('MAT-001', [
        { itemCode: 'MAT-001', lineNum: 1, itemName: '钢管' },
        { itemCode: 'MAT-001', lineNum: 2, itemName: '钢管' },
      ], mockSelectLine);
      expect(isModalVisible()).toBe(true);
      var lineNums = extractLineNums();
      expect(lineNums).toEqual([1, 2]);
    });
  });
});

// ============================================================================
// 规则 3: 单据状态前置 — 已完成单据拦截扫码
// ============================================================================

describe('规则 3: 单据状态前置', () => {
  var lines = [
    { itemCode: 'MAT-001', lineNum: 1, itemName: '钢管' },
  ];

  test('docStatus=completed → 拦截扫码，不调用 selectLineFn', () => {
    filterLineByItemCode('MAT-001', lines, mockSelectLine, null, { docStatus: 'completed' });
    expect(mockSelectLine).not.toHaveBeenCalled();
    expect(isModalVisible()).toBe(false);
  });

  test('docStatus=completed → 不弹窗', () => {
    filterLineByItemCode('MAT-001', lines, mockSelectLine, null, { docStatus: 'completed' });
    expect(isModalVisible()).toBe(false);
  });

  test('docStatus=in_progress → 正常匹配', () => {
    filterLineByItemCode('MAT-001', lines, mockSelectLine, null, { docStatus: 'in_progress' });
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(1);
  });

  test('无 options → 正常匹配 (向后兼容)', () => {
    filterLineByItemCode('MAT-001', lines, mockSelectLine);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(1);
  });
});

// ============================================================================
// 边界条件
// ============================================================================

describe('边界条件', () => {
  test('空行数组 → 提示加载单据', () => {
    filterLineByItemCode('MAT-001', [], mockSelectLine);
    expect(mockSelectLine).not.toHaveBeenCalled();
    expect(isModalVisible()).toBe(false);
  });

  test('null 行数组 → 提示加载单据', () => {
    filterLineByItemCode('MAT-001', null, mockSelectLine);
    expect(mockSelectLine).not.toHaveBeenCalled();
  });

  test('单行匹配 + 已完成 + confirm 拒绝 → 不选中', () => {
    setMockConfirm(false);
    var lines = [{ itemCode: 'MAT-001', lineNum: 1, itemName: '钢管' }];
    var completeFn = function () { return { isComplete: true, remaining: 0 }; };
    filterLineByItemCode('MAT-001', lines, mockSelectLine, completeFn);
    expect(mockSelectLine).not.toHaveBeenCalled();
  });

  test('单行匹配 + 已完成 + confirm 确认 → 选中', () => {
    setMockConfirm(true);
    var lines = [{ itemCode: 'MAT-001', lineNum: 1, itemName: '钢管' }];
    var completeFn = function () { return { isComplete: true, remaining: 0 }; };
    filterLineByItemCode('MAT-001', lines, mockSelectLine, completeFn);
    expect(mockSelectLine).toHaveBeenCalledTimes(1);
    expect(mockSelectLine).toHaveBeenCalledWith(1);
  });
});
